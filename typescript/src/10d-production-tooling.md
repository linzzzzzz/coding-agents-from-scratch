# Production Tooling

Production agents need tool output limits, safe parallelism, and real integration tests so tool behavior stays reliable beyond mocked evals.

---

## 6. Tool Result Size Limits

### The Problem

`readFile` on a 10MB log file returns the entire content. That's ~2.7 million tokens — far more than any context window. The API call fails or the conversation becomes unusable.

### The Fix

Create a truncation helper:

**Edit `src/agent/toolResults.ts`:**

```typescript
const MAX_TOOL_RESULT_LENGTH = 50_000; // ~13k tokens

function truncateResult(result: string, maxLength: number = MAX_TOOL_RESULT_LENGTH): string {
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

Apply to every tool result before adding to messages:

**Edit `src/agent/run.ts`:**

```typescript
const rawResult = await executeTool(tc.toolName, tc.args);
const result = truncateResult(rawResult);
```

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
  execute: async ({ path: filePath, offset = 0, limit = 200 }) => {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const slice = lines.slice(offset, offset + limit);
    const totalLines = lines.length;

    let result = slice.join("\n");
    if (totalLines > limit) {
      result += `\n\n[Showing lines ${offset + 1}-${offset + slice.length} of ${totalLines}. Use offset to read more.]`;
    }
    return result;
  },
});
```

---

---
## 7. Parallel Tool Execution

### The Problem

When the LLM requests multiple tool calls in one turn (e.g., read three files), we execute them sequentially. This is unnecessarily slow — file reads are independent.

### The Fix

Change the tool execution section of the agent loop:

**Edit `src/agent/run.ts`:**

```typescript
// Before (sequential)
for (const tc of toolCalls) {
  const result = await executeTool(tc.toolName, tc.args);
  // ...
}

// After (parallel where safe)
const SAFE_TO_PARALLELIZE = new Set(["readFile", "listFiles", "webSearch"]);

const canParallelize = toolCalls.every((tc) =>
  SAFE_TO_PARALLELIZE.has(tc.toolName)
);

if (canParallelize) {
  const results = await Promise.all(
    toolCalls.map(async (tc) => ({
      tc,
      result: await executeTool(tc.toolName, tc.args),
    }))
  );

  for (const { tc, result } of results) {
    callbacks.onToolCallEnd(tc.toolName, result);
    messages.push({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text", value: result },
      }],
    });
  }
} else {
  // Fall back to sequential for write/delete/shell
  for (const tc of toolCalls) {
    // ... existing sequential logic with approval
  }
}
```

Read-only tools can always run in parallel. Write tools must stay sequential because order matters — and they need individual approval.

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
