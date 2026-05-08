import type { EvalTarget, SingleTurnResult, MultiTurnResult, MultiTurnTarget } from "./types.ts";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

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
- 1-3: Response is mostly incorrect or irrelevant

Return only valid JSON with exactly these two keys:
{
  "score": 10,
  "reason": "Brief explanation for the score"
}

Do not omit "reason". Do not use "reasoning".`,
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
    allowSystemInMessages: true,
  });

  // Convert 1-10 score to 0-1 range
  return result.object.score / 10;
}
