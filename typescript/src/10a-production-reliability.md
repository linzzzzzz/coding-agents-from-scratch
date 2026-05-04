# Production Reliability

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
    tools,
  })
);
```

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

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  usageTracker: UsageTracker,
): Promise<ModelMessage[]> {
  let workingHistory = filterCompatibleMessages(conversationHistory);
  usageTracker.startTurn();

  const initialLimitCheck = usageTracker.check();
  if (!initialLimitCheck.ok) {
    const stopMessage = `\n[Agent stopped: ${initialLimitCheck.reason}]`;
    callbacks.onToken(stopMessage);
    callbacks.onComplete(stopMessage);
    return [
      ...workingHistory,
      { role: "user", content: userMessage },
      { role: "assistant", content: stopMessage.trim() },
    ];
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
        tools,
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

The user asks the agent to do something, then realizes it's wrong. There's no way to stop it mid-execution. The agent loop runs until the LLM finishes or a tool call gets rejected.

### The Fix

Use an `AbortController`:

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
      tools,
      abortSignal: signal, // Pass to AI SDK
    });

    // ...
  }
}
```

In the UI, wire Ctrl+C to the abort controller:

Add cancellation state and input handling to the Ink app:

**Edit `src/ui/App.tsx`:**

```typescript
const [abortController, setAbortController] = useState<AbortController | null>(null);

useInput((input, key) => {
  if (key.ctrl && input === "c" && abortController) {
    abortController.abort();
    setAbortController(null);
    setIsLoading(false);
  }
});

// When starting a request:
const controller = new AbortController();
setAbortController(controller);
await runAgent(userInput, history, callbacks, controller.signal);
```

---

## 9. Structured Logging

### The Problem

When something goes wrong in production, `console.log` isn't enough. You need to know which conversation, which tool call, what inputs, what the LLM decided, and why.

### The Fix

Create a logger helper:

**Edit `src/agent/logger.ts`:**

```typescript
interface LogEntry {
  timestamp: string;
  conversationId: string;
  event: "llm_call" | "tool_call" | "tool_result" | "error" | "approval";
  data: Record<string, unknown>;
}

class AgentLogger {
  private entries: LogEntry[] = [];

  constructor(private conversationId: string) {}

  log(event: LogEntry["event"], data: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      conversationId: this.conversationId,
      event,
      data,
    };
    this.entries.push(entry);

    // Write to file for persistence
    fs.appendFileSync(
      ".agent/logs/agent.jsonl",
      JSON.stringify(entry) + "\n",
    );
  }

  logToolCall(name: string, args: unknown): void {
    this.log("tool_call", { toolName: name, args });
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

Use JSONL (one JSON object per line) so logs can be streamed, grepped, and processed with standard tools.

---
