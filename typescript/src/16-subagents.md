# Chapter 16: Subagents

Production coding agents usually do not route the entire user turn to a different top-level agent. They keep one primary agent in charge of the conversation, then let that agent delegate bounded work to specialized subagents.

This is closer to how OpenCode and Claude Code work. OpenCode has primary agents and subagents, with a Task tool that creates child sessions. Claude Code has an Agent tool that can launch specialized agents with their own prompt, tools, context, and permissions.

---

## The Problem

One agent with one prompt eventually becomes overloaded:

- It needs to plan, implement, review, research, and test
- Long searches and tool output can fill the main conversation context
- Some tasks need read-only permissions while others need write access
- A second opinion is useful after risky changes

Subagents solve this by giving the primary agent a controlled way to say: "I need a focused helper for this bounded task."

---

## The Shape

The production pattern is:

1. The primary agent stays in the main conversation.
2. The primary agent calls a `delegateToSubagent` tool.
3. The tool runs a separate model call with a narrower system prompt and scoped context.
4. The subagent returns one concise result.
5. The primary agent decides what to do with that result.

This is different from a simple router. A router chooses one agent to own the whole turn. A subagent tool lets the main agent remain the coordinator.

---

## Define Subagents

Create a subagent type:

**Edit `src/agent/subagents/types.ts`:**

```typescript
import type { ModelMessage } from "ai";
import type { ToolName } from "../executeTool.ts";

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: ToolName[];
  buildContext?: (input: {
    task: string;
    history: ModelMessage[];
  }) => ModelMessage[];
}
```

`allowedTools` is the important production detail. A reviewer or explorer should not automatically inherit every tool the main agent has.

---

## Create Subagent Registry

Start with one useful subagent: a read-only reviewer.

**Edit `src/agent/subagents/registry.ts`:**

```typescript
import type { SubagentDefinition } from "./types.ts";

export const SUBAGENTS: Record<string, SubagentDefinition> = {
  reviewer: {
    name: "reviewer",
    description: "Reviews code changes for bugs, regressions, and missing tests.",
    allowedTools: ["readFile", "listFiles"],
    systemPrompt: `You are a code review subagent.

Find concrete bugs, regressions, missing tests, and risky assumptions.
Do not rewrite code unless explicitly asked.
Return concise findings with file paths when possible.`,
  },

  explorer: {
    name: "explorer",
    description: "Searches and reads the codebase to answer focused questions.",
    allowedTools: ["readFile", "listFiles"],
    systemPrompt: `You are a read-only exploration subagent.

Search the codebase, read relevant files, and answer the assigned question.
Do not edit, create, delete, or move files.
Return only the findings the primary agent needs.`,
  },
};
```

---

## Run a Subagent

In production, a subagent should not be a totally separate one-shot completion. It should reuse the same agent loop as the primary agent, with a different system prompt, scoped tools, isolated history, and quieter callbacks.

That is the key OpenCode / Claude Code idea: a subagent is still an agent run.

First, make `runAgent()` configurable.

**Edit `src/agent/run.ts`:**

```typescript
import { tools as baseTools } from "./tools/index.ts";

type AgentToolSet = Partial<typeof baseTools>;

export interface RunAgentConfig {
  agentName?: string;
  systemPromptOverride?: string;
  toolsOverride?: AgentToolSet;
  includeMemories?: boolean;
  startNewTurn?: boolean;
}
```

Then add the run config parameter to `runAgent()`:

**Edit `src/agent/run.ts`:**

```typescript
export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  usageTracker: UsageTracker,
  planState: PlanState,
  signal?: AbortSignal,
  runConfig: RunAgentConfig = {},
): Promise<ModelMessage[]> {
```

Inside `runAgent()`, use that run config:

**Edit `src/agent/run.ts`:**

```typescript
const memories = runConfig.includeMemories === false ? [] : await loadMemories();
const memoryText = memories.map((memory) => `- ${memory.content}`).join("\n");

const baseSystemPrompt =
  runConfig.systemPromptOverride ?? buildSystemPrompt(planState);

const systemPrompt = memoryText
  ? `${baseSystemPrompt}

Known user memories:
${memoryText}`
  : baseSystemPrompt;

const logger = new AgentLogger(runConfig.agentName ?? "default", randomUUID());
```

Then guard the per-turn reset:

**Edit `src/agent/run.ts`:**

```typescript
if (runConfig.startNewTurn !== false) {
  usageTracker.startTurn();
}
```

Top-level user turns should start a fresh usage turn. Subagent runs should not, because delegated work is still part of the same user request.

Later in this chapter, you will create `executionTools`. Pass a schema-only copy to the model:

**Edit `src/agent/run.ts`:**

```typescript
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

Now `runAgent()` can still power the main assistant, but it can also power a subagent.

---

## Execute the Active Tool Set

Earlier, `executeTool()` could assume there was one global tool registry. That is no longer true. The main agent gets `baseTools` plus `delegateToSubagent`, while subagents get only their scoped tools.

Refactor the executor so it can execute from any tool set:

**Edit `src/agent/executeTool.ts`:**

```typescript
import { tools as baseTools } from "./tools/index.ts";

export type ToolSet = Partial<typeof baseTools>;
export type ToolName = keyof typeof baseTools;

