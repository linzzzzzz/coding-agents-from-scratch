# Production Agent Architecture

Planning and multi-agent orchestration help the system handle larger tasks by making work explicit, reviewable, and easier to coordinate.

---

## 10. Agent Planning

### The Problem

Our agent is reactive — it decides one step at a time. Ask it to "refactor the auth module," and it might start editing files without understanding the full scope. It has no plan.

### The Fix

Add a planning step before execution:

Put the planning prompt near your main system prompt:

**Edit `src/agent/prompt.ts`:**

```typescript
const PLANNING_PROMPT = `Before taking any action, create a plan.

For the given task:
1. List the steps needed to complete it
2. Identify which tools you'll need
3. Note any risks or things to verify
4. Estimate how many tool calls this will take

Output your plan, then proceed with execution.`;

// Prepend to the system prompt for complex tasks
function buildSystemPrompt(taskComplexity: "simple" | "complex"): string {
  if (taskComplexity === "complex") {
    return SYSTEM_PROMPT + "\n\n" + PLANNING_PROMPT;
  }
  return SYSTEM_PROMPT;
}
```

A more sophisticated approach uses a dedicated planning call:

Create a planner helper:

**Edit `src/agent/planner.ts`:**

```typescript
async function planTask(task: string, availableTools: string[]): Promise<string> {
  const { text: plan } = await generateText({
    model: provider.chat(process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23"),
    messages: [
      {
        role: "system",
        content: "You are a task planner. Create a step-by-step plan. Do not execute anything.",
      },
      {
        role: "user",
        content: `Task: ${task}\nAvailable tools: ${availableTools.join(", ")}\n\nCreate a plan.`,
      },
    ],
  });
  return plan;
}
```

Then call the planner from the agent loop:

**Edit `src/agent/run.ts`:**

```typescript
const plan = await planTask(userMessage, Object.keys(tools));
callbacks.onToken(`Plan:\n${plan}\n\nExecuting...\n`);

// Add the plan to context so the agent follows it
messages.push({ role: "assistant", content: `My plan:\n${plan}` });
messages.push({ role: "user", content: "Proceed with the plan." });
```

---

---
## 11. Multi-Agent Orchestration

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
- Pipeline agents that run in sequence (plan → execute → verify)

---
