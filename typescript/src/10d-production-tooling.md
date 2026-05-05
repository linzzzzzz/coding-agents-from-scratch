# Production Tooling

Production agents need tool output limits, safe parallelism, and real integration tests so tool behavior stays reliable beyond mocked evals.

---

## 6. Tool Result Size Limits

### The Problem

`readFile` on a 10MB log file returns the entire content. That's ~2.7 million tokens — far more than any context window. The API call fails or the conversation becomes unusable.

### The Fix

Create an agent-level helper for formatting tool output before it goes back into the model:

**Edit `src/agent/toolResults.ts`:**

```typescript
export const MAX_TOOL_RESULT_LENGTH = 50_000; // ~13k tokens

export function truncateResult(
  result: string,
  maxLength: number = MAX_TOOL_RESULT_LENGTH,
): string {
  if (result.length <= maxLength) return result;

  const half = Math.floor(maxLength / 2);
  const truncatedLines = result.slice(half, result.length - half).split("\n").length;

  return (
    result.slice(0, half) +
    `\n\n... [${truncatedLines} lines truncated] ...\n\n` +
    result.slice(result.length - half)
  );
}
```

This file lives next to `run.ts` because it is not a tool implementation. It is agent-loop infrastructure for controlling what tool results are allowed back into the conversation.

Apply to every tool result before adding to messages:

**Edit `src/agent/run.ts`:**

```typescript
import { truncateResult } from "./toolResults.ts";

// ...

const rawToolResult = await executeTool(tc.toolName, tc.args);
const toolResult = truncateResult(rawToolResult);
```

Use `toolResult` for `callbacks.onToolCallEnd(...)`, conversation history, and anything sent back to the model. Keep `rawToolResult` only if you need full local logs or debugging output.

For file tools specifically, add pagination:

**Edit `src/agent/tools/file.ts`:**

```typescript
export const readFile = tool({
  description: "Read file contents. For large files, use offset and limit.",
  inputSchema: z.object({
    path: z.string(),
    offset: z.number().optional().describe("Line number to start from"),
    limit: z.number().optional().describe("Max lines to read").default(200),
  }),
  execute: async ({
    path: filePath,
    offset = 0,
    limit = 200,
  }: {
    path: string;
    offset?: number;
    limit?: number;
  }) => {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const slice = lines.slice(offset, offset + limit);
    const totalLines = lines.length;

    let result = slice.join("\n");
    if (offset + slice.length < totalLines) {
      result += `\n\n[Showing lines ${offset + 1}-${offset + slice.length} of ${totalLines}. Use offset to read more.]`;
    }
    return result;
  },
});
```

### Minimal Test

Create a large mock Markdown file to check file-tool pagination:

```bash
node -e 'let s="# Large Test\n\n"; for (let i=1;i<=250;i++) s += `## Section ${i}\n${"x".repeat(400)}\n\n`; require("fs").writeFileSync("large-test.md", s)'
```

Call the `readFile` tool directly:

```bash
node --import tsx/esm -e 'const { executeTool } = await import("./src/agent/executeTool.ts"); const result = await executeTool("readFile", { path: "large-test.md", limit: 200 }); console.log(result.split("\n").slice(-2).join("\n"));'
```

You should see a pagination footer:

```txt
[Showing lines 1-200 of 753. Use offset to read more.]
```

Check the next page:

```bash
node --import tsx/esm -e 'const { executeTool } = await import("./src/agent/executeTool.ts"); const result = await executeTool("readFile", { path: "large-test.md", offset: 200, limit: 200 }); console.log(result.split("\n").slice(-2).join("\n"));'
```

Expected footer:

```txt
[Showing lines 201-400 of 753. Use offset to read more.]
```

This confirms the file tool is slicing results with `limit` and `offset`. To test `truncateResult` specifically, use a tool result that is still larger than `MAX_TOOL_RESULT_LENGTH` after pagination, or temporarily lower `MAX_TOOL_RESULT_LENGTH`.

---

---
## 7. Parallel Tool Execution

### The Problem

When the LLM requests multiple tool calls in one turn (e.g., read three files), we execute them sequentially. This is unnecessarily slow — file reads are independent.

### The Fix

Use one shared helper for executing a tool call, then add a small scheduler around it.

For background on why this shape mirrors larger coding agents, see [Production Tool Orchestration Reference](./10d-production-tool-orchestration-reference.md).

**Edit `src/agent/run.ts`:**

```typescript
const CONCURRENCY_SAFE_TOOLS = new Set(["readFile", "listFiles", "webSearch"]);

function isConcurrencySafe(tc: ToolCallInfo): boolean {
  return CONCURRENCY_SAFE_TOOLS.has(tc.toolName);
}

type ToolBatch = {
  isConcurrencySafe: boolean;
  toolCalls: ToolCallInfo[];
};

