# Chapter 19: Subagents

## Why Subagents

A single agent loop can do a lot, but complex coding tasks often benefit from separate roles:

- Planner
- Implementer
- Reviewer
- Test runner
- Researcher

Subagents are not magic. They are separate model calls with narrower instructions and scoped context.

## Subagent Type

**Edit `src/agent/subagents/types.ts`:**

```typescript
export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
}
```

## Define a Reviewer

**Edit `src/agent/subagents/reviewer.ts`:**

```typescript
import type { SubagentDefinition } from "./types.ts";

export const reviewerAgent: SubagentDefinition = {
  name: "reviewer",
  description: "Reviews code changes for bugs, regressions, and missing tests.",
  allowedTools: ["readFile", "listFiles", "runCommand"],
  systemPrompt: `You are a code reviewer.
Find concrete bugs and risks.
Do not rewrite code unless explicitly asked.`,
};
```

## Run a Subagent

**Edit `src/agent/subagents/runSubagent.ts`:**

```typescript
import { generateText, type ModelMessage } from "ai";
import type { SubagentDefinition } from "./types.ts";

export async function runSubagent(
  agent: SubagentDefinition,
  model: Parameters<typeof generateText>[0]["model"],
  task: string,
  context: ModelMessage[],
): Promise<string> {
  const result = await generateText({
    model,
    messages: [
      { role: "system", content: agent.systemPrompt },
      ...context,
      { role: "user", content: task },
    ],
  });

  return result.text;
}
```

## When to Use Subagents

Use subagents for bounded work:

- "Review this diff"
- "Summarize these search results"
- "Create a test plan"

Do not use subagents for every turn. Delegation adds latency, cost, and coordination overhead.

## Manual Test

After making a code change, ask:

```text
Ask the reviewer subagent to review the current diff.
```

Expected behavior:

- Main agent gathers the diff
- Reviewer sees only the diff and relevant context
- Reviewer returns findings, not a full rewrite

## Summary

In this chapter you:

- Defined subagent roles
- Created a reviewer subagent
- Ran a subagent as a separate model call
- Learned when delegation helps and when it adds overhead

---

**Next: [Chapter 20: Agent Evals at Scale →](./20-agent-evals-at-scale.md)**
