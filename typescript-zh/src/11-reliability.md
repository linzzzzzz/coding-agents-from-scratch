# 第 11 章：可靠性

重试、限流、取消和结构化日志，可以让 agent 在 provider 失败、用户中断任务，或者使用规模开始增长时仍然可用。

---

## 1. 错误恢复与重试

### 问题

API 调用会失败。模型 provider 可能返回 429（rate limit）、500（server error），也可能直接超时。现在，一次失败的 `streamText()` 调用就会让整个 agent 崩掉。

### 修复

用指数退避包装 LLM 调用：

创建一个 helper 文件：

**编辑 `src/agent/retry.ts`：**

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as Error & { status?: number };

      // Don't retry client errors (400, 401, 403) — they won't succeed
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw error;
      }

      if (attempt === maxRetries) throw error;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
```

把它应用到每一次 LLM 调用：

**编辑 `src/agent/run.ts`：**

```typescript
const result = await withRetry(async () =>
  streamText({
    model: provider.chat(MODEL_NAME),
    messages,
    tools: modelTools,
  })
);
```

这里继续使用第 4 章里的、面向模型的 `modelTools`。重试应该重复模型请求，而不是意外地在 `streamText()` 里面执行真实工具。

### 继续加强

- 在可用时使用 AI SDK 内置的 retry 选项
- 实现 circuit breaker：如果 API 连续失败 5 次，就停止尝试并告诉用户
- 记录每次重试和时间戳，方便和 provider outage 对齐排查
- 设置每次调用的 timeout，不要让单次请求永远挂住

---

## 5. 限流与成本控制

### 问题

循环里的 agent 可能很快烧掉 API 额度。一个失控循环（工具失败 → agent 重试 → 再失败 → 再重试）可能在没人注意到之前花掉几百美元。

### 修复

我们已经在 `src/agent/context` 里追踪上下文使用情况：

- `tokenEstimator.ts` 估算消息历史中有多少 token。
- `modelLimits.ts` 把估算值和模型 context window 比较。
- `run.ts` 上报 context percentage，并在需要时触发压缩。

这回答的是：

```text
Are we close to the model's context window?
```

限流和成本控制回答的是另一个问题：

```text
Is this agent spending too much, looping too long, or calling too many tools?
```

把这些生产 guardrails 放在独立 helper 里，这样 `src/agent/context` 仍然专注于 context-window 管理。

创建一个 usage tracker：

**编辑 `src/agent/usage.ts`：**

```typescript
export interface UsageLimits {
  maxTokensPerConversation: number;
  maxToolCallsPerTurn: number;
  maxLoopIterationsPerTurn: number;
  maxCostPerConversation: number; // in dollars
}

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
  maxTokensPerConversation: 500_000,
  maxToolCallsPerTurn: 10,
  maxLoopIterationsPerTurn: 50,
  maxCostPerConversation: 5.00,
};

export class UsageTracker {
  private totalTokens = 0;
  private totalCost = 0;
  private toolCallsThisTurn = 0;
  private loopIterationsThisTurn = 0;

  constructor(private limits: UsageLimits) {}

  startTurn(): void {
    this.toolCallsThisTurn = 0;
    this.loopIterationsThisTurn = 0;
  }

  addTokens(count: number, isOutput: boolean): void {
    this.totalTokens += count;
    // Approximate cost (adjust rates per model)
    const rate = isOutput ? 0.000015 : 0.000005; // per token
    this.totalCost += count * rate;
  }

  addToolCall(): void {
    this.toolCallsThisTurn++;
  }

  addIteration(): void {
    this.loopIterationsThisTurn++;
  }

