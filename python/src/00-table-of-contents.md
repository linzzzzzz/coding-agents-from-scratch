# Building Production AI Coding Agents from Scratch — Python Edition

A hands-on guide to building a practical CLI coding agent with tool calling, evaluations, context management, OpenAI-compatible providers, and human-in-the-loop safety — all from scratch using Python.

> Inspired by [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents), [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2), [OpenCode](https://opencode.ai/), and [Claude Code](https://code.claude.com/docs/en/overview). This version expands the learning path toward production coding-agent behavior, OpenAI-compatible providers, clearer instructions, bug fixes, and a revamped web experience.

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

- **Python 3.11+** — Modern Python with type hints
- **OpenAI-compatible API client** — Direct API access with streaming and tool calling
- **Pydantic** — Schema validation for tool parameters
- **Rich** — Beautiful terminal output and formatting
- **Prompt Toolkit** — Interactive terminal input
- **Laminar** — Observability and evaluation framework

## Prerequisites

**Required:**
- Python 3.11+
- An API key from OpenAI or another OpenAI-compatible provider
- Basic Python knowledge (functions, classes, async/await, imports)
- Comfort running commands in a terminal (`pip install`, `python`)

**Not required:**
- Prior experience building CLI tools
- AI/ML background — we explain everything from first principles
- A Laminar API key (optional, for tracking eval results over time)

---

## Table of Contents

### [Chapter 1: Introduction to AI Agents](./01-intro-to-agents.md)
What are AI agents? How do they differ from simple chatbots? Set up the project from scratch and make your first LLM call.

### [Chapter 2: Tool Calling](./02-tool-calling.md)
Define tools with JSON schemas and teach your agent to use them. Understand structured function calling and how LLMs decide which tools to invoke.

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
Build an approval system for dangerous operations. Create a rich terminal UI that lets users approve or reject tool calls before execution.

### [Chapter 10: Going to Production](./10-going-to-production.md)
What's missing between your learning agent and a production agent. Error recovery, sandboxing, rate limiting, prompt injection defense, agent planning, multi-agent orchestration, a production readiness checklist, and recommended reading for going deeper.

---

## How to Read This Book

Each chapter builds on the previous one. You'll write every line of code yourself, starting from `pip init` and ending with a fully functional CLI agent.

Code blocks show exactly what to type. When we modify an existing file, we'll show the full updated file so you always have a clear picture of the current state.

By the end, your project will look like this:

```
agents-v2/
├── src/
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── run.py              # Core agent loop
│   │   ├── execute_tool.py     # Tool dispatcher
│   │   ├── tools/
│   │   │   ├── __init__.py     # Tool registry
│   │   │   ├── file.py         # File operations
│   │   │   ├── shell.py        # Shell commands
│   │   │   ├── web_search.py   # Web search
│   │   │   └── code_execution.py # Code runner
│   │   ├── context/
│   │   │   ├── __init__.py     # Context exports
│   │   │   ├── token_estimator.py
│   │   │   ├── compaction.py
│   │   │   └── model_limits.py
│   │   └── system/
│   │       ├── __init__.py
│   │       ├── prompt.py       # System prompt
│   │       └── filter_messages.py
│   ├── ui/
│   │   ├── __init__.py
│   │   ├── app.py              # Main terminal app
│   │   ├── message_list.py
│   │   ├── tool_call.py
│   │   ├── tool_approval.py
│   │   ├── input_prompt.py
│   │   ├── token_usage.py
│   │   └── spinner.py
│   ├── types.py
│   └── main.py
├── evals/
│   ├── __init__.py
│   ├── types.py
│   ├── evaluators.py
│   ├── executors.py
│   ├── utils.py
│   ├── mocks/
│   │   ├── __init__.py
│   │   └── tools.py
│   ├── file_tools_eval.py
│   ├── shell_tools_eval.py
│   ├── agent_multiturn_eval.py
│   └── data/
│       ├── file_tools.json
│       ├── shell_tools.json
│       └── agent_multiturn.json
├── pyproject.toml
├── requirements.txt
└── .env
```

Let's get started.
