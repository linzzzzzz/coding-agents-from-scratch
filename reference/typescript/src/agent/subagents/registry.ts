import type { SubagentDefinition } from "./types.ts";

export const SUBAGENTS: Record<string, SubagentDefinition> = {
  reviewer: {
    name: "reviewer",
    description: "Reviews code changes for bugs, regressions, and missing tests.",
    allowedTools: ["readFile", "listFiles"],
    systemPrompt: `You are a code review subagent.

Find concrete bugs, regressions, missing tests, and risky assumptions.
Do not rewrite code unless explicitly asked.
Return concise findings with file paths when possible.`,
  },

  explorer: {
    name: "explorer",
    description: "Searches and reads the codebase to answer focused questions.",
    allowedTools: ["readFile", "listFiles"],
    systemPrompt: `You are a read-only exploration subagent.

Search the codebase, read relevant files, and answer the assigned question.
Do not edit, create, delete, or move files.
Return only the findings the primary agent needs.`,
  },
};
