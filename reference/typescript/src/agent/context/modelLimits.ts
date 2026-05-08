import type { ModelLimits } from "../../types.ts";

/**
 * Default threshold for context window usage (80%)
 */
export const DEFAULT_THRESHOLD = 0.8;

/**
 * Model limits registry
 */
const MODEL_LIMITS: Record<string, ModelLimits> = {
  "qwen3.5-flash-2026-02-23": {
    inputLimit: 2000,
    outputLimit: 1000,
    contextWindow: 2000,
  },
};

/**
 * Default limits used when model is not found in registry
 */
const DEFAULT_LIMITS: ModelLimits = {
  inputLimit: 2000,
  outputLimit: 1000,
  contextWindow: 2000,
};

/**
 * Get token limits for a specific model.
 * Falls back to default limits if model not found.
 */
export function getModelLimits(model: string): ModelLimits {
  // Direct match
  if (MODEL_LIMITS[model]) {
    return MODEL_LIMITS[model];
  }

  // Check for variants
  if (model.startsWith("qwen")) {
    return MODEL_LIMITS["qwen3.5-flash-2026-02-23"];
  }

  return DEFAULT_LIMITS;
}

/**
 * Check if token usage exceeds the threshold
 */
export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return totalTokens > contextWindow * threshold;
}

/**
 * Calculate usage percentage
 */
export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return (totalTokens / contextWindow) * 100;
}
