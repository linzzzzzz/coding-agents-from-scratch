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