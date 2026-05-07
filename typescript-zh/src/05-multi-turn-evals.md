# 第 5 章：多轮评测

> 💻 **代码：** 从 [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2) 的 [`lesson-05`](https://github.com/Hendrixer/agents-v2/tree/lesson-05) 分支开始。该分支里的 `notes/` 文件夹包含本章会写到的代码。

## 超越单轮

Single-turn evals 测试的是工具选择：“给定这个 prompt，LLM 是否选择了正确工具？” 但 agent 是多轮的。真实任务可能需要：

1. 列出文件
2. 读取某个文件
3. 修改它
4. 写回去

测试这种行为需要运行完整 agent loop 和多次工具调用。但这里有个问题：真实工具有副作用。你不会希望 eval suite 在磁盘上创建和删除文件。解决方案是：**mocked tools**。

## Mocked Tools

Mocked tool 和真实工具有相同的名称和描述，但它的 `execute` 函数返回固定值，而不是做真实工作。

把 mock tool builders 加到 `evals/utils.ts`：

```typescript
import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { SYSTEM_PROMPT } from "../src/agent/system/prompt.ts";
import type { EvalData, MultiTurnEvalData } from "./types.ts";

/**
 * Build mocked tools from data config.
 * Each tool returns its configured mockReturn value.
 */
export const buildMockedTools = (
  mockTools: MultiTurnEvalData["mockTools"],
): ToolSet => {
  const tools: ToolSet = {};

  for (const [name, config] of Object.entries(mockTools)) {
    // Build parameter schema dynamically
    const paramSchema: Record<string, z.ZodString> = {};
    for (const paramName of Object.keys(config.parameters)) {
      paramSchema[paramName] = z.string();
    }

    tools[name] = tool({
      description: config.description,
      inputSchema: z.object(paramSchema),
      execute: async () => config.mockReturn,
    });
  }

  return tools;
};

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

`buildMockedTools` 接收一个配置对象，并创建真正的 AI SDK tools。对 LLM 来说，它们看起来和真实工具一样，但返回值是预先设定好的。LLM 看到相同的工具名和描述，会做相同的决策，但磁盘上不会发生任何真实操作。

你也可以创建更具体的 mock helpers。创建 `evals/mocks/tools.ts`：

```typescript
import { tool } from "ai";
import { z } from "zod";

/**
 * Create a mock readFile tool that returns fixed content
 */
export const createMockReadFile = (mockContent: string) =>
  tool({
    description:
      "Read the contents of a file at the specified path. Use this to examine file contents.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file to read"),
    }),
    execute: async ({ path }: { path: string }) => mockContent,
  });

/**
 * Create a mock writeFile tool that returns a success message
 */
export const createMockWriteFile = (mockResponse?: string) =>
  tool({
    description:
      "Write content to a file at the specified path. Creates the file if it doesn't exist.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file to write"),
      content: z.string().describe("The content to write to the file"),
    }),
    execute: async ({ path, content }: { path: string; content: string }) =>
      mockResponse ??
      `Successfully wrote ${content.length} characters to ${path}`,
  });

/**
 * Create a mock listFiles tool that returns a fixed file list
 */
export const createMockListFiles = (mockFiles: string[]) =>
  tool({
    description:
      "List all files and directories in the specified directory path.",
    inputSchema: z.object({
      directory: z
        .string()
        .describe("The directory path to list contents of")
        .default("."),
    }),
    execute: async ({ directory }: { directory: string }) =>
      mockFiles.join("\n"),
  });

/**
 * Create a mock deleteFile tool that returns a success message
 */
export const createMockDeleteFile = (mockResponse?: string) =>
  tool({
    description:
      "Delete a file at the specified path. Use with caution as this is irreversible.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file to delete"),
    }),
    execute: async ({ path }: { path: string }) =>
      mockResponse ?? `Successfully deleted ${path}`,
  });

/**
 * Create a mock shell command tool that returns fixed output
 */