  check(): { ok: boolean; reason?: string } {
    if (this.totalTokens > this.limits.maxTokensPerConversation) {
      return { ok: false, reason: `Token limit exceeded (${this.totalTokens})` };
    }
    if (this.toolCallsThisTurn > this.limits.maxToolCallsPerTurn) {
      return { ok: false, reason: `Tool call limit exceeded (${this.toolCallsThisTurn})` };
    }
    if (this.loopIterationsThisTurn > this.limits.maxLoopIterationsPerTurn) {
      return { ok: false, reason: `Loop iteration limit exceeded (${this.loopIterationsThisTurn})` };
    }
    if (this.totalCost > this.limits.maxCostPerConversation) {
      return { ok: false, reason: `Cost limit exceeded ($${this.totalCost.toFixed(2)})` };
    }
    return { ok: true };
  }
}
```

这个 tracker 有意混合了两个 scope：

- `totalTokens` 和 `totalCost` 会贯穿整个对话持续累积。
- `toolCallsThisTurn` 和 `loopIterationsThisTurn` 会在每个用户 turn 重新开始。

这样能得到有用的生产行为：既能阻止单个失控 turn，也能在长对话不断累计总成本时及时停止。

在 UI 中创建 tracker，让它能跨多次 `runAgent` 调用保持状态。

**编辑 `src/ui/App.tsx`：**

```typescript
import { useRef } from "react";
import { DEFAULT_USAGE_LIMITS, UsageTracker } from "../agent/usage.ts";

function App() {
  const usageTrackerRef = useRef(new UsageTracker(DEFAULT_USAGE_LIMITS));

  // ...

  const newHistory = await runAgent(
    input,
    conversationHistory,
    callbacks,
    usageTrackerRef.current,
  );
}
```

然后让 agent loop 接收这个 tracker：

**编辑 `src/agent/run.ts`：**

```typescript
import type { UsageTracker } from "./usage.ts";

function withoutSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((message) => message.role !== "system");
}

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  usageTracker: UsageTracker,
): Promise<ModelMessage[]> {
  let workingHistory = withoutSystemMessages(
    filterCompatibleMessages(conversationHistory),
  );
  usageTracker.startTurn();

  const initialLimitCheck = usageTracker.check();
  if (!initialLimitCheck.ok) {
    const stopMessage = `\n[Agent stopped: ${initialLimitCheck.reason}]`;
    callbacks.onToken(stopMessage);
    callbacks.onComplete(stopMessage);
    return withoutSystemMessages([
      ...workingHistory,
      { role: "user", content: userMessage },
      { role: "assistant", content: stopMessage.trim() },
    ]);
  }

  // Now it is safe to do LLM-backed compaction if needed.
  // ...

  let fullResponse = "";

  while (true) {
    usageTracker.addIteration();
    const limitCheck = usageTracker.check();
    if (!limitCheck.ok) {
      const stopMessage = `\n[Agent stopped: ${limitCheck.reason}]`;
      callbacks.onToken(stopMessage);
      fullResponse += stopMessage;
      break;
    }

    const result = await withRetry(async () =>
      streamText({
        model: provider.chat(MODEL_NAME),
        messages,
        tools: modelTools,
      })
    );

    // ... stream text and collect tool calls

    const usage = await result.usage;
    usageTracker.addTokens(usage.inputTokens ?? 0, false);
    usageTracker.addTokens(usage.outputTokens ?? 0, true);

    for (const tc of toolCalls) {
      const approved = await callbacks.onToolApproval(tc.toolName, tc.args);
      if (!approved) {
        break;
      }

      usageTracker.addToolCall();
      const toolLimitCheck = usageTracker.check();
      if (!toolLimitCheck.ok) {
        const stopMessage = `\n[Agent stopped: ${toolLimitCheck.reason}]`;
        callbacks.onToken(stopMessage);
        fullResponse += stopMessage;
        break;
      }

      // ... execute each approved tool
    }
  }
}
```

`UsageTracker` 首字母大写，因为它是 class。实例命名为 `usageTracker`，因为变量使用 lower camel case。

关键是：每个被追踪的计数器都必须在事件发生的位置更新：

- 每个用户 turn 开始、agent loop 启动之前，调用一次 `startTurn()`。
- 在任何依赖 LLM 的压缩或生成工作之前，调用 `check()`。
- 每次 agent loop iteration 调用一次 `addIteration()`。
- LLM 响应报告 usage 后，调用 `addTokens(...)`。
- 工具审批通过、即将执行工具时调用 `addToolCall()`，然后立刻 check，确认可以运行。

### 最小测试

先在不调用 LLM 的情况下测试 tracker 本身：

```bash
cd /Users/flln/Desktop/dev/agents-v2

npx tsx --eval '
import { UsageTracker } from "./src/agent/usage.ts";

const tracker = new UsageTracker({
  maxTokensPerConversation: 100,
  maxToolCallsPerTurn: 1,
  maxLoopIterationsPerTurn: 2,
  maxCostPerConversation: 1,
});

