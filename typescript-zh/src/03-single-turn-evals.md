# 第 3 章：单轮评测

## 为什么需要评测？

你已经定义了工具，LLM 看起来也能选对工具。但“看起来”还不够。LLM 是概率性的：它可能 90% 的时候选对工具，但在边界情况上失败。如果没有 evaluations，你可能要等到用户真的踩到 bug 才会发现。

Evaluations（evals）就是针对 LLM 行为的自动化测试。它们回答这些问题：

- 当用户要求读取文件时，LLM 是否会选择 `readFile`？
- 当用户要求列出文件时，它是否会避免调用 `deleteFile`？
- 当 prompt 有点模糊时，它是否会选择合理的工具？

这一章我们会构建 **single-turn evals**：只检查单条用户消息上的工具选择，不执行工具，也不运行 agent loop。

## Eval 架构

我们的 eval 系统由三部分组成：

1. **Dataset** — 包含输入和期望输出的测试用例
2. **Executor** — 使用测试输入运行 LLM
3. **Evaluators** — 根据期望对输出打分

```
Dataset → Executor → Evaluators → Scores
```

每个测试用例包含：

- `data`：输入，例如 user prompt 和可用工具
- `target`：期望行为，例如应该选择或不应该选择哪些工具

## 定义类型

先创建 evals 目录结构：

```bash
mkdir -p evals/data evals/mocks
```

创建 `evals/types.ts`：

```typescript
import type { ModelMessage } from "ai";

/**
 * Input data for single-turn tool selection evaluations.
 * Tests whether the LLM selects the correct tools without executing them.
 */
export interface EvalData {
  /** The user prompt to test */
  prompt: string;
  /** Optional system prompt override (uses default if not provided) */
  systemPrompt?: string;
  /** Tool names to make available for this evaluation */
  tools: string[];
  /** Configuration for the LLM call */
  config?: {
    model?: string;
    temperature?: number;
  };
}

/**
 * Target expectations for single-turn evaluations
 */
export interface EvalTarget {
  /** Tools that MUST be selected (golden prompts) */
  expectedTools?: string[];
  /** Tools that MUST NOT be selected (negative prompts) */
  forbiddenTools?: string[];
  /** Category for grouping and filtering */
  category: "golden" | "secondary" | "negative";
}

/**
 * Result from single-turn executor
 */
export interface SingleTurnResult {
  /** Raw tool calls from the LLM */
  toolCalls: Array<{ toolName: string; args: unknown }>;
  /** Just the tool names for easy comparison */
  toolNames: string[];
  /** Whether any tool was selected */
  selectedAny: boolean;
}
```

三类测试：

- **Golden**：LLM 必须选择特定工具。例如 “Read the file at path.txt” 必须选择 `readFile`。
- **Secondary**：LLM 应该选择某些工具，但场景有一点模糊。用 precision/recall 打分。
- **Negative**：LLM 必须不能选择某些工具。例如 “What's 2+2?” 不应该选择 `readFile`。

## 构建 Executor

Executor 接收一个测试用例，把它传给 LLM，然后返回原始结果。先创建 `evals/utils.ts`：

```typescript
import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { SYSTEM_PROMPT } from "../src/agent/system/prompt.ts";
import type { EvalData, MultiTurnEvalData } from "./types.ts";

/**
 * Build message array from eval data
 */
export const buildMessages = (
  data: EvalData | { prompt?: string; systemPrompt?: string },
): ModelMessage[] => {
  const systemPrompt = data.systemPrompt ?? SYSTEM_PROMPT;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: data.prompt! },
  ];
};
```

现在创建 `evals/executors.ts`：

