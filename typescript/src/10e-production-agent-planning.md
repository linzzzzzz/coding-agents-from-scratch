# Production Agent Planning

Planning helps the agent handle larger tasks by making work explicit, reviewable, and gated before execution.

---

## 10. Agent Planning

### The Problem

Our agent is reactive — it decides one step at a time. Ask it to "refactor the auth module," and it might start editing files without understanding the full scope. It has no plan.

### The Fix

Production tools usually treat planning as a mode transition, not just a prompt.
OpenCode and Claude Code both separate "planning" from "building": planning is
read-only, produces a reviewable plan, and only exits after the user approves.

Model the agent as a small state machine.

**Create `src/agent/mode.ts`:**

```typescript
export type AgentMode = "build" | "plan";

export type PlanState = {
  mode: AgentMode;
  approvedPlan?: string;
};
```

Store that state in the UI and use an explicit `/plan` command to enter plan
mode. This is simpler than asking the model to decide when planning is needed.

**Edit `src/ui/App.tsx`:**

```typescript
import type { PlanState } from "../agent/mode.ts";

const [planState, setPlanState] = useState<PlanState>({ mode: "build" });
```

Handle `/plan` before calling the agent:

**Edit `src/ui/App.tsx`:**

```typescript
const planPrefix = "/plan ";
const isPlanCommand = userInput.startsWith(planPrefix);

const agentInput = isPlanCommand
  ? userInput.slice(planPrefix.length)
  : userInput;

const runPlanState: PlanState = isPlanCommand
  ? { mode: "plan" }
  : planState;

if (isPlanCommand) {
  setPlanState(runPlanState);
}
```

`runPlanState` is the mode for this immediate agent call. `setPlanState` updates
the UI state for future turns.

In plan mode, the agent can inspect the project but should not modify it:

**Edit `src/agent/system/prompt.ts`:**

```typescript
export const PLAN_MODE_PROMPT = `You are in plan mode.

You may read files, search the codebase, and ask clarifying questions.
You must not write, edit, delete, install dependencies, commit, or run commands
that change project state.

Create a concise implementation plan that includes:
1. What will change
2. Which files are likely involved
3. Risks or open questions
4. How the change should be verified

If you need clarification, ask 1-3 specific questions and stop.
When the plan is ready, ask the user to approve it before implementation.`;
```

Keep a separate execution prompt for after approval:

**Edit `src/agent/system/prompt.ts`:**

```typescript
import type { PlanState } from "../mode.ts";

export function buildSystemPrompt(state: PlanState): string {
  if (state.mode === "plan") {
    return SYSTEM_PROMPT + "\n\n" + PLAN_MODE_PROMPT;
  }

  if (state.approvedPlan) {
    return `${SYSTEM_PROMPT}

Approved implementation plan:
${state.approvedPlan}

Follow this plan unless new information makes it unsafe or incorrect.`;
  }

  return SYSTEM_PROMPT;
}
```

Pass the plan state into the agent loop:

**Edit `src/agent/run.ts`:**

```typescript
import type { PlanState } from "./mode.ts";
import { buildSystemPrompt } from "./system/prompt.ts";

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
  usageTracker: UsageTracker,
  planState: PlanState,
  signal?: AbortSignal,
): Promise<ModelMessage[]> {
  const baseSystemPrompt = buildSystemPrompt(planState);
  const memories = await loadMemories();
  const memoryText = memories.map((memory) => `- ${memory.content}`).join("\n");

  const systemPrompt = memoryText
    ? `${baseSystemPrompt}

Known user memories:
${memoryText}`
    : baseSystemPrompt;

  // ...
}
```

Use `buildSystemPrompt(planState)` as the base prompt, then append memory. That
keeps the existing memory feature working in both build mode and plan mode.

Because plan mode changes the system prompt, make sure `runAgent()` returns and
saves durable conversation history only. The `PLAN_MODE_PROMPT` should be added
fresh for the current run, never persisted into saved history.

This is why the earlier `withoutSystemMessages()` helper matters: if an old
`PLAN_MODE_PROMPT` is saved into history, later build-mode turns may still act
like plan mode.

Also block write-like tools while planning. The prompt tells the model not to
modify files, but the runtime should enforce the rule too.

