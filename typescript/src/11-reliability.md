# Chapter 11: Reliability

Retries, rate limits, cancellation, and structured logging keep the agent useful when providers fail, users interrupt work, or usage starts to scale.

---

## 1. Error Recovery & Retries

### The Problem

API calls fail. Your model provider can return 429 (rate limit), 500 (server error), or just time out. Right now, one failed `streamText()` call crashes the entire agent.

### The Fix

Wrap LLM calls with exponential backoff:

Create a helper file:

**Edit `src/agent/retry.ts`:**

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

Apply it to every LLM call:

**Edit `src/agent/run.ts`:**

```typescript
const result = await withRetry(async () =>
  streamText({
    model: provider.chat(MODEL_NAME),
    messages,
    tools: modelTools,
  })
);
```

Keep using the model-facing `modelTools` from Chapter 4 here. Retries should repeat the model request, not accidentally execute real tools inside `streamText()`.

### Going Further

- Use the AI SDK's built-in retry options where available
- Implement circuit breakers — if the API fails 5 times in a row, stop trying and tell the user
- Log every retry with timestamps so you can correlate with provider outages
- Set per-call timeouts (don't let a single request hang forever)

---

## 5. Rate Limiting & Cost Controls

### The Problem

An agent in a loop can burn through API credits fast. A runaway loop (tool fails → agent retries → fails again → retries) could cost hundreds of dollars before anyone notices.

### The Fix

We already track context usage in `src/agent/context`:

- `tokenEstimator.ts` estimates how many tokens are in the message history.
- `modelLimits.ts` compares that estimate against the model context window.
- `run.ts` reports context percentage and triggers compaction when needed.

That answers:

```text
Are we close to the model's context window?
```

Rate limiting and cost controls answer a different question:

```text
Is this agent spending too much, looping too long, or calling too many tools?
```

Keep those production guardrails in a separate helper so `src/agent/context` stays focused on context-window management.

Create a usage tracker:

**Edit `src/agent/usage.ts`:**

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

This tracker intentionally mixes two scopes:

- `totalTokens` and `totalCost` persist across the whole conversation.
- `toolCallsThisTurn` and `loopIterationsThisTurn` reset for each user turn.

That gives you the useful production behavior: stop one runaway turn, but also stop a long conversation if total cost keeps accumulating.

Create the tracker in the UI so it survives across multiple calls to `runAgent`.

**Edit `src/ui/App.tsx`:**

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

Then accept the tracker in the agent loop:

**Edit `src/agent/run.ts`:**

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

`UsageTracker` is capitalized because it is a class. The instance is named `usageTracker` because variables use lower camel case.

The important thing is that every tracked counter must be updated where the event happens:

- Call `startTurn()` once per user turn, before the agent loop starts.
- Call `check()` before any LLM-backed compaction or generation work.
- Call `addIteration()` once per agent loop iteration.
- Call `addTokens(...)` after an LLM response reports usage.
- Call `addToolCall()` after approval, when a tool call is about to be executed, then check immediately before running it.

### Minimal Test

First test the tracker itself without calling an LLM:

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

Expected shape:

```text
start { ok: true }
one tool { ok: true }
two tools { ok: false, reason: 'Tool call limit exceeded (2)' }
new turn { ok: true }
tokens { ok: false, reason: 'Token limit exceeded (101)' }
```

Then do a tiny integration test for the tool-call guard.

Temporarily lower the limit in `src/agent/usage.ts`:

```typescript
maxToolCallsPerTurn: 0,
```

Run the app:

```bash
npm run start
```

Ask:

```text
Run pwd
```

Expected result: after you approve the tool call, the agent should print something like:

```text
[Agent stopped: Tool call limit exceeded (1)]
```

Because the limit is `0`, the first approved tool call is counted, checked immediately, and blocked before the command executes.

Finally test conversation-level accumulation.

Temporarily lower the token limit in `src/agent/usage.ts`:

```typescript
maxTokensPerConversation: 1,
```

Run the app:

```bash
npm run start
```

Send one normal message:

```text
hi
```

Then send a second message:

```text
hi again
```

Expected result: the second turn should stop immediately with something like:

```text
[Agent stopped: Token limit exceeded (...)]
```

This confirms `UsageTracker` is stored outside `runAgent`, so token/cost usage survives across multiple turns in the same UI session.

After testing, restore the normal limits.

### Going Further

- Per-user and per-organization limits
- Daily/monthly budget caps with email alerts
- Show cost estimates to users before expensive operations
- Implement token budgets per tool call (truncate large file reads)

---

## 8. Cancellation

### The Problem

The user asks the agent to do something, then realizes it's wrong.

Ctrl+C can kill the whole Node process, but production agents need a gentler option: cancel the current model/tool run, clean up UI state, and return control to the prompt without corrupting the session.

### The Fix

Use an `AbortController`. The controller lives in the UI, and its `signal` is passed into the agent runner.

Add `signal` support to the agent runner:

**Edit `src/agent/run.ts`:**

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

In the UI, wire Ctrl+C to the abort controller.

First, disable Ink's default Ctrl+C exit behavior in the entry files. Otherwise Ink exits the app before your `useInput` handler gets a chance to cancel the active run.

**Edit `src/index.ts`:**

```typescript
render(React.createElement(App), {
  exitOnCtrlC: false,
});
```

**Edit `src/cli.ts`:**

```typescript
render(React.createElement(App), {
  exitOnCtrlC: false,
});
```

Then import `useInput` if `App.tsx` does not already import it:

```typescript
import { Box, Text, useApp, useInput } from "ink";
```

Then add cancellation state near the other `useState` calls inside `App`:

**Edit `src/ui/App.tsx`:**

```typescript
const [abortController, setAbortController] = useState<AbortController | null>(null);
```

Add the Ctrl+C handler inside the `App` component, after the state declarations and before `handleSubmit`:

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

Finally, create the controller inside `handleSubmit`, immediately before the `runAgent(...)` call. Do not put this at the top level of the component:

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

The placement matters:

- `exitOnCtrlC: false` belongs in the Ink `render(...)` options so the app, not Ink, decides what Ctrl+C means.
- `useState` belongs at the top of `App`, next to the other state.
- `useInput` belongs inside `App`, but outside `handleSubmit`.
- `new AbortController()` belongs inside `handleSubmit`, right before the current `runAgent(...)` call.
- `controller.signal` is passed as the fourth argument to `runAgent`.
- The Ctrl+C handler only calls `abort()`. It does not clear loading state directly.
- `finally` clears the controller and loading state after `runAgent` actually unwinds.

### Minimal Test

Run the app:

```bash
npm run start
```

Submit a prompt that takes a moment:

```txt
help me draft something 50 words
```

While the UI shows `Thinking...`, press Ctrl+C.

Expected behavior:

- The app does not immediately exit.
- The current run is cancelled.
- The input prompt becomes usable again.
- Pressing Ctrl+C again while idle exits the app.

### Going Further

This is basic cancellation. It gives the UI a way to ask the active model request to stop, but it does not make every part of the agent fully cancellation-safe.

The remaining hardening is inside `runAgent` and tools:

- Check `signal.aborted` inside the streaming loop, not only at the top of the outer agent loop.
- Treat abort errors from `result.fullStream` as cancellation, not normal failures.
- Avoid waiting on `result.finishReason`, `result.usage`, or `result.response` after cancellation.
- Resolve pending tool approvals when cancellation happens.
- Pass cancellation into long-running tools, especially shell commands and code execution.

Those are production hardening steps. The minimal version above is enough to distinguish "cancel this run" from "exit the whole app," which is the first behavior users expect.

---

## 9. Structured Logging

### The Problem

When something goes wrong in production, `console.log` isn't enough. You need to know which conversation, which tool call, what inputs, what the LLM decided, and why.

### The Fix

Create a small JSONL logger, then wire it into `runAgent`.

JSONL means "one JSON object per line." It is easy to append, stream, grep, and import into other tools later.

**Edit `src/agent/logger.ts`:**

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

This logger is intentionally boring. It writes local JSONL, creates the directory if needed, and includes both a `conversationId` and a per-turn `runId`.

### Wire It Into `runAgent`

**Edit `src/agent/run.ts`:**

Add the imports:

```typescript
import { randomUUID } from "node:crypto";
import { AgentLogger } from "./logger.ts";
```

Create a logger near the top of `runAgent`:

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

In the real file, do not delete the existing `runAgent` body. Add the `logger`, log `agent_run_started`, and wrap the existing body in the `try` block so failures are logged before they are re-thrown to the UI.

For now, `"default"` matches the saved conversation id used by the app. Later, if you support multiple conversations, pass the real conversation id into `runAgent` instead.

### Log The Model Call

Before `streamText`, log that the model request is starting:

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

After usage is available, log the result:

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

### Log Tool Calls And Approvals

When the stream reports a tool call, log it at the same place you notify the UI:

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

When asking for human approval, log whether the tool was approved:

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

Around `executeTool`, measure how long the real tool took:

```typescript
const toolStart = Date.now();
const toolResult = await executeTool(tc.toolName, tc.args);
const durationMs = Date.now() - toolStart;

logger.logToolResult(tc.toolName, toolResult, durationMs);
callbacks.onToolCallEnd(tc.toolName, toolResult);
```

At the end of the run, log completion:

```typescript
callbacks.onComplete(fullResponse);

logger.log("agent_run_completed", {
  responseLength: fullResponse.length,
  messageCount: messages.length,
});

return withoutSystemMessages(messages);
```

### Minimal Test

Run the app:

```bash
npm run start
```

Ask for something that uses either the model or a tool. Then inspect the log:

```bash
tail -n 20 .agent/logs/agent.jsonl
```

You should see events like:

```json
{"timestamp":"...","conversationId":"default","runId":"...","event":"agent_run_started","data":{"model":"...","historyLength":0,"userMessageLength":24}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"llm_call_started","data":{"model":"...","messageCount":2}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"llm_call_completed","data":{"finishReason":"stop","inputTokens":123,"outputTokens":45,"toolCallCount":0}}
{"timestamp":"...","conversationId":"default","runId":"...","event":"agent_run_completed","data":{"responseLength":280,"messageCount":3}}
```

### Privacy Note

This version logs metadata, lengths, tool names, and tool arguments. In a real product, be careful with raw tool arguments because they may contain file paths, secrets, or user content. A stronger production logger would redact sensitive fields before writing them.

---
