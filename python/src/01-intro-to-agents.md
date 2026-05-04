# Chapter 1: Introduction to AI Agents


## What is an AI Agent?

A chatbot takes your message, sends it to an LLM, and returns the response. That's one turn — input in, output out.

An **agent** is different. An agent can:

1. **Decide** it needs more information
2. **Use tools** to get that information
3. **Reason** about the results
4. **Repeat** until the task is complete

The key difference is the **loop**. A chatbot is a single function call. An agent is a loop that keeps running until the job is done. The LLM doesn't just generate text — it decides what actions to take, observes the results, and plans its next move.

Here's the mental model:

```
User: "What files are in my project?"

Chatbot: "I can't see your files, but typically a project has..."

Agent:
  → Thinks: "I need to list the files"
  → Calls: list_files(".")
  → Gets: ["package.json", "src/", "README.md"]
  → Responds: "Your project has package.json, a src/ directory, and a README.md"
```

The agent used a **tool** to actually look at the filesystem, then synthesized the result into a response. That's the fundamental pattern we'll build in this book.

## What We're Building

By the end of this book, you'll have a CLI AI agent that runs in your terminal. It will be able to:

- Have multi-turn conversations
- Read and write files
- Run shell commands
- Search the web
- Execute code
- Ask for your permission before doing anything dangerous
- Manage long conversations without running out of context

It's a miniature version of tools like Claude Code or GitHub Copilot in the terminal — and you'll understand every line of code because you wrote it.

## Project Setup

Let's start from zero.

### Initialize the Project

```bash
mkdir agents-v2
cd agents-v2
```

### Create the Virtual Environment

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### Install Dependencies

Create `requirements.txt`:

```
openai>=1.82.0
pydantic>=2.11.0
rich>=14.0.0
prompt-toolkit>=3.0.50
lmnr>=0.7.0
python-dotenv>=1.1.0
```

Install everything:

```bash
pip install -r requirements.txt
```

Here's what each package does:

| Package | Purpose |
|---------|---------|
| `openai` | Official OpenAI Python SDK — chat completions, streaming, tool calling |
| `pydantic` | Data validation and schema definition for tool parameters |
| `rich` | Beautiful terminal output — colors, tables, spinners, markdown |
| `prompt-toolkit` | Interactive terminal input with history and key bindings |
| `lmnr` | Laminar — observability and structured evaluations |
| `python-dotenv` | Load environment variables from `.env` files |

### Project Configuration

Create `pyproject.toml`:

```toml
[project]
name = "agi"
version = "1.0.0"
requires-python = ">=3.11"

[project.scripts]
agi = "src.main:main"
```

This lets users install the agent with `pip install .` and run it as `agi` from anywhere.

### Environment Variables

Create a `.env` file with all the API keys you'll need throughout the book:

```
LLM_API_KEY=your-provider-api-key-here
LLM_MODEL=your-model-name-here
LLM_BASE_URL=https://api.openai.com/v1
LMNR_API_KEY=your-laminar-api-key-here
```