tracker.startTurn();
console.log("start", tracker.check());

tracker.addToolCall();
console.log("one tool", tracker.check());

tracker.addToolCall();
console.log("two tools", tracker.check());

tracker.startTurn();
console.log("new turn", tracker.check());

tracker.addTokens(101, false);
console.log("tokens", tracker.check());
'
```

预期形状：

```text
start { ok: true }
one tool { ok: true }
two tools { ok: false, reason: 'Tool call limit exceeded (2)' }
new turn { ok: true }
tokens { ok: false, reason: 'Token limit exceeded (101)' }
```

然后做一个很小的工具调用 guard 集成测试。

临时降低 `src/agent/usage.ts` 里的限制：

```typescript
maxToolCallsPerTurn: 0,
```

运行应用：

```bash
npm run start
```

输入：

```text
Run pwd
```

预期结果：你批准工具调用后，agent 应该打印类似：

```text
[Agent stopped: Tool call limit exceeded (1)]
```

因为限制是 `0`，第一个被批准的工具调用会先被计数，然后立刻 check，并且在命令执行前被阻止。

最后测试 conversation-level 累积。

临时降低 `src/agent/usage.ts` 里的 token 限制：

```typescript
maxTokensPerConversation: 1,
```

运行应用：

```bash
npm run start
```

发送一条普通消息：

```text
hi
```

然后发送第二条消息：

```text
hi again
```

预期结果：第二个 turn 应该立刻停止，并显示类似：

```text
[Agent stopped: Token limit exceeded (...)]
```

这确认了 `UsageTracker` 被存储在 `runAgent` 外部，所以 token / cost 使用量能在同一个 UI session 的多个 turn 之间保留。

测试结束后，恢复正常限制。

### 继续加强

- 按用户和组织设置限制
- 每日 / 每月预算上限和邮件提醒
- 在执行昂贵操作前向用户展示成本估算
- 为每个工具调用实现 token budget，例如截断大型文件读取

---

## 8. 取消

### 问题

用户让 agent 做一件事，然后发现自己说错了。

Ctrl+C 可以杀掉整个 Node 进程，但生产级 agent 需要更温和的选项：取消当前模型 / 工具运行，清理 UI 状态，并在不破坏 session 的情况下把控制权还给 prompt。

### 修复

使用 `AbortController`。controller 放在 UI 里，它的 `signal` 会传给 agent runner。

为 agent runner 加入 `signal` 支持：

**编辑 `src/agent/run.ts`：**

```typescript
export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  signal?: AbortSignal, // NEW
): Promise<ModelMessage[]> {
  // ...

  while (true) {
    // Check for cancellation at the top of each loop
    if (signal?.aborted) {
      callbacks.onToken("\n[Cancelled by user]");
      break;
    }

    const result = streamText({
      model: provider.chat(MODEL_NAME),
      messages,
      tools: modelTools,
      abortSignal: signal, // Pass to AI SDK
    });

    // ...
  }
}
```

在 UI 里，把 Ctrl+C 接到 abort controller。

首先，在入口文件里禁用 Ink 默认的 Ctrl+C 退出行为。否则 Ink 会在你的 `useInput` handler 有机会取消当前 run 之前就退出应用。

**编辑 `src/index.ts`：**

```typescript
render(React.createElement(App), {
  exitOnCtrlC: false,
});
```

**编辑 `src/cli.ts`：**

```typescript
render(React.createElement(App), {
  exitOnCtrlC: false,
});
```

然后，如果 `App.tsx` 还没有导入 `useInput`，就加上：

```typescript
import { Box, Text, useApp, useInput } from "ink";
```

接着在 `App` 里的其他 `useState` 附近加入取消状态：

**编辑 `src/ui/App.tsx`：**

```typescript
const [abortController, setAbortController] = useState<AbortController | null>(null);
```

在 `App` 组件内部、state 声明之后、`handleSubmit` 之前加入 Ctrl+C handler：

```typescript
useInput((input, key) => {
  if (key.ctrl && input === "c") {
    if (abortController) {
      abortController.abort();
    } else {
      exit();
    }
  }
});
```

最后，在 `handleSubmit` 里、当前 `runAgent(...)` 调用之前创建 controller。不要把它放在组件顶层：

```typescript
const controller = new AbortController();
setAbortController(controller);