export const createMockShell = (mockOutput: string) =>
  tool({
    description:
      "Execute a shell command and return its output. Use this for system operations.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
    }),
    execute: async ({ command }: { command: string }) => mockOutput,
  });
```

## 多轮类型

把 multi-turn 类型加到 `evals/types.ts`：

```typescript
/**
 * Mock tool configuration for multi-turn evaluations.
 * Tools return fixed values for deterministic testing.
 */
export interface MockToolConfig {
  /** Tool description shown to the LLM */
  description: string;
  /** Parameter schema (simplified - all params treated as strings) */
  parameters: Record<string, string>;
  /** Fixed return value when tool is called */
  mockReturn: string;
}

/**
 * Input data for multi-turn agent evaluations.
 * Supports both fresh conversations and mid-conversation scenarios.
 */
export interface MultiTurnEvalData {
  /** User prompt for fresh conversation (use this OR messages, not both) */
  prompt?: string;
  /** Pre-filled message history for mid-conversation testing */
  messages?: ModelMessage[];
  /** Mocked tools with fixed return values */
  mockTools: Record<string, MockToolConfig>;
  /** Configuration for the agent run */
  config?: {
    model?: string;
    maxSteps?: number;
  };
}

/**
 * Target expectations for multi-turn evaluations
 */
export interface MultiTurnTarget {
  /** Original task description for LLM judge context */
  originalTask: string;
  /** Expected tools in order (for tool ordering evaluation) */
  expectedToolOrder?: string[];
  /** Tools that must NOT be called */
  forbiddenTools?: string[];
  /** Mock tool results for LLM judge context */
  mockToolResults: Record<string, string>;
  /** Category for grouping */
  category: "task-completion" | "conversation-continuation" | "negative";
}

/**
 * Result from multi-turn executor
 */
export interface MultiTurnResult {
  /** Final text response from the agent */
  text: string;
  /** All steps taken during the agent loop */
  steps: Array<{
    toolCalls?: Array<{ toolName: string; args: unknown }>;
    toolResults?: Array<{ toolName: string; result: unknown }>;
    text?: string;
  }>;
  /** Unique tool names used during the run */
  toolsUsed: string[];
  /** All tool calls in order */
  toolCallOrder: string[];
}
```

注意 `MultiTurnEvalData` 支持两种模式：

- **`prompt`** — 新对话，这是最常见的情况
- **`messages`** — 预填的 conversation history，用来测试对话中途的行为

## Multi-Turn Executor

把 multi-turn executor 加到 `evals/executors.ts`：

```typescript
/**
 * Multi-turn executor with mocked tools.
 * Runs a complete agent loop with tools returning fixed values.
 */
export async function multiTurnWithMocks(
  data: MultiTurnEvalData,
): Promise<MultiTurnResult> {
  const tools = buildMockedTools(data.mockTools);

  // Build messages from either prompt or pre-filled history
  const messages: ModelMessage[] = data.messages ?? [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: data.prompt! },
  ];

  const result = await generateText({
    model: provider.chat(
      data.config?.model ??
        process.env.LLM_MODEL ??
        "qwen3.5-flash-2026-02-23",
    ),
    messages,
    tools,
    stopWhen: stepCountIs(data.config?.maxSteps ?? 20),
  });

  // Extract all tool calls in order from steps
  const allToolCalls: string[] = [];
  const steps = result.steps.map((step) => {
    const stepToolCalls = (step.toolCalls ?? []).map((tc) => {
      allToolCalls.push(tc.toolName);
      return {
        toolName: tc.toolName,
        args: "args" in tc ? tc.args : {},
      };
    });

    const stepToolResults = (step.toolResults ?? []).map((tr) => ({
      toolName: tr.toolName,
      result: "result" in tr ? tr.result : tr,
    }));

    return {
      toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
      toolResults: stepToolResults.length > 0 ? stepToolResults : undefined,
      text: step.text || undefined,
    };
  });

  // Extract unique tools used
  const toolsUsed = [...new Set(allToolCalls)];

  return {
    text: result.text,
    steps,
    toolsUsed,
    toolCallOrder: allToolCalls,
  };
}
```

和 `singleTurnExecutor` 的关键差异是：这里使用 `stopWhen: stepCountIs(20)`，而不是 `stepCountIs(1)`。这让 agent 最多运行 20 个 step，包括工具调用和回复，足够覆盖复杂任务。

Executor 使用 `generateText()`，不是 `streamText()`，因为 evals 不需要 streaming，只需要最终结果。AI SDK 的 `generateText()` 搭配 tools 时，会在内部自动运行 tool → result → next step loop。

## 新的 Evaluators

我们需要理解 multi-turn 行为的 evaluators。把下面内容加到 `evals/evaluators.ts`：

```typescript
/**
 * Evaluator: Check if tools were called in the expected order.
 * Returns the fraction of expected tools found in sequence.
 * Order matters but tools don't need to be consecutive.
 */
