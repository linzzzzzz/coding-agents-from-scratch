# 第 15 章：Agent Planning

Planning 可以帮助 agent 处理更大的任务：把工作显式化、可 review，并在执行前设置 gate。

---

## 10. Agent Planning

### 问题

我们的 agent 是 reactive 的：它一次只决定一步。你让它 “refactor the auth module”，它可能还没理解完整范围就开始编辑文件。它没有 plan。

### 修复

生产工具通常把 planning 当作一个模式切换，而不只是一个 prompt。OpenCode 和 Claude Code 都会区分 “planning” 和 “building”：planning 是只读的，会产出可 review 的 plan，并且只有在用户批准后才退出。

把 agent 建模成一个小型 state machine。

**创建 `src/agent/mode.ts`：**

```typescript
export type AgentMode = "build" | "plan";

export type PlanState = {
  mode: AgentMode;
  approvedPlan?: string;
};
```

在 UI 中保存这个 state，并使用显式 `/plan` 命令进入 plan mode。这比让模型自己决定何时需要 planning 更简单。

**编辑 `src/ui/App.tsx`：**

```typescript
import type { PlanState } from "../agent/mode.ts";

const [planState, setPlanState] = useState<PlanState>({ mode: "build" });
```

在调用 agent 之前处理 `/plan`：

**编辑 `src/ui/App.tsx`：**

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

`runPlanState` 是当前这次 agent 调用使用的 mode。`setPlanState` 会更新 UI state，影响未来 turns。

在 plan mode 中，agent 可以检查项目，但不应该修改项目：

**编辑 `src/agent/system/prompt.ts`：**

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

为批准后的执行保留一个单独的 execution prompt：

**编辑 `src/agent/system/prompt.ts`：**

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

把 plan state 传入 agent loop：

**编辑 `src/agent/run.ts`：**

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

用 `buildSystemPrompt(planState)` 作为 base prompt，然后再追加 memory。这样现有 memory 功能在 build mode 和 plan mode 中都能继续工作。

因为 plan mode 会改变 system prompt，要确保 `runAgent()` 返回并保存的只有 durable conversation history。`PLAN_MODE_PROMPT` 应该每次当前 run 新鲜加入，绝不能持久化到已保存 history。

这就是为什么前面的 `withoutSystemMessages()` helper 很重要：如果旧的 `PLAN_MODE_PROMPT` 被保存进 history，后续 build-mode turns 可能仍然表现得像 plan mode。

同时，在 planning 时阻止写入类工具。prompt 会告诉模型不要修改文件，但 runtime 也应该强制执行这条规则。

**编辑 `src/agent/run.ts`：**

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

在 approval 和 execution 之前检查它。有了第 4 章的 model/execution 分离，模型仍然可能请求这些工具，但 runtime 会在任何真实 `execute` 函数运行前阻止它们：

**编辑 `src/agent/run.ts`：**

```typescript
if (planState.mode === "plan" && isBlockedInPlanMode(tc.toolName)) {
  const stopMessage = `\n[Tool blocked in plan mode: ${tc.toolName}]`;
  callbacks.onToken(stopMessage);
  fullResponse += stopMessage;
  rejected = true;
  break;
}
```

然后从 UI 传入：

**编辑 `src/ui/App.tsx`：**

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

当用户批准 plan 时，切回 build mode，并附上已批准的 plan：

**编辑 `src/ui/App.tsx`：**

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

调用 `reverse()` 之前要先复制数组。React state 不应该被直接 mutate。

因为 `handleSubmit` 会读取 `planState` 和 `messages`，要把它们保留在 `useCallback` dependency list 中：

**编辑 `src/ui/App.tsx`：**

```typescript
const handleSubmit = useCallback(
  async (userInput: string) => {
    // ...
  },
  [conversationHistory, exit, messages, planState],
);
```

重要 workflow 是：

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

在这门课的实现里，clarifying questions 就是普通 assistant messages。如果 agent 需要更多信息，它会提出问题并结束这个 turn。用户下一条消息就是回答，planning 会从那里继续。

对于课程规模的实现，plan 可以存在内存里。更接近生产的版本会把它写入 `.agent/plans/<id>.md` 这类文件，然后把 approved plan 放回 build-mode context。

这和 todo list 不同。plan 解释方案和取舍；todos 在方案确定之后追踪执行进度。

### 最小测试

用干净对话运行这个测试。如果你的 app 已经有旧的默认保存对话，临时把它移开：

```bash
mkdir -p .agent/conversations
if [ -f .agent/conversations/default.json ]; then
  mv .agent/conversations/default.json .agent/conversations/default.json.bak
fi
```

启动应用：

```bash
npm run start
```

要求它为一个简单文件写入做 plan：

```text
/plan Plan how to create planning-test.txt with the text hello. Do not create it yet.
```

预期行为：

- assistant 产出一个 plan。
- app 不会请求 `writeFile` approval。
- `planning-test.txt` 还不存在。

在另一个终端验证：

```bash
ls planning-test.txt
```

然后批准并执行：

```text
approve
```

```text
Execute the approved plan.
```

预期行为：

- app 请求 `writeFile(planning-test.txt)` approval。
- 批准后，`planning-test.txt` 存在，并且包含 `hello`。

验证：

```bash
cat planning-test.txt
```

清理测试文件：

```bash
rm planning-test.txt
```

如果你之前移开了已保存对话，把它恢复：

```bash
if [ -f .agent/conversations/default.json.bak ]; then
  mv .agent/conversations/default.json.bak .agent/conversations/default.json
fi
```

### 继续加强

生产工具通常会把问题做成一个结构化工具，比如 `askUserQuestion`，这样 UI 可以渲染选项、收集回答，并自动恢复 planning。这很有用，但会增加 callback state、question UI 和 resume logic，所以普通 assistant questions 是更好的第一版。