export async function executeToolFromSet(
  tools: ToolSet,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const selectedTool = tools[name as keyof typeof tools];

  if (!selectedTool) {
    return `Unknown tool: ${name}`;
  }

  const execute = selectedTool.execute;
  if (!execute) {
    return `Provider tool ${name} - executed by model provider`;
  }

  const result = await execute(args as never, {
    toolCallId: "",
    messages: [],
  });

  return String(result);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return executeToolFromSet(baseTools, name, args);
}
```

The important production rule is: execute from the active executable tool set for this run. The model receives the schema-only copy; the loop executes from the real tool set after approval.

Then update the agent loop:

**Edit `src/agent/run.ts`:**

```typescript
import { executeToolFromSet } from "./executeTool.ts";
```

And inside `executeApprovedToolCall()`:

```typescript
const rawToolResult = await executeToolFromSet(
  executionTools,
  tc.toolName,
  tc.args,
);
```

This keeps dynamic tools like `delegateToSubagent` on the real execution path without letting the AI SDK execute them automatically inside `streamText()`.

---

## Run a Subagent with the Agent Loop

The subagent wrapper chooses context and tools, then calls `runAgent()` recursively.

Keep this wrapper in `src/agent/run.ts` for now. If `run.ts` imports a delegation tool, and that delegation tool imports `runSubagent()`, and `runSubagent()` imports `runAgent()`, you create a circular import. Keeping the wrapper near `runAgent()` avoids that while the course is still small.

**Edit `src/agent/run.ts`:**

```typescript
import { tool } from "ai";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { UsageTracker } from "./usage.ts";
import type { AgentCallbacks } from "../types.ts";
import { SUBAGENTS } from "./subagents/registry.ts";
import type { SubagentDefinition } from "./subagents/types.ts";

function pickTools(subagent: SubagentDefinition) {
  return Object.fromEntries(
    subagent.allowedTools.map((name) => [name, baseTools[name]]),
  );
}

async function runSubagent(
  subagent: SubagentDefinition,
  task: string,
  history: ModelMessage[],
  parentCallbacks: AgentCallbacks,
  usageTracker: UsageTracker,
  signal?: AbortSignal,
): Promise<string> {
  let finalResponse = "";
  const context = subagent.buildContext
    ? subagent.buildContext({ task, history })
    : history.slice(-6);

  const callbacks: AgentCallbacks = {
    onToken: () => {},
    onComplete: (response) => {
      finalResponse = response;
    },
    onToolCallStart: (name, args) => {
      parentCallbacks.onToolCallStart(`${subagent.name}.${name}`, args);
    },
    onToolCallEnd: (name, result) => {
      parentCallbacks.onToolCallEnd(`${subagent.name}.${name}`, result);
    },
    onToolApproval: (name, args) =>
      parentCallbacks.onToolApproval(`${subagent.name}.${name}`, args),
  };

  await runAgent(
    task,
    context,
    callbacks,
    usageTracker,
    { mode: "build" },
    signal,
    {
      agentName: subagent.name,
      systemPromptOverride: subagent.systemPrompt,
      toolsOverride: pickTools(subagent),
      includeMemories: false,
      startNewTurn: false,
    },
  );

  return finalResponse;
}
```

The subagent uses the same loop as the main agent. The differences are configuration: smaller history, subagent prompt, scoped tools, no memory injection, and callbacks that do not stream subagent tokens directly into the main UI.

Pass the same `usageTracker` into the subagent and set `startNewTurn: false`. Delegated work is still part of the same user turn, so it should count against the same token, cost, loop, and tool-call budget.

---

## Add a Delegation Tool

The primary agent needs a tool it can call. Create it inside `runAgent()` so it can capture the current `workingHistory`, callbacks, and abort signal.

**Edit `src/agent/run.ts`:**

```typescript
const executionTools = runConfig.toolsOverride ?? {
  ...baseTools,
  delegateToSubagent: tool({
    description:
      "Delegate a bounded task to a specialized subagent. Use this for focused review, exploration, or second opinions.",
    inputSchema: z.object({
      subagent: z.enum(["reviewer", "explorer"]),
      task: z.string().describe("The complete task for the subagent."),
    }),
    async execute({ subagent, task }) {
      return runSubagent(
        SUBAGENTS[subagent],
        task,
        workingHistory,
        callbacks,
        usageTracker,
        signal,
      );
    },
  }),
};

const modelTools = withoutToolExecutors(executionTools);
```

Notice that the primary agent must give the subagent a complete task. A fresh subagent should not need to guess what the user wants.

If your file already imports `tools` directly, rename that import to `baseTools`. That keeps the existing static tool registry intact while adding one dynamic tool for the current turn.

The split matters here. `executionTools` contains real `execute` functions, including `delegateToSubagent`. `modelTools` is what goes to `streamText()`, so the model can request delegation but the loop still controls approval and execution.

---

## When to Use Subagents

Good uses:

- Review the current diff for bugs
- Explore a broad code question while the primary agent keeps context clean
- Get a second opinion before risky implementation work
- Run a focused verification pass after a change

Bad uses:

- Reading one known file
- Searching one exact string
- Every normal user turn
- Tasks where the primary agent needs every intermediate result

Delegation has overhead. Use it when isolation, focus, or parallel work is worth the extra model call.

---

## Minimal Test

Ask the agent:

```text
Use the reviewer subagent to review src/agent/run.ts for bugs or risky assumptions. Do not change files.
```

Expected behavior:

- The primary agent calls `delegateToSubagent`
- The subagent receives a focused review task
- The subagent only uses read-only tools, such as `reviewer.readFile`
- The final answer summarizes review findings
- No files are changed

You can confirm no files changed with:

```bash
git diff --stat
```

---

## Going Further

Production tools add more around this basic shape:

- Child sessions or side transcripts for subagent runs
- Resumable subagents with a `task_id`
- Background subagents for long-running work
- Worktree isolation for implementation agents
- Permission rules per subagent type
- Router agents, supervisor agents, and pipelines

Those are extensions. The core production idea is already here: the primary agent coordinates, and specialized subagents handle bounded work.

---