export function toolOrderCorrect(
  output: MultiTurnResult,
  target: MultiTurnTarget,
): number {
  if (!target.expectedToolOrder?.length) return 1;

  const actualOrder = output.toolCallOrder;

  // Check if expected tools appear in order (not necessarily consecutive)
  let expectedIdx = 0;
  for (const toolName of actualOrder) {
    if (toolName === target.expectedToolOrder[expectedIdx]) {
      expectedIdx++;
      if (expectedIdx === target.expectedToolOrder.length) break;
    }
  }

  return expectedIdx / target.expectedToolOrder.length;
}
```

这个 evaluator 检查的是 **subsequence ordering**。如果我们期望 `[listFiles, readFile, writeFile]`，实际顺序是 `[listFiles, readFile, readFile, writeFile]`，得分仍然是 1.0，因为期望工具按顺序出现了，即使中间多了一次 `readFile`。

## LLM-as-Judge

最强大的 evaluator 会用另一个 LLM 判断输出质量：

```typescript
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

const judgeSchema = z.object({
  score: z
    .number()
    .min(1)
    .max(10)
    .describe("Score from 1-10 where 10 is perfect"),
  reason: z.string().describe("Brief explanation for the score"),
});

/**
 * Evaluator: LLM-as-judge for output quality.
 * Uses structured output to reliably assess if the agent's response is correct.
 * Returns a score from 0-1 (internally uses 1-10 scale divided by 10).
 */
