# Building Production AI Coding Agents from Scratch

A hands-on guide to building a practical CLI coding agent with tool calling, evaluations, context management, OpenAI-compatible providers, and human-in-the-loop safety — all from scratch using TypeScript.

> Inspired by [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents), [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2), [OpenCode](https://opencode.ai/), and [Claude Code](https://code.claude.com/docs/en/overview). This version expands the learning path toward production coding-agent behavior, OpenAI-compatible providers, clearer instructions, bug fixes, and a revamped web experience.

> 💻 **Upstream reference repo:** [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). This course expands from that foundation with provider-flexible configuration, additional production notes, clearer instructions, and fixes discovered while working through the material.

---

## What You'll Build

By the end of this book, you'll have a working CLI AI agent that can:

- Read, write, and manage files on your filesystem
- Execute shell commands
- Search the web
- Execute code in multiple languages
- Manage long conversations with automatic context compaction
- Ask for human approval before performing dangerous operations
- Be tested with single-turn and multi-turn evaluations

## Tech Stack

- **TypeScript** — Type-safe development
- **Vercel AI SDK** — Universal LLM interface with streaming and tool calling
- **OpenAI-compatible provider** — LLM access through a configurable API key, model, and base URL
- **React + Ink** — Terminal UI framework
- **Zod** — Schema validation for tool parameters
- **ShellJS** — Cross-platform shell commands
- **Laminar** — Observability and evaluation framework

## Prerequisites

**Required:**
- Node.js 20+
- An API key from OpenAI or another OpenAI-compatible provider
- Basic TypeScript/JavaScript knowledge (variables, functions, async/await, imports)
- Comfort running commands in a terminal (`npm install`, `npm run`)

**Not required:**
- Prior experience building CLI tools
- React knowledge (a primer is included in Chapter 9)
- AI/ML background — we explain everything from first principles
- A Laminar API key (optional, for tracking eval results over time)

---

## Table of Contents

### [Chapter 1: Introduction to AI Agents](./01-intro-to-agents.md)
What are AI agents? How do they differ from simple chatbots? Set up the project from scratch and make your first LLM call.

### [Chapter 2: Tool Calling](./02-tool-calling.md)
Define tools with Zod schemas and teach your agent to use them. Understand structured function calling and how LLMs decide which tools to invoke.

### [Chapter 3: Single-Turn Evaluations](./03-single-turn-evals.md)
Build an evaluation framework to test whether your agent selects the right tools. Write golden, secondary, and negative test cases.

### [Chapter 4: The Agent Loop](./04-the-agent-loop.md)
Implement the core agent loop — stream responses, detect tool calls, execute them, feed results back, and repeat until the task is done.

### [Chapter 5: Multi-Turn Evaluations](./05-multi-turn-evals.md)
Test full agent conversations with mocked tools. Use LLM-as-judge to score output quality. Evaluate tool ordering and forbidden tool avoidance.

### [Chapter 6: File System Tools](./06-file-system-tools.md)
Add real filesystem tools — read, write, list, and delete files. Handle errors gracefully and give your agent the ability to work with your codebase.

### [Chapter 7: Web Search & Context Management](./07-web-search-context-management.md)
Add web search capabilities. Implement token estimation, context window tracking, and automatic conversation compaction to handle long conversations.

### [Chapter 8: Shell Tool](./08-shell-tool.md)
Give your agent the power to run shell commands. Add a code execution tool that writes to temp files and runs them. Understand the security implications.

### [Chapter 9: Human-in-the-Loop](./09-human-in-the-loop.md)
Build an approval system for dangerous operations. Create a terminal UI with React and Ink that lets users approve or reject tool calls before execution.

### [Chapter 10: Going to Production](./10-going-to-production.md)
What's missing between your learning agent and a production agent. This overview links to focused production notes on reliability, memory, security, tooling, and agent architecture, then closes with a production readiness checklist and recommended reading.

### [Chapter 11: Session System](./11-session-system.md)
Persist conversations as durable sessions. Add session IDs, save/load helpers, resume behavior, and transcript-friendly storage.

### [Chapter 12: Editing with Diffs](./12-editing-with-diffs.md)
Replace blind file overwrites with proposal-first edits. Generate unified diffs, ask for approval, and protect against stale edits.

### [Chapter 13: Permission Rules](./13-permission-rules.md)
Move from asking every time to policy-based approval. Add allow/ask/deny rules for commands, tools, and paths.

### [Chapter 14: Advanced Shell Tool](./14-advanced-shell-tool.md)
Upgrade command execution with process spawning, timeouts, streaming output, and a path toward background tasks.

### [Chapter 15: MCP and Plugins](./15-mcp-and-plugins.md)
Make tools extensible. Load plugin manifests, dynamically import tool maps, and prepare the registry for MCP-style integrations.

### [Chapter 16: Provider Layer](./16-provider-layer.md)
Introduce model profiles for the main agent, summarizer, judge, memory extractor, and fallback models.

### [Chapter 17: Context Engine](./17-context-engine.md)
Move beyond simple compaction. Build explicit context items, budget allocation, file relevance, and tool-result truncation.

### [Chapter 18: Production Terminal UI](./18-production-terminal-ui.md)
Turn the terminal UI into a workbench with sessions, slash commands, approval queues, diffs, tasks, and status surfaces.

### [Chapter 19: Subagents](./19-subagents.md)
Add specialized agents for planning, review, research, and tests. Learn when delegation helps and when it adds overhead.

### [Chapter 20: Agent Evals at Scale](./20-agent-evals-at-scale.md)
Move from mocked tool-selection evals to fixture-based coding evals with deterministic scoring and safety regression tests.

---

## How to Read This Book

Each chapter builds on the previous one. You'll write every line of code yourself, starting from `npm init` and ending with a fully functional CLI agent.

Code blocks show exactly what to type. When we modify an existing file, we'll show the full updated file so you always have a clear picture of the current state.

By the end, your project will look like this:

```
agents-v2/
├── src/
│   ├── agent/
│   │   ├── run.ts              # Core agent loop
│   │   ├── executeTool.ts      # Tool dispatcher
│   │   ├── tools/
│   │   │   ├── index.ts        # Tool registry
│   │   │   ├── file.ts         # File operations
│   │   │   ├── shell.ts        # Shell commands
│   │   │   ├── webSearch.ts    # Web search
│   │   │   └── codeExecution.ts # Code runner
│   │   ├── context/
│   │   │   ├── index.ts        # Context exports
│   │   │   ├── tokenEstimator.ts
│   │   │   ├── compaction.ts
│   │   │   └── modelLimits.ts
│   │   └── system/
│   │       ├── prompt.ts       # System prompt
│   │       └── filterMessages.ts
│   ├── ui/
│   │   ├── App.tsx             # Main terminal app
│   │   ├── index.tsx           # UI exports
│   │   └── components/
│   │       ├── MessageList.tsx
│   │       ├── ToolCall.tsx
│   │       ├── ToolApproval.tsx
│   │       ├── Input.tsx
│   │       ├── TokenUsage.tsx
│   │       └── Spinner.tsx
│   ├── types.ts
│   ├── index.ts
│   └── cli.ts
├── evals/
│   ├── types.ts
│   ├── evaluators.ts
│   ├── executors.ts
│   ├── utils.ts
│   ├── mocks/tools.ts
│   ├── file-tools.eval.ts
│   ├── shell-tools.eval.ts
│   ├── agent-multiturn.eval.ts
│   └── data/
│       ├── file-tools.json
│       ├── shell-tools.json
│       └── agent-multiturn.json
├── package.json
└── tsconfig.json
```

Let's get started.
