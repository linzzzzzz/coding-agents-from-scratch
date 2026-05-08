# Chapter 5: Multi-Turn Evaluations

## Beyond Single Turns

Single-turn evals test tool selection — "given this prompt, does the LLM pick the right tool?" But agents are multi-turn. A real task might require:

1. List the files
2. Read a specific file
3. Modify it
4. Write it back

Testing this requires running the full agent loop with multiple tool calls. But there's a problem: real tools have side effects. You don't want your eval suite creating and deleting files on disk. The solution: **mocked tools**.

## Mocked Tools

A mocked tool has the same name and description as the real tool, but its `execute` function returns a fixed value instead of doing real work.

Add mock tool builders to `evals/utils.ts`:

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

The `buildMockedTools` function takes a configuration object and creates real AI SDK tools that look identical to the LLM but return predetermined values. The LLM sees the same tool names and descriptions, makes the same decisions, but nothing actually happens on disk.

You can also create more specific mock helpers. Create `evals/mocks/tools.ts`:

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

## Multi-Turn Types

Add the multi-turn types to `evals/types.ts`:

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

Notice `MultiTurnEvalData` supports two modes:
- **`prompt`** — A fresh conversation (the common case)
- **`messages`** — A pre-filled conversation history (for testing mid-conversation behavior)

## The Multi-Turn Executor

Add the multi-turn executor to `evals/executors.ts`:

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

Key difference from `singleTurnExecutor`: we use `stopWhen: stepCountIs(20)` instead of `stepCountIs(1)`. This lets the agent run for up to 20 steps (tool calls + responses), enough for complex tasks.

The executor uses `generateText()` (not `streamText()`) because we don't need streaming in evals — we just need the final result. The AI SDK's `generateText()` with tools automatically runs the tool → result → next step loop internally.

## New Evaluators

We need evaluators that understand multi-turn behavior. Add these to `evals/evaluators.ts`:

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

This evaluator checks **subsequence ordering**. If we expect `[listFiles, readFile, writeFile]`, the actual order `[listFiles, readFile, readFile, writeFile]` gets a score of 1.0 — the expected tools appear in sequence, even though there's an extra `readFile` in between.

## LLM-as-Judge

The most powerful evaluator uses another LLM to judge the output quality:

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

The LLM judge:
1. Gets the original task, the tools that were called, and the mock results
2. Reads the agent's final response
3. Returns a structured score (1-10) with reasoning
4. Uses `generateObject()` with a Zod schema to guarantee valid output

For judging, set `LLM_JUDGE_MODEL` if you have a stronger OpenAI-compatible model available. The judge model should ideally be at least as capable as the model being tested; otherwise, use the same `LLM_MODEL` and treat judge scores as a helpful signal rather than absolute truth.

## Test Data

Create `evals/data/agent-multiturn.json`:

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

## Running Multi-Turn Evals

Create `evals/agent-multiturn.eval.ts`:

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

Run it (we added this script in Chapter 1):

```bash
npm run eval:agent
```

## Summary

In this chapter you:

- Built multi-turn evaluations that test the full agent loop
- Created mocked tools for deterministic, side-effect-free testing
- Implemented tool ordering evaluation (subsequence matching)
- Built an LLM-as-judge evaluator for output quality scoring
- Learned why stronger models should judge weaker ones

You now have a complete evaluation framework — single-turn for tool selection, multi-turn for end-to-end behavior. In the next chapter, we'll expand the agent's capabilities with file system tools.

---

**Next: [Chapter 6: File System Tools →](./06-file-system-tools.md)**
