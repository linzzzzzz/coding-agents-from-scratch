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
