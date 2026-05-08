import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { SYSTEM_PROMPT } from "../src/agent/system/prompt.ts";
import type { EvalData, SingleTurnResult, MultiTurnEvalData, MultiTurnResult } from "./types.ts";
import { buildMessages, buildMockedTools} from "./utils.ts";

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

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
    allowSystemInMessages: true,
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
    allowSystemInMessages: true,
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