export async function llmJudge(
  output: MultiTurnResult,
  target: MultiTurnTarget,
): Promise<number> {
  const result = await generateObject({
    model: provider.chat(
      process.env.LLM_JUDGE_MODEL ??
        process.env.LLM_MODEL ??
        "qwen3.5-flash-2026-02-23",
    ),
    schema: judgeSchema,
    schemaName: "evaluation",
    schemaDescription: "Evaluation of an AI agent response",
    messages: [
      {
        role: "system",
        content: `You are an evaluation judge. Score the agent's response on a scale of 1-10.

Scoring criteria:
- 10: Response fully addresses the task using tool results correctly
- 7-9: Response is mostly correct with minor issues
- 4-6: Response partially addresses the task
- 1-3: Response is mostly incorrect or irrelevant`,
      },
      {
        role: "user",
        content: `Task: ${target.originalTask}

Tools called: ${JSON.stringify(output.toolCallOrder)}
Tool results provided: ${JSON.stringify(target.mockToolResults)}

Agent's final response:
${output.text}

Evaluate if this response correctly uses the tool results to answer the task.`,
      },
    ],
  });

  // Convert 1-10 score to 0-1 range
  return result.object.score / 10;
}
```

LLM judge 会：

1. 拿到原始任务、调用过的工具和 mock results
2. 阅读 agent 的最终回复
3. 返回结构化分数，范围 1-10，并给出 reason
4. 使用 `generateObject()` 和 Zod schema 保证输出有效

如果你有更强的 OpenAI-compatible 模型，可以设置 `LLM_JUDGE_MODEL` 作为 judge。理想情况下，judge model 至少要和被测模型一样强；否则可以使用同一个 `LLM_MODEL`，但要把 judge score 当作辅助信号，而不是绝对真理。

## 测试数据

创建 `evals/data/agent-multiturn.json`：

```json
[
  {
    "data": {
      "prompt": "List the files in the current directory, then read the contents of package.json",
      "mockTools": {
        "listFiles": {
          "description": "List all files and directories in the specified directory path.",
          "parameters": { "directory": "The directory to list" },
          "mockReturn": "[file] package.json\n[file] tsconfig.json\n[dir] src\n[dir] node_modules"
        },
        "readFile": {
          "description": "Read the contents of a file at the specified path.",
          "parameters": { "path": "The path to the file to read" },
          "mockReturn": "{ \"name\": \"agi\", \"version\": \"1.0.0\" }"
        }
      }
    },
    "target": {
      "originalTask": "List files and read package.json",
      "expectedToolOrder": ["listFiles", "readFile"],
      "mockToolResults": {
        "listFiles": "[file] package.json\n[file] tsconfig.json\n[dir] src\n[dir] node_modules",
        "readFile": "{ \"name\": \"agi\", \"version\": \"1.0.0\" }"
      },
      "category": "task-completion"
    },
    "metadata": {
      "description": "Two-step file exploration task"
    }
  },
  {
    "data": {
      "prompt": "What is 2 + 2?",
      "mockTools": {
        "readFile": {
          "description": "Read the contents of a file at the specified path.",
          "parameters": { "path": "The path to the file to read" },
          "mockReturn": "file contents"
        },
        "runCommand": {
          "description": "Execute a shell command and return its output.",
          "parameters": { "command": "The command to execute" },
          "mockReturn": "command output"
        }
      }
    },
    "target": {
      "originalTask": "Answer a simple math question without using tools",
      "forbiddenTools": ["readFile", "runCommand"],
      "mockToolResults": {},
      "category": "negative"
    },
    "metadata": {
      "description": "Simple question should not trigger any tool use"
    }
  }
]
```

## 运行 Multi-Turn Evals

创建 `evals/agent-multiturn.eval.ts`：

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import { toolOrderCorrect, toolsAvoided, llmJudge } from "./evaluators.ts";
import type {
  MultiTurnEvalData,
  MultiTurnTarget,
  MultiTurnResult,
} from "./types.ts";
import dataset from "./data/agent-multiturn.json" with { type: "json" };
import { multiTurnWithMocks } from "./executors.ts";

// Executor that runs multi-turn agent with mocked tools
const executor = async (data: MultiTurnEvalData): Promise<MultiTurnResult> => {
  return multiTurnWithMocks(data);
};

// Run the evaluation
evaluate({
  data: dataset as unknown as Array<{
    data: MultiTurnEvalData;
    target: MultiTurnTarget;
  }>,
  executor,
  evaluators: {
    // Check if tools were called in the expected order
    toolOrder: (output, target) => {
      if (!target) return 1;
      return toolOrderCorrect(output, target);
    },
    // Check if forbidden tools were avoided
    toolsAvoided: (output, target) => {
      if (!target?.forbiddenTools?.length) return 1;
      return toolsAvoided(output, target);
    },
    // LLM judge to evaluate output quality
    outputQuality: async (output, target) => {
      if (!target) return 1;
      return llmJudge(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "agent-multiturn",
});
```

运行它（第 1 章已经加入了这个 script）：

```bash
npm run eval:agent
```

## 小结

这一章你完成了：

- 构建 multi-turn evaluations，用来测试完整 agent loop
- 创建 mocked tools，让测试确定且没有副作用
- 实现工具顺序评测，也就是 subsequence matching
- 构建 LLM-as-judge evaluator，用于输出质量打分
- 理解为什么更强的模型更适合作为 judge

你现在有了一套完整评测框架：single-turn 用来测试工具选择，multi-turn 用来测试端到端行为。下一章，我们会用文件系统工具扩展 agent 的能力。

---

**下一章：[第 6 章：文件系统工具 →](./06-file-system-tools.md)**