try {
  const newHistory = await runAgent(
    userInput,
    conversationHistory,
    {
      onToken: (token) => {
        setStreamingText((prev) => prev + token);
      },
      onToolCallStart: (name, args) => {
        // existing callback body
      },
      onToolCallEnd: (name, result) => {
        // existing callback body
      },
      onComplete: (response) => {
        // existing callback body
      },
      onToolApproval: (name, args) => {
        // existing callback body
      },
      onTokenUsage: (usage) => {
        setTokenUsage(usage);
      },
    },
    controller.signal,
  );

  setConversationHistory(newHistory);
} finally {
  setAbortController(null);
  setIsLoading(false);
}
```

位置很重要：

- `exitOnCtrlC: false` 放在 Ink 的 `render(...)` options 里，这样由应用而不是 Ink 决定 Ctrl+C 的含义。
- `useState` 放在 `App` 顶部，和其他 state 放在一起。
- `useInput` 放在 `App` 内部，但在 `handleSubmit` 外部。
- `new AbortController()` 放在 `handleSubmit` 内部，紧挨着当前 `runAgent(...)` 调用之前。
- `controller.signal` 作为第四个参数传给 `runAgent`。
- Ctrl+C handler 只调用 `abort()`，不直接清理 loading state。
- `finally` 会在 `runAgent` 真正 unwind 后清理 controller 和 loading state。

### 最小测试

运行应用：

```bash
npm run start
```

提交一个需要一点时间的 prompt：

```txt
help me draft something 50 words
```

当 UI 显示 `Thinking...` 时，按 Ctrl+C。

预期行为：

- 应用不会立刻退出。
- 当前 run 被取消。
- 输入 prompt 重新可用。
- 空闲时再次按 Ctrl+C 会退出应用。

### 继续加强

这是基础取消。它给 UI 提供了一个请求停止当前模型调用的方式，但并不会让 agent 的每一部分都完全 cancellation-safe。

剩余的加固在 `runAgent` 和工具内部：

- 不只在外层 agent loop 顶部检查 `signal.aborted`，也要在 streaming loop 内部检查。
- 把 `result.fullStream` 抛出的 abort error 当作取消，而不是普通失败。
- 取消后避免继续等待 `result.finishReason`、`result.usage` 或 `result.response`。
- 取消发生时 resolve pending tool approvals。
- 把 cancellation 传给长时间运行的工具，尤其是 shell 命令和代码执行。

这些是生产级加固步骤。上面的最小版本已经足够区分“取消这次运行”和“退出整个应用”，这是用户首先会期待的行为。

---

## 9. 结构化日志

### 问题

生产环境出问题时，`console.log` 不够。你需要知道是哪段对话、哪个工具调用、什么输入、LLM 做了什么决定，以及为什么。

### 修复

创建一个小的 JSONL logger，然后接到 `runAgent`。

JSONL 的意思是“一行一个 JSON 对象”。它很容易 append、stream、grep，也方便后续导入其他工具。

**编辑 `src/agent/logger.ts`：**

```typescript
import { appendFileSync, mkdirSync } from "node:fs";

type LogEvent =
  | "agent_run_started"
  | "agent_run_completed"
  | "llm_call_started"
  | "llm_call_completed"
  | "tool_call"
  | "tool_execution_started"
  | "tool_result"
  | "approval"
  | "error";

interface LogEntry {
  timestamp: string;
  conversationId: string;
  runId: string;
  event: LogEvent;
  data: Record<string, unknown>;
}

export class AgentLogger {
  private entries: LogEntry[] = [];
  private logPath = ".agent/logs/agent.jsonl";

  constructor(
    private conversationId: string,
    private runId: string,
  ) {
    mkdirSync(".agent/logs", { recursive: true });
  }

  log(event: LogEvent, data: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      conversationId: this.conversationId,
      runId: this.runId,
      event,
      data,
    };

    this.entries.push(entry);

    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  logToolCall(name: string, args: unknown): void {
    this.log("tool_call", { toolName: name, args });
  }

  logToolExecutionStarted(name: string, args: unknown): void {
    this.log("tool_execution_started", { toolName: name, args });
  }

  logToolResult(name: string, result: string, durationMs: number): void {
    this.log("tool_result", {
      toolName: name,
      resultLength: result.length,
      durationMs,
    });
  }

