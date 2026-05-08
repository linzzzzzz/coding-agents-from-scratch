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