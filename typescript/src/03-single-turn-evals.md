# Chapter 3: Single-Turn Evaluations

> 💻 **Code:** start from the [`lesson-03`](https://github.com/Hendrixer/agents-v2/tree/lesson-03) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## Why Evaluate?

You've defined tools and the LLM seems to pick the right ones. But "seems to" isn't good enough. LLMs are probabilistic — they might select the right tool 90% of the time but fail on edge cases. Without evaluations, you won't know until a user hits the bug.

Evaluations (evals) are automated tests for LLM behavior. They answer questions like:

- Does the LLM pick `readFile` when asked to read a file?
- Does it avoid `deleteFile` when asked to list files?
- When the prompt is ambiguous, does it choose reasonable tools?

In this chapter, we'll build **single-turn evals** — tests that check tool selection on a single user message without executing the tools or running the agent loop.

## The Eval Architecture

Our eval system has three parts:

1. **Dataset** — Test cases with inputs and expected outputs
2. **Executor** — Runs the LLM with the test input
3. **Evaluators** — Score the output against expectations

```
Dataset → Executor → Evaluators → Scores
```

Each test case has:
- `data`: The input (user prompt + available tools)
- `target`: The expected behavior (which tools should/shouldn't be selected)

## Defining the Types

First, create the evals directory structure:

```bash
mkdir -p evals/data evals/mocks
```

Create `evals/types.ts`:

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

Three test categories:

- **Golden**: The LLM *must* select specific tools. "Read the file at path.txt" → must select `readFile`.
- **Secondary**: The LLM *should* select certain tools, but there's some ambiguity. Scored on precision/recall.
- **Negative**: The LLM *must not* select certain tools. "What's 2+2?" → must not select `readFile`.

## Building the Executor

The executor takes a test case, runs it through the LLM, and returns the raw result. Create `evals/utils.ts` first:

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

Now create `evals/executors.ts`:

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

This eval uses `generateText()` because it is testing whether the model chooses the right tools, not teaching the production execution loop. We pass model-facing tools without `execute` functions so the eval records tool selection without doing real file I/O. In Chapter 4, the agent runtime will collect tool requests and execute tools itself.

Key detail: `stopWhen: stepCountIs(1)`. This tells the AI SDK to stop after one step — we only want to see which tools the LLM *selects*, not what happens when they run. This makes the eval fast and deterministic (no actual file I/O).

## Writing Evaluators

Evaluators are scoring functions. They take the executor's output and the expected target, and return a number between 0 and 1.

Create `evals/evaluators.ts`:

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

Three evaluators for three categories:

- **`toolsSelected`** — Binary: did the LLM select ALL expected tools? (1 or 0)
- **`toolsAvoided`** — Binary: did the LLM avoid ALL forbidden tools? (1 or 0)
- **`toolSelectionScore`** — Continuous: F1-score measuring precision and recall of tool selection (0 to 1)

The F1 score is particularly useful for ambiguous prompts. If the LLM selects the right tool but also an unnecessary one, precision drops. If it misses an expected tool, recall drops. The F1 balances both.

## Creating Test Data

Create the test dataset at `evals/data/file-tools.json`:

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

Good eval datasets cover:
- **Happy path**: Clear requests that should definitely use specific tools
- **Edge cases**: Ambiguous requests where tool selection is judgment-dependent
- **Negative cases**: Requests where tools should NOT be used

## Running the Evaluation

Create `evals/file-tools.eval.ts`:

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

We already added the eval scripts to `package.json` in Chapter 1. Run it:

```bash
npm run eval:file-tools
```

You'll see output showing pass/fail for each test case and each evaluator. The Laminar framework tracks these results over time, so you can see if tool selection improves or regresses as you modify prompts or tools.

## The Value of Evals

Evals might seem like overhead, but they save enormous time:

1. **Catch regressions**: Change the system prompt? Run evals to make sure tool selection still works.
2. **Compare models**: Switch from `qwen3.5-flash-2026-02-23` to another model? Evals tell you if it's better or worse.
3. **Guide prompt engineering**: If `toolsAvoided` fails, your tool descriptions are too broad. If `toolsSelected` fails, they're too narrow.
4. **Build confidence**: Before adding features, know that the foundation is solid.

Think of evals as unit tests for LLM behavior. They're not perfect (LLMs are probabilistic), but they catch the big problems.

## Summary

In this chapter you:

- Built a single-turn evaluation framework
- Created three types of evaluators (golden, secondary, negative)
- Wrote test datasets for file tool selection
- Ran evals using the Laminar framework

Your agent can select tools and you can verify that it does so correctly. In the next chapter, we'll build the core agent loop that actually executes tools and lets the LLM process the results.

---

**Next: [Chapter 4: The Agent Loop →](./04-the-agent-loop.md)**