  logError(error: Error, context: string): void {
    this.log("error", {
      message: error.message,
      stack: error.stack,
      context,
    });
  }
}
```

这个 logger 有意保持朴素。它写入本地 JSONL，按需创建目录，并同时包含一个 `conversationId` 和每个 turn 的 `runId`。

### 接入 `runAgent`

**编辑 `src/agent/run.ts`：**

加入 import：

```typescript
import { randomUUID } from "node:crypto";
import { AgentLogger } from "./logger.ts";
```

在 `runAgent` 顶部附近创建 logger：

```typescript
export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  usageTracker: UsageTracker,
  signal?: AbortSignal,
): Promise<ModelMessage[]> {
  const logger = new AgentLogger("default", randomUUID());

  logger.log("agent_run_started", {
    model: MODEL_NAME,
    historyLength: conversationHistory.length,
    userMessageLength: userMessage.length,
  });

  try {
    // existing runAgent logic goes here
  } catch (error) {
    logger.logError(error as Error, "runAgent");
    throw error;
  }
}
```

在真实文件里，不要删除已有的 `runAgent` body。加入 `logger`，记录 `agent_run_started`，然后把已有 body 包进 `try` block，这样失败会在重新抛给 UI 之前先被记录。

现在 `"default"` 对应应用保存 conversation 时使用的 id。之后如果支持多对话，可以把真实 conversation id 传进 `runAgent`。

### 记录模型调用

在 `streamText` 前记录模型请求开始：

```typescript
logger.log("llm_call_started", {
  model: MODEL_NAME,
  messageCount: messages.length,
});

const result = await withRetry(async () =>
  streamText({
    model: provider.chat(MODEL_NAME),
    messages,
    tools: modelTools,
    allowSystemInMessages: true,
    experimental_telemetry: {
      isEnabled: true,
      tracer: getTracer(),
    },
    abortSignal: signal,
  }),
);
```

usage 可用后，记录结果：

```typescript
const usage = await result.usage;
usageTracker.addTokens(usage.inputTokens ?? 0, false);
usageTracker.addTokens(usage.outputTokens ?? 0, true);

logger.log("llm_call_completed", {
  finishReason,
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  toolCallCount: toolCalls.length,
});
```

### 记录工具调用和审批

当 stream 报告工具调用时，在通知 UI 的同一个位置记录它：

```typescript
if (chunk.type === "tool-call") {
  const input = "input" in chunk ? chunk.input : {};
  toolCalls.push({
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    args: input as Record<string, unknown>,
  });

  logger.logToolCall(chunk.toolName, input);
  callbacks.onToolCallStart(chunk.toolName, input);
}
```

请求人工审批时，记录工具是否被批准：

```typescript
const approved = await callbacks.onToolApproval(tc.toolName, tc.args);

logger.log("approval", {
  toolName: tc.toolName,
  approved,
});

if (!approved) {
  rejected = true;
  break;
}
```

在 `executeTool` 周围测量真实工具耗时：

```typescript
const toolStart = Date.now();
const toolResult = await executeTool(tc.toolName, tc.args);
const durationMs = Date.now() - toolStart;

logger.logToolResult(tc.toolName, toolResult, durationMs);
callbacks.onToolCallEnd(tc.toolName, toolResult);
```

run 结束时记录完成：

```typescript
callbacks.onComplete(fullResponse);

logger.log("agent_run_completed", {
  responseLength: fullResponse.length,
  messageCount: messages.length,
});

return withoutSystemMessages(messages);
```

### 最小测试

运行应用：

```bash
npm run start
```

让它做一个使用模型或工具的请求。然后查看日志：

```bash
tail -n 20 .agent/logs/agent.jsonl
```

你应该看到类似事件：

```json
{"timestamp":"...","conversationId":"default","runId":"...","event":"agent_run_started","data":{"model":"...","historyLength":0,"userMessageLength":24}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"llm_call_started","data":{"model":"...","messageCount":2}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"llm_call_completed","data":{"finishReason":"stop","inputTokens":123,"outputTokens":45,"toolCallCount":0}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"agent_run_completed","data":{"responseLength":280,"messageCount":3}}
```

### 隐私提醒

这个版本会记录 metadata、长度、工具名和工具参数。在真实产品里，要小心原始工具参数，因为它们可能包含文件路径、密钥或用户内容。更强的生产 logger 应该在写入前对敏感字段做 redaction。

---
