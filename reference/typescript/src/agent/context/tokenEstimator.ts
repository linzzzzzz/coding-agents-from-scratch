import type { ModelMessage } from "ai";

/**
 * Estimate token count from text using simple character division.
 * Uses 3.75 as the divisor (midpoint of 3.5-4 range).
 * This is an approximation - not exact tokenization.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.75);
}

/**
 * Extract text content from a message.
 * Handles different message content formats (string, array, objects).
 */
export function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ("text" in part && typeof part.text === "string") return part.text;
        if ("value" in part && typeof part.value === "string") return part.value;
        if ("output" in part && typeof part.output === "object" && part.output) {
          const output = part.output as Record<string, unknown>;
          if ("value" in output && typeof output.value === "string") {
            return output.value;
          }
        }
        // Fallback: stringify the part
        return JSON.stringify(part);
      })
      .join(" ");
  }

  return JSON.stringify(message.content);
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Estimate token counts for an array of messages.
 * Separates input (user, system, tool) from output (assistant) tokens.
 */
export function estimateMessagesTokens(messages: ModelMessage[]): TokenUsage {
  let input = 0;
  let output = 0;

  for (const message of messages) {
    const text = extractMessageText(message);
    const tokens = estimateTokens(text);

    if (message.role === "assistant") {
      output += tokens;
    } else {
      // system, user, tool messages count as input
      input += tokens;
    }
  }

  return {
    input,
    output,
    total: input + output,
  };
}