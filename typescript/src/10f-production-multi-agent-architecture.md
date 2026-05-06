# Production Multi-Agent Architecture

Multi-agent orchestration lets the system route work to specialized agents instead of forcing one prompt to be good at every task.

---

## Multi-Agent Orchestration

### The Problem

One agent with one system prompt tries to be good at everything. In practice, different tasks need different expertise: code generation needs different prompting than file management or web research.

### The Fix

Create specialized agents and a router:

Create a routing module:

**Edit `src/agent/router.ts`:**

```typescript
interface AgentConfig {
  name: string;
  systemPrompt: string;
  tools: ToolSet;
  model: string;
}

const AGENTS: Record<string, AgentConfig> = {
  coder: {
    name: "Code Agent",
    systemPrompt: "You are an expert programmer...",
    tools: { readFile, writeFile, listFiles, executeCode },
    model: "qwen3.5-flash-2026-02-23",
  },
  researcher: {
    name: "Research Agent",
    systemPrompt: "You are a research assistant...",
    tools: { webSearch, readFile },
    model: "qwen3.5-flash-2026-02-23",
  },
  sysadmin: {
    name: "System Agent",
    systemPrompt: "You are a system administrator...",
    tools: { runCommand, readFile, listFiles },
    model: "qwen3.5-flash-2026-02-23",
  },
};

async function routeToAgent(userMessage: string): Promise<string> {
  const { object } = await generateObject({
    model: provider.chat(process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23"),
    schema: z.object({
      agent: z.enum(["coder", "researcher", "sysadmin"]),
      reason: z.string(),
    }),
    prompt: `Which agent should handle this task?\n\nTask: ${userMessage}\n\nAgents: coder (code tasks), researcher (web research), sysadmin (system operations)`,
  });
  return object.agent;
}
```

### Going Further

- Agents can delegate to other agents
- Shared memory between agents
- Supervisor agent that reviews sub-agent outputs
- Pipeline agents that run in sequence (plan -> execute -> verify)

---