- **`LLM_API_KEY`** — Required. Use an API key from OpenAI or another OpenAI-compatible provider.
- **`LLM_MODEL`** — Required. The model name to call.
- **`LLM_BASE_URL`** — Required for non-default providers. For OpenAI directly, use `https://api.openai.com/v1`; for another compatible provider, use that provider's API base URL.
- **`LMNR_API_KEY`** — Optional but recommended. Get one from [laminar.ai](https://www.lmnr.ai). Used for running evaluations in Chapters 3, 5, and 8. Evals will still run locally without it, but results won't be tracked over time.

And add it to `.gitignore`:

```
.venv
__pycache__
.env
*.pyc
```

### Create the Directory Structure

```bash
mkdir -p src/agent/tools
mkdir -p src/agent/system
mkdir -p src/agent/context
mkdir -p src/ui
mkdir -p evals/data
mkdir -p evals/mocks
```

Create `__init__.py` files so Python treats these as packages:

```bash
touch src/__init__.py
touch src/agent/__init__.py
touch src/agent/tools/__init__.py
touch src/agent/system/__init__.py
touch src/agent/context/__init__.py
touch src/ui/__init__.py
touch evals/__init__.py
touch evals/mocks/__init__.py
```

## Your First LLM Call

Let's make sure everything works. Create `src/main.py`:

```python
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI()

response = client.responses.create(
    model="gpt-5-mini",
    input=[
        {"role": "user", "content": "What is an AI agent in one sentence?"}
    ],
)

print(response.output_text)
```

Run it:

```bash
python -m src.main
```

You should see something like:

```
An AI agent is an autonomous system that perceives its environment,
makes decisions, and takes actions to achieve specific goals.
```

That's a single LLM call. No tools, no loop, no agent — yet.

## Understanding the OpenAI SDK

The OpenAI Python SDK is the foundation we'll build on. It provides:

- **`client.responses.create()`** — Make a single LLM call and get the full response
- **`client.responses.create(stream=True)`** — Stream tokens as they're generated (we'll use this for the agent)
- **Tool calling via `tools` parameter** — Define tools the LLM can call
- **`client.responses.parse()`** — Get structured output with Pydantic models (we'll use this for evals)

The SDK handles authentication, retries, and JSON parsing. We just pass messages and get responses.

## Adding a System Prompt

Agents need personality and guidelines. Create `src/agent/system/prompt.py`:

```python
SYSTEM_PROMPT = """You are a helpful AI assistant. You provide clear, accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question"""
```

This is intentionally simple. The system prompt tells the LLM how to behave. In production agents, this would include detailed instructions about tool usage, safety guidelines, and response formatting. Ours will grow as we add features.

## Defining Types

Create `src/types.py` with the core data structures we'll need:

```python
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, Optional


@dataclass
class ToolCallInfo:
    """Metadata about a tool the LLM wants to call."""
    tool_call_id: str
    tool_name: str
    args: dict[str, Any]


@dataclass
class ModelLimits:
    """Token limits for a model."""
    input_limit: int
    output_limit: int
    context_window: int


@dataclass
class TokenUsageInfo:
    """Current token usage for display."""
    input_tokens: int
    output_tokens: int
    total_tokens: int
    context_window: int
    threshold: float
    percentage: float


@dataclass
class AgentCallbacks:
    """How the agent communicates back to the UI."""
    on_token: Callable[[str], None]
    on_tool_call_start: Callable[[str, Any], None]
    on_tool_call_end: Callable[[str, str], None]
    on_complete: Callable[[str], None]
    on_tool_approval: Callable[[str, Any], Awaitable[bool]]
    on_token_usage: Optional[Callable[[TokenUsageInfo], None]] = None


@dataclass
class ToolApprovalRequest:
    """A pending tool approval for the UI to display."""
    tool_name: str
    args: Any
    resolve: Callable[[bool], None]
```

These data classes define the contract between our agent core and the UI layer:

- **`AgentCallbacks`** — How the agent communicates back to the UI (streaming tokens, tool calls, completions)
- **`ToolCallInfo`** — Metadata about a tool the LLM wants to call
- **`ModelLimits`** — Token limits for context management
- **`TokenUsageInfo`** — Current token usage for display

We use Python's `dataclass` instead of plain dicts for type safety and IDE autocompletion. The `Callable` and `Awaitable` types from `typing` define the callback signatures.

We won't use all of these immediately, but defining them now gives us a clear picture of where we're headed.

## Summary

In this chapter you:

- Learned what makes an agent different from a chatbot (the loop)
- Set up a Python project with the OpenAI SDK
- Made your first LLM call
- Created the system prompt and core type definitions

The project doesn't do much yet — it's just a single LLM call. In the next chapter, we'll teach it to use tools.

---

**Next: [Chapter 2: Tool Calling →](./02-tool-calling.md)**