```typescript
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { SYSTEM_PROMPT } from "../src/agent/system/prompt.ts";
import type { EvalData, SingleTurnResult } from "./types.ts";
import { buildMessages } from "./utils.ts";

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

// Keep evals focused on tool selection by preventing the AI SDK from executing tools.
function withoutToolExecutors(toolSet: ToolSet): ToolSet {
  const modelTools: ToolSet = {};

  for (const [name, toolDef] of Object.entries(toolSet)) {
    modelTools[name] = { ...toolDef, execute: undefined } as ToolSet[string];
  }

  return modelTools;
}

export async function singleTurnExecutor(
  data: EvalData,
  availableTools: ToolSet,
): Promise<SingleTurnResult> {
  const messages = buildMessages(data);

  // Filter to only tools specified in data
  const tools: ToolSet = {};
  for (const toolName of data.tools) {
    if (availableTools[toolName]) {
      tools[toolName] = availableTools[toolName];
    }
  }

  const result = await generateText({
    model: provider.chat(
      data.config?.model ??
        process.env.LLM_MODEL ??
        "qwen3.5-flash-2026-02-23",
    ),
    messages,
    tools: withoutToolExecutors(tools),
    stopWhen: stepCountIs(1), // Single step - just get tool selection
    temperature: data.config?.temperature ?? undefined,
  });

  // Extract tool calls from the result
  const toolCalls = (result.toolCalls ?? []).map((tc) => ({
    toolName: tc.toolName,
    args: "args" in tc ? tc.args : {},
  }));

  const toolNames = toolCalls.map((tc) => tc.toolName);

  return {
    toolCalls,
    toolNames,
    selectedAny: toolNames.length > 0,
  };
}
```

这个 eval 使用 `generateText()`，因为它测试的是模型是否选择了正确工具，而不是生产执行 loop。我们传入没有 `execute` 函数的 model-facing tools，这样 eval 只记录工具选择，不会做真实文件 I/O。第 4 章里，agent runtime 会收集工具请求并自己执行工具。

关键细节是 `stopWhen: stepCountIs(1)`。它告诉 AI SDK 一步之后就停止。我们只想看 LLM **选择** 了哪些工具，而不是工具运行之后发生什么。这样 eval 更快，也更确定，因为没有真实文件 I/O。

## 编写 Evaluators

Evaluators 是打分函数。它们接收 executor 输出和期望 target，然后返回 0 到 1 之间的分数。

创建 `evals/evaluators.ts`：

```typescript
import type { EvalTarget, SingleTurnResult } from "./types.ts";

/**
 * Evaluator: Check if all expected tools were selected.
 * Returns 1 if ALL expected tools are in the output, 0 otherwise.
 * For golden prompts.
 */
export function toolsSelected(
  output: SingleTurnResult,
  target: EvalTarget,
): number {
  if (!target.expectedTools?.length) return 1;

  const selected = new Set(output.toolNames);
  return target.expectedTools.every((t) => selected.has(t)) ? 1 : 0;
}

/**
 * Evaluator: Check if forbidden tools were avoided.
 * Returns 1 if NONE of the forbidden tools are in the output, 0 otherwise.
 * For negative prompts.
 */
export function toolsAvoided(
  output: SingleTurnResult,
  target: EvalTarget,
): number {
  if (!target.forbiddenTools?.length) return 1;

  const selected = new Set(output.toolNames);
  return target.forbiddenTools.some((t) => selected.has(t)) ? 0 : 1;
}

/**
 * Evaluator: Precision/recall score for tool selection.
 * Returns a score between 0 and 1 based on correct selections.
 * For secondary prompts.
 */
export function toolSelectionScore(
  output: SingleTurnResult,
  target: EvalTarget,
): number {
  if (!target.expectedTools?.length) {
    return output.selectedAny ? 0.5 : 1;
  }

  const expected = new Set(target.expectedTools);
  const selected = new Set(output.toolNames);

  const hits = output.toolNames.filter((t) => expected.has(t)).length;
  const precision = selected.size > 0 ? hits / selected.size : 0;
  const recall = expected.size > 0 ? hits / expected.size : 0;

  // Simple F1-ish score
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}
```

三类 evaluator 对应三类测试：

- **`toolsSelected`** — 二元分数：LLM 是否选择了所有 expected tools？是 1，否 0。
- **`toolsAvoided`** — 二元分数：LLM 是否避开了所有 forbidden tools？是 1，否 0。
- **`toolSelectionScore`** — 连续分数：用 F1 score 衡量工具选择的 precision 和 recall，范围 0 到 1。

F1 score 对模糊 prompt 特别有用。如果 LLM 选中了正确工具，但还多选了不必要的工具，precision 会下降。如果漏掉了预期工具，recall 会下降。F1 会平衡两者。

