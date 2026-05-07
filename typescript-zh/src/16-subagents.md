# 第 16 章：Subagents

生产级 coding agents 通常不会把整个用户 turn 路由给另一个 top-level agent。它们会让一个 primary agent 继续负责主对话，然后允许它把边界清晰的工作委派给专门的 subagents。

这更接近 OpenCode 和 Claude Code 的工作方式。OpenCode 有 primary agents 和 subagents，并通过 Task 工具创建 child sessions。Claude Code 有 Agent 工具，可以启动带有独立 prompt、tools、context 和 permissions 的专门 agents。

---

## 问题

一个 agent 配一个 prompt，最终会变得过载：

- 它需要 planning、implementation、review、research 和 testing
- 长搜索和工具输出会填满主对话 context
- 有些任务只需要只读权限，而有些需要写权限
- 风险较高的修改后，第二意见很有用

Subagents 解决的是这个问题：让 primary agent 有一种受控方式说：“我需要一个聚焦 helper 来完成这个有边界的任务。”

---

## 形状

生产级模式是：

1. primary agent 留在主对话里。
2. primary agent 调用 `delegateToSubagent` 工具。
3. 这个工具用更窄的 system prompt 和 scoped context 运行一次独立模型调用。
4. subagent 返回一个简洁结果。
5. primary agent 决定如何使用这个结果。

这和简单 router 不同。router 会选择一个 agent 负责整个 turn。subagent 工具让 main agent 继续作为 coordinator。

---

## 定义 Subagents

创建一个 subagent type：

**编辑 `src/agent/subagents/types.ts`：**

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

`allowedTools` 是重要的生产细节。reviewer 或 explorer 不应该自动继承 main agent 拥有的所有工具。

---

## 创建 Subagent Registry

先从一个有用的 subagent 开始：只读 reviewer。

**编辑 `src/agent/subagents/registry.ts`：**

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

## 运行 Subagent

在生产环境中，subagent 不应该是一个完全独立的一次性 completion。它应该复用和 primary agent 相同的 agent loop，只是使用不同的 system prompt、scoped tools、isolated history 和更安静的 callbacks。

这是 OpenCode / Claude Code 的关键想法：subagent 仍然是一次 agent run。

首先，让 `runAgent()` 可配置。

**编辑 `src/agent/run.ts`：**

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

然后给 `runAgent()` 加上 run config 参数：

**编辑 `src/agent/run.ts`：**

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

在 `runAgent()` 内使用这个 run config：

**编辑 `src/agent/run.ts`：**

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

然后保护 per-turn reset：

**编辑 `src/agent/run.ts`：**

```typescript
if (runConfig.startNewTurn !== false) {
  usageTracker.startTurn();
}
```

top-level 用户 turn 应该开始一个新的 usage turn。subagent runs 不应该这样做，因为 delegated work 仍然属于同一个用户请求。

本章稍后会创建 `executionTools`。传给模型的是一个 schema-only copy：

**编辑 `src/agent/run.ts`：**

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

现在 `runAgent()` 仍然可以驱动 main assistant，同时也可以驱动 subagent。

---

## 执行当前活跃工具集

之前，`executeTool()` 可以假设只有一个全局工具注册表。现在这个假设不成立了。main agent 会获得 `baseTools` 加 `delegateToSubagent`，而 subagents 只获得它们 scoped tools。

重构 executor，让它可以从任何工具集中执行：

**编辑 `src/agent/executeTool.ts`：**

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

重要的生产规则是：从当前 run 的活跃可执行工具集执行。模型接收 schema-only copy；loop 在 approval 之后从真实工具集执行。

然后更新 agent loop：

**编辑 `src/agent/run.ts`：**

```typescript
import { executeToolFromSet } from "./executeTool.ts";
```

在 `executeApprovedToolCall()` 内：

```typescript
const rawToolResult = await executeToolFromSet(
  executionTools,
  tc.toolName,
  tc.args,
);
```

这样可以让 `delegateToSubagent` 这类动态工具留在真实执行路径上，同时不会让 AI SDK 在 `streamText()` 内部自动执行它们。

---

## 用 Agent Loop 运行 Subagent

subagent wrapper 会选择 context 和 tools，然后递归调用 `runAgent()`。

先把这个 wrapper 放在 `src/agent/run.ts` 里。如果 `run.ts` 导入 delegation tool，而 delegation tool 导入 `runSubagent()`，同时 `runSubagent()` 又导入 `runAgent()`，就会产生 circular import。在课程还比较小的时候，把 wrapper 放在 `runAgent()` 附近可以避免这个问题。

**编辑 `src/agent/run.ts`：**

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

subagent 使用和 main agent 相同的 loop。差异都来自配置：更小的 history、subagent prompt、scoped tools、不注入 memory，以及不会把 subagent token 直接 stream 到主 UI 的 callbacks。

把同一个 `usageTracker` 传给 subagent，并设置 `startNewTurn: false`。delegated work 仍然属于同一个用户 turn，所以它应该计入同一组 token、cost、loop 和 tool-call budget。

---

## 添加 Delegation Tool

primary agent 需要一个可以调用的工具。把它创建在 `runAgent()` 内部，这样它可以捕获当前 `workingHistory`、callbacks 和 abort signal。

**编辑 `src/agent/run.ts`：**

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

注意，primary agent 必须给 subagent 一个完整任务。新启动的 subagent 不应该需要猜用户到底想要什么。

如果你的文件已经直接 import 了 `tools`，把那个 import 重命名为 `baseTools`。这样既保留现有静态工具注册表，又能为当前 turn 加入一个动态工具。

这里的分离很重要。`executionTools` 包含真实 `execute` 函数，包括 `delegateToSubagent`。`modelTools` 是传给 `streamText()` 的内容，所以模型可以请求 delegation，但 loop 仍然控制 approval 和 execution。

---

## 什么时候使用 Subagents

适合使用：

- review 当前 diff，找 bugs
- 探索一个较宽的代码问题，同时让 primary agent 保持 context 干净
- 在风险较高的实现工作前获得第二意见
- 修改后运行一次聚焦的 verification pass

不适合使用：

- 读取一个已知文件
- 搜索一个精确字符串
- 每个普通用户 turn
- primary agent 需要每个中间结果的任务

Delegation 有开销。只有当 isolation、focus 或 parallel work 值得额外模型调用时再使用。

---

## 最小测试

询问 agent：

```text
Use the reviewer subagent to review src/agent/run.ts for bugs or risky assumptions. Do not change files.
```

预期行为：

- primary agent 调用 `delegateToSubagent`
- subagent 收到一个聚焦 review 任务
- subagent 只使用只读工具，例如 `reviewer.readFile`
- 最终答案总结 review findings
- 没有文件被修改

你可以用下面命令确认没有文件变化：

```bash
git diff --stat
```

---

## 继续加强

生产工具会在这个基本形状之外加入更多能力：

- subagent runs 的 child sessions 或 side transcripts
- 带 `task_id` 的可恢复 subagents
- 用于长时间任务的后台 subagents
- implementation agents 的 worktree isolation
- 每种 subagent type 的 permission rules
- router agents、supervisor agents 和 pipelines

这些都是扩展。核心生产思想已经在这里：primary agent 负责协调，专门 subagents 负责边界清晰的工作。

---
