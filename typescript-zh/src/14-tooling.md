# 第 14 章：工具系统与测试

生产级 agents 需要工具输出限制、安全并行，以及真实集成测试，这样工具行为才能在 mocked evals 之外也保持可靠。

---

## 1. 工具结果大小限制

### 问题

对一个 10MB 日志文件调用 `readFile` 会返回完整内容。那大约是 270 万 token，远远超过任何 context window。API 调用会失败，或者整个对话变得不可用。

### 修复

创建一个 agent-level helper，在工具输出被送回模型之前先格式化：

**编辑 `src/agent/toolResults.ts`：**

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

这个文件放在 `run.ts` 旁边，因为它不是某个工具的实现。它属于 agent loop 基础设施，用来控制什么样的工具结果允许回到对话里。

在把每个工具结果加入 messages 之前应用它：

**编辑 `src/agent/run.ts`：**

```typescript
import { truncateResult } from "./toolResults.ts";

// ...

const rawToolResult = await executeTool(tc.toolName, tc.args);
const toolResult = truncateResult(rawToolResult);
```

`callbacks.onToolCallEnd(...)`、conversation history，以及任何送回模型的内容都使用 `toolResult`。只有在你需要完整本地日志或 debug 输出时，才保留 `rawToolResult`。

这属于 approval 之后的真实执行路径。模型仍然接收 `modelTools`；只有 agent loop 会调用可执行工具，并准备它们进入 history 的结果。

对于文件工具，额外加入分页：

**编辑 `src/agent/tools/file.ts`：**

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

### 最小测试

创建一个大型 mock Markdown 文件，用来检查文件工具分页：

```bash
node -e 'let s="# Large Test\n\n"; for (let i=1;i<=250;i++) s += `## Section ${i}\n${"x".repeat(400)}\n\n`; require("fs").writeFileSync("large-test.md", s)'
```

直接调用 `readFile` 工具：

```bash
node --import tsx/esm -e 'const { executeTool } = await import("./src/agent/executeTool.ts"); const result = await executeTool("readFile", { path: "large-test.md", limit: 200 }); console.log(result.split("\n").slice(-2).join("\n"));'
```

你应该看到分页 footer：

```txt
[Showing lines 1-200 of 753. Use offset to read more.]
```

检查下一页：

```bash
node --import tsx/esm -e 'const { executeTool } = await import("./src/agent/executeTool.ts"); const result = await executeTool("readFile", { path: "large-test.md", offset: 200, limit: 200 }); console.log(result.split("\n").slice(-2).join("\n"));'
```

预期 footer：

```txt
[Showing lines 201-400 of 753. Use offset to read more.]
```

这确认了文件工具会使用 `limit` 和 `offset` 切分结果。如果要专门测试 `truncateResult`，可以使用一个分页后仍然大于 `MAX_TOOL_RESULT_LENGTH` 的工具结果，或者临时调低 `MAX_TOOL_RESULT_LENGTH`。

---

## 2. 并行工具执行

### 问题

当 LLM 在一个 turn 里请求多个工具调用时（例如读取三个文件），我们会顺序执行它们。这没有必要那么慢，因为文件读取彼此独立。

### 修复

使用一个共享 helper 来执行已批准的真实工具调用，然后在它外面加一个小 scheduler。

如果想了解为什么这个形状和更大型 coding agents 相似，可以看 [工具编排参考](./14a-tool-orchestration-reference.md)。

**编辑 `src/agent/run.ts`：**

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

然后在 `runAgent` 里、靠近工具循环的位置，把共享执行工作抽成一个 helper。这个 helper 应该使用可执行工具注册表，而不是传给 `streamText()` 的 schema-only `modelTools`。

如果你的 logger 里还没有这个事件，先把 `"tool_execution_started"` 加到 `LogEvent` union，并给 `src/agent/logger.ts` 加上这个方法：

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

现在把旧的顺序 `for (const tc of toolCalls)` block 替换成批处理执行：

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

这给了你更大型 coding agents 使用的生产形状：

- 连续的只读工具可以一起运行
- write/delete/shell 工具单独且按顺序运行
- 每条路径仍然使用同一套截断、日志、包装、usage tracking 和 history 更新逻辑
- 权限提示保持顺序，所以 UI 不需要同时处理多个审批弹窗

如果之后你自动批准只读工具，可以对 `batch.isConcurrencySafe` 跳过 `onToolApproval`，但仍然保留共享执行 helper。

### 最小测试

创建两个小文件：

```bash
printf "A\n%.0s" {1..500} > parallel-a.md
printf "B\n%.0s" {1..500} > parallel-b.md
```

启动应用并询问：

```txt
Read parallel-a.md and parallel-b.md in one turn.
```

如果提示审批，批准两个 `readFile` 调用。然后检查 `.agent/logs/agent.jsonl`。

对于 parallel-safe batch，你应该看到两个工具执行都先开始，然后才有任意一个完成：

```txt
tool_execution_started readFile parallel-a.md
tool_execution_started readFile parallel-b.md
tool_result readFile parallel-a.md
tool_result readFile parallel-b.md
```

这个顺序就是有用信号。它说明 runtime 同时启动了安全读取，而不是等第一个结果回来后才启动第二个。

---

## 3. 真实工具测试

### 问题

我们的 evals 使用 mocked tools。这很适合测试 LLM 行为，但它不会测试工具本身是否真的工作。比如 `readFile` 在 Windows 路径上坏了怎么办？`runCommand` 在某些输入上挂住怎么办？

### 修复

在 mock-based evals 旁边加入 integration tests。把这些测试放在 `tests/`，而不是 `evals/`：evals 衡量模型是否选择了正确行为，而这些测试检查真实工具实现是否能在不涉及模型的情况下工作。

安装一个小型测试 runner：

```bash
npm install -D vitest
```

给 `package.json` 加一个测试 script：

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

创建一个 integration test 文件：

**编辑 `tests/file-tools.test.ts`：**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import { executeTool } from "../src/agent/executeTool.ts";

describe("file tools (integration)", () => {
  const testDir = ".agent-test";

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
      path: `${testDir}/missing.txt`,
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

运行：

```bash
npm test
```

---

**下一章：[第 15 章：Agent Planning →](./15-agent-planning.md)**