## 创建测试数据

创建测试数据集 `evals/data/file-tools.json`：

```json
[
  {
    "data": {
      "prompt": "Read the contents of README.md",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["readFile"],
      "category": "golden"
    },
    "metadata": {
      "description": "Direct read request should select readFile"
    }
  },
  {
    "data": {
      "prompt": "What files are in the src directory?",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["listFiles"],
      "category": "golden"
    },
    "metadata": {
      "description": "Directory listing should select listFiles"
    }
  },
  {
    "data": {
      "prompt": "Show me what's in the project",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["listFiles"],
      "category": "secondary"
    },
    "metadata": {
      "description": "Ambiguous request likely needs listFiles"
    }
  },
  {
    "data": {
      "prompt": "What is the capital of France?",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
      "category": "negative"
    },
    "metadata": {
      "description": "General knowledge question should not use file tools"
    }
  },
  {
    "data": {
      "prompt": "Tell me a joke",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
      "category": "negative"
    },
    "metadata": {
      "description": "Creative request should not use file tools"
    }
  }
]
```

好的 eval dataset 应该覆盖：

- **Happy path**：明确应该使用特定工具的清晰请求
- **Edge cases**：工具选择需要判断的模糊请求
- **Negative cases**：不应该使用任何工具的请求

## 运行 Evaluation

创建 `evals/file-tools.eval.ts`：

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import { fileTools } from "../src/agent/tools/index.ts";
import {
  toolsSelected,
  toolsAvoided,
  toolSelectionScore,
} from "./evaluators.ts";
import type { EvalData, EvalTarget } from "./types.ts";
import dataset from "./data/file-tools.json" with { type: "json" };
import { singleTurnExecutor } from "./executors.ts";

// Executor that runs single-turn tool selection
const executor = async (data: EvalData) => {
  return singleTurnExecutor(data, fileTools);
};

// Run the evaluation
evaluate({
  data: dataset as Array<{ data: EvalData; target: EvalTarget }>,
  executor,
  evaluators: {
    // For golden prompts: did it select all expected tools?
    toolsSelected: (output, target) => {
      if (target?.category !== "golden") return 1; // Skip for non-golden
      return toolsSelected(output, target);
    },
    // For negative prompts: did it avoid forbidden tools?
    toolsAvoided: (output, target) => {
      if (target?.category !== "negative") return 1; // Skip for non-negative
      return toolsAvoided(output, target);
    },
    // For secondary prompts: precision/recall score
    selectionScore: (output, target) => {
      if (target?.category !== "secondary") return 1; // Skip for non-secondary
      return toolSelectionScore(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "file-tools-selection",
});
```

第 1 章已经把 eval scripts 加到了 `package.json`。运行：

```bash
npm run eval:file-tools
```

你会看到每个测试用例和 evaluator 的 pass/fail 输出。Laminar 框架会长期追踪这些结果，所以当你修改 prompt 或工具后，可以看到工具选择是变好了还是退化了。

## Evals 的价值

Evals 看起来像额外工作，但它们会节省大量时间：

1. **捕捉回归**：改了 system prompt？跑 evals，确认工具选择仍然正常。
2. **比较模型**：从 `qwen3.5-flash-2026-02-23` 换到另一个模型？Evals 会告诉你它更好还是更差。
3. **指导 prompt engineering**：如果 `toolsAvoided` 失败，说明工具描述可能太宽泛。如果 `toolsSelected` 失败，说明描述可能太窄。
4. **建立信心**：添加新功能前，先确认基础行为是稳的。

可以把 evals 理解成 LLM 行为的 unit tests。它们不完美，因为 LLM 是概率性的，但能抓住大问题。

## 小结

这一章你完成了：

- 构建 single-turn evaluation framework
- 创建三类 evaluator：golden、secondary、negative
- 为文件工具选择编写测试数据
- 使用 Laminar 框架运行 evals

你的 agent 现在可以选择工具，你也可以验证它是否选择正确。下一章，我们会构建核心 agent loop，让它真正执行工具，并让 LLM 处理工具结果。

---

**下一章：[第 4 章：Agent Loop →](./04-the-agent-loop.md)**