**Edit `src/agent/run.ts`:**

```typescript
// Define this at the top level, near other tool policy helpers like
// CONCURRENCY_SAFE_TOOLS. It does not depend on a specific agent run.
const PLAN_MODE_BLOCKED_TOOLS = new Set([
  "writeFile",
  "deleteFile",
  "runCommand",
  "executeCode",
]);

function isBlockedInPlanMode(toolName: string): boolean {
  return PLAN_MODE_BLOCKED_TOOLS.has(toolName);
}
```

Check this before approval and execution. With the Chapter 4 model/execution split, the model may still request these tools, but the runtime blocks them before any real `execute` function runs:

**Edit `src/agent/run.ts`:**

```typescript
if (planState.mode === "plan" && isBlockedInPlanMode(tc.toolName)) {
  const stopMessage = `\n[Tool blocked in plan mode: ${tc.toolName}]`;
  callbacks.onToken(stopMessage);
  fullResponse += stopMessage;
  rejected = true;
  break;
}
```

Then pass it from the UI:

**Edit `src/ui/App.tsx`:**

```typescript
const newHistory = await runAgent(
  agentInput,
  conversationHistory,
  callbacks,
  usageTrackerRef.current,
  runPlanState,
  controller.signal,
);
```

When the user approves a plan, switch back to build mode with the approved plan
attached:

**Edit `src/ui/App.tsx`:**

```typescript
if (planState.mode === "plan" && command === "approve") {
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  setPlanState({
    mode: "build",
    approvedPlan: lastAssistantMessage?.content,
  });
  return;
}
```

Copy the array before calling `reverse()`. React state should not be mutated
directly.

Because `handleSubmit` reads both `planState` and `messages`, keep them in the
`useCallback` dependency list:

**Edit `src/ui/App.tsx`:**

```typescript
const handleSubmit = useCallback(
  async (userInput: string) => {
    // ...
  },
  [conversationHistory, exit, messages, planState],
);
```

The important workflow is:

```text
user asks for a complex change with /plan
-> enter plan mode
-> read/search
-> ask clarifying questions if needed
-> stop and wait for the user's answer
-> produce a plan
-> user types approve
-> switch back to build mode
-> execute using the approved plan
```

In this course implementation, clarifying questions are ordinary assistant
messages. If the agent needs more information, it asks the question and ends the
turn. The user's next message becomes the answer, and planning continues from
there.

For a course-sized implementation, the plan can live in memory. A more
production-like version writes it to a file such as `.agent/plans/<id>.md`, then
passes the approved plan back into the build-mode context.

This is different from a todo list. A plan explains the approach and trade-offs;
todos track execution progress after the approach is chosen.

### Minimal Test

Run this test with a clean conversation. If your app has an old saved default
conversation, temporarily move it aside:

```bash
mkdir -p .agent/conversations
if [ -f .agent/conversations/default.json ]; then
  mv .agent/conversations/default.json .agent/conversations/default.json.bak
fi
```

Start the app:

```bash
npm run start
```

Ask for a plan for a simple file write:

```text
/plan Plan how to create planning-test.txt with the text hello. Do not create it yet.
```

Expected behavior:

- The assistant produces a plan.
- The app does not ask for `writeFile` approval.
- `planning-test.txt` does not exist yet.

In another terminal, verify:

```bash
ls planning-test.txt
```

Then approve and execute:

```text
approve
```

```text
Execute the approved plan.
```

Expected behavior:

- The app asks for `writeFile(planning-test.txt)` approval.
- After approval, `planning-test.txt` exists and contains `hello`.

Verify:

```bash
cat planning-test.txt
```

Clean up the test file:

```bash
rm planning-test.txt
```

If you moved a saved conversation aside, restore it:

```bash
if [ -f .agent/conversations/default.json.bak ]; then
  mv .agent/conversations/default.json.bak .agent/conversations/default.json
fi
```

### Going Further

Production tools often make questions a structured tool, such as
`askUserQuestion`, so the UI can render choices, collect answers, and resume
planning automatically. That is useful, but it adds callback state, question UI,
and resume logic, so ordinary assistant questions are a better first version.