function partitionToolCalls(toolCalls: ToolCallInfo[]): ToolBatch[] {
  const batches: ToolBatch[] = [];

  for (const tc of toolCalls) {
    const safe = isConcurrencySafe(tc);
    const last = batches[batches.length - 1];

    if (safe && last?.isConcurrencySafe) {
      last.toolCalls.push(tc);
    } else {
      batches.push({ isConcurrencySafe: safe, toolCalls: [tc] });
    }
  }

  return batches;
}
```

Then extract the shared execution work into one helper inside `runAgent`, near the tool loop:

If your logger does not have this event yet, add `"tool_execution_started"` to the `LogEvent` union and add this method to `src/agent/logger.ts`:

```typescript
logToolExecutionStarted(name: string, args: unknown): void {
  this.log("tool_execution_started", { toolName: name, args });
}
```

```typescript
async function executeApprovedToolCall(
  tc: ToolCallInfo,
): Promise<ModelMessage> {
  usageTracker.addToolCall();
  const toolLimitCheck = usageTracker.check();

  if (!toolLimitCheck.ok) {
    throw new Error(toolLimitCheck.reason);
  }

  const toolStart = Date.now();
  logger.logToolExecutionStarted(tc.toolName, tc.args);
  const rawToolResult = await executeTool(tc.toolName, tc.args);
  const toolResult = truncateResult(rawToolResult);
  const durationMs = Date.now() - toolStart;

  logger.logToolResult(tc.toolName, toolResult, durationMs);
  previousToolResults.push(toolResult);
  callbacks.onToolCallEnd(tc.toolName, toolResult);

  const wrappedToolResult = wrapToolResult(tc.toolName, toolResult);

  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text", value: wrappedToolResult },
      },
    ],
  };
}
```

Now replace the old sequential `for (const tc of toolCalls)` block with batched execution:

```typescript
let rejected = false;

for (const batch of partitionToolCalls(toolCalls)) {
  const approvedToolCalls: ToolCallInfo[] = [];

  // Keep validation and approval sequential so the user sees one clear decision
  // at a time, even when execution can run in parallel later.
  for (const tc of batch.toolCalls) {
    const validation = validateToolCall(
      tc.toolName,
      tc.args,
      previousToolResults,
    );

    if (!validation.valid) {
      const stopMessage = `\n[Tool blocked: ${validation.reason}]`;
      callbacks.onToken(stopMessage);
      fullResponse += stopMessage;
      rejected = true;
      break;
    }

    const approved = await callbacks.onToolApproval(tc.toolName, tc.args);
    logger.log("approval", { toolName: tc.toolName, approved });

    if (!approved) {
      rejected = true;
      break;
    }

    approvedToolCalls.push(tc);
  }

  if (rejected) break;

  try {
    if (batch.isConcurrencySafe) {
      const toolMessages = await Promise.all(
        approvedToolCalls.map(executeApprovedToolCall),
      );
      messages.push(...toolMessages);
      reportTokenUsage();
    } else {
      for (const tc of approvedToolCalls) {
        const toolMessage = await executeApprovedToolCall(tc);
        messages.push(toolMessage);
        reportTokenUsage();
      }
    }
  } catch (error) {
    const err = error as Error;
    const stopMessage = `\n[Agent stopped: ${err.message}]`;
    callbacks.onToken(stopMessage);
    fullResponse += stopMessage;
    rejected = true;
    break;
  }
}

if (rejected) {
  break;
}
```

This gives you the production shape used by larger coding agents:

- consecutive read-only tools can run together
- write/delete/shell tools run alone and in order
- every path still uses the same truncation, logging, wrapping, usage tracking, and history updates
- permission prompts stay sequential, so the UI does not need to handle multiple approval dialogs at once

If you later auto-approve read-only tools, you can skip `onToolApproval` for `batch.isConcurrencySafe`, but keep the shared execution helper.

### Minimal Test

Create two small files:

```bash
printf "A\n%.0s" {1..500} > parallel-a.md
printf "B\n%.0s" {1..500} > parallel-b.md
```

Start the app and ask:

```txt
Read parallel-a.md and parallel-b.md in one turn.
```

Approve both `readFile` calls if prompted. Then check `.agent/logs/agent.jsonl`.

For a parallel-safe batch, you should see both tool executions start before either one finishes:

```txt
tool_execution_started readFile parallel-a.md
tool_execution_started readFile parallel-b.md
tool_result readFile parallel-a.md
tool_result readFile parallel-b.md
```

That ordering is the useful signal. It means the runtime started the safe reads together instead of waiting for the first result before starting the second.

---

---
## 12. Real Tool Testing

### The Problem

Our evals use mocked tools. That's good for testing LLM behavior, but it doesn't test whether tools actually work. What if `readFile` breaks on Windows paths? What if `runCommand` hangs on certain inputs?

### The Fix

Add integration tests alongside mock-based evals:

Create an integration test file:

**Edit `tests/file-tools.test.ts`:**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import { executeTool } from "../src/agent/executeTool.ts";

describe("file tools (integration)", () => {
  const testDir = "/tmp/agent-test-" + Date.now();

  afterEach(async () => {
    // Clean up test files
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("writeFile creates parent directories", async () => {
    const filePath = `${testDir}/deep/nested/file.txt`;
    const result = await executeTool("writeFile", {
      path: filePath,
      content: "hello",
    });

    expect(result).toContain("Successfully wrote");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("hello");
  });

  it("readFile returns error for missing file", async () => {
    const result = await executeTool("readFile", {
      path: "/nonexistent/file.txt",
    });
    expect(result).toContain("File not found");
  });

  it("runCommand captures stderr", async () => {
    const result = await executeTool("runCommand", {
      command: "ls /nonexistent 2>&1",
    });
    expect(result).toContain("No such file");
  });
});
```

---
