# Chapter 7: Web Search & Context Management


## Two Problems, One Chapter

This chapter tackles two related problems:

1. **Web Search** — The agent can only work with local files. We need to give it access to the internet.
2. **Context Management** — As conversations grow, we'll exceed the model's context window. We need to track token usage and compress old conversations.

These are related because web search results can be large, which accelerates context window usage.

## Adding Web Search

OpenAI provides a built-in web search tool that runs on their infrastructure. With the Responses API we use it via the `web_search` tool type.

Create `src/agent/tools/web_search.py`:

```python
from typing import Any

# Web search is a provider-managed tool — OpenAI handles execution.
# We just define it so the API knows to enable it.
WEB_SEARCH_TOOL = {
    "type": "web_search",
}


def web_search_execute(args: dict[str, Any]) -> str:
    """Provider tools are executed by OpenAI, not us."""
    return "Provider tool web_search - executed by model provider"
```

That's it. The web search tool is handled entirely by OpenAI's servers. When the LLM decides to search, OpenAI runs the search, gets the results, and feeds them back to the model — all within their infrastructure. We never see the raw search results.

### Provider Tools vs. Local Tools

This is fundamentally different from our file tools:

| | Local Tools (read_file, etc.) | Provider Tools (web_search) |
|---|---|---|
| **Definition** | JSON Schema function | Special type string |
| **Execution** | Our code | OpenAI's servers |
| **Results** | We see them | Embedded in model's response |
| **Control** | Full | None |

### Updating the Registry

Update `src/agent/tools/__init__.py` to include web search:

```python
from src.agent.tools.file import (
    read_file_execute, write_file_execute,
    list_files_execute, delete_file_execute,
    READ_FILE_TOOL, WRITE_FILE_TOOL,
    LIST_FILES_TOOL, DELETE_FILE_TOOL,
)
from src.agent.tools.web_search import WEB_SEARCH_TOOL, web_search_execute

TOOL_EXECUTORS: dict[str, callable] = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
    "web_search": web_search_execute,
}

ALL_TOOLS = [
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    DELETE_FILE_TOOL,
    WEB_SEARCH_TOOL,
]

FILE_TOOLS = [READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL, DELETE_FILE_TOOL]
FILE_TOOL_EXECUTORS = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
}
```

## Filtering Incompatible Messages

Provider tools can return message formats that cause issues when sent back to the API. Web search results may include annotation objects or special content types that the API doesn't accept as input on subsequent calls.

Create `src/agent/system/filter_messages.py`:

```python
from typing import Any


def filter_compatible_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Filter conversation history into a clean Responses API input list.

    The Responses API uses a list of "input items":
      - role-based messages: {"role": "user"|"assistant"|"system", "content": ...}
      - typed items: {"type": "function_call", ...}, {"type": "function_call_output", ...},
        {"type": "web_search_call", ...}, etc.

    We drop empty assistant messages (no useful content) but keep all typed
    items so function_call / function_call_output pairs stay intact for the
    next turn.
    """
    filtered: list[dict[str, Any]] = []

    for msg in messages:
        # Typed items (function_call, function_call_output, web_search_call, …)
        # are always kept verbatim.
        if "type" in msg and "role" not in msg:
            filtered.append(msg)
            continue

        role = msg.get("role")

        if role in ("user", "system", "developer"):
            filtered.append(msg)
            continue

        if role == "assistant":
            content = msg.get("content")
            has_text = False
            if isinstance(content, str) and content.strip():
                has_text = True
            elif isinstance(content, list) and content:
                has_text = True

            if has_text:
                filtered.append(msg)
                continue

        # Anything else (e.g. legacy "tool" role from old transcripts) — skip
        # silently rather than crashing the next request.

    return filtered
```

## Token Estimation

Now let's tackle context management. The first step is knowing how many tokens we're using.

Exact tokenization requires model-specific tokenizers (like `tiktoken`). But for our purposes, an approximation is good enough. Research shows that on average, one token is roughly 3.5–4 characters for English text.

Create `src/agent/context/token_estimator.py`:

```python
import json
from typing import Any
from dataclasses import dataclass


def estimate_tokens(text: str) -> int:
    """Estimate token count using character division.
    Uses 3.75 as the divisor (midpoint of 3.5-4 range).
    """
    return max(1, len(text) // 4 + 1)


def extract_message_text(message: dict[str, Any]) -> str:
    """Extract text content from a Responses API input item.

    Handles:
      - role-based messages: {"role": ..., "content": str | list}
      - typed items: function_call, function_call_output, web_search_call, …
    """
    item_type = message.get("type")

    # Responses API typed items
    if item_type == "function_call":
        return f"{message.get('name', '')}({message.get('arguments', '')})"
    if item_type == "function_call_output":
        return str(message.get("output", ""))
    if item_type and "content" not in message:
        # other typed items (web_search_call, reasoning, etc.) — fall back to dump
        return json.dumps(message)

    content = message.get("content")

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                if "text" in part:
                    parts.append(str(part["text"]))
                elif "value" in part:
                    parts.append(str(part["value"]))
                else:
                    parts.append(json.dumps(part))
        return " ".join(parts)

    if content is None:
        return ""

    return json.dumps(content)


@dataclass
class TokenUsage:
    input: int
    output: int
    total: int


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> TokenUsage:
    """Estimate token counts for a Responses API input item array.
    Separates input (user/system/function results) from output (assistant text,
    function calls, model-generated typed items).
    """
    input_tokens = 0
    output_tokens = 0

    for message in messages:
        text = extract_message_text(message)
        tokens = estimate_tokens(text)

        item_type = message.get("type")
        role = message.get("role")

        is_output = (
            role == "assistant"
            or item_type == "function_call"
            or item_type == "reasoning"
            or item_type == "web_search_call"
        )

        if is_output:
            output_tokens += tokens
        else:
            input_tokens += tokens

    return TokenUsage(
        input=input_tokens,
        output=output_tokens,
        total=input_tokens + output_tokens,
    )
```

## Model Limits

Create `src/agent/context/model_limits.py`:

```python
from src.types import ModelLimits

DEFAULT_THRESHOLD = 0.8

MODEL_LIMITS: dict[str, ModelLimits] = {
    "gpt-5": ModelLimits(
        input_limit=272_000,
        output_limit=128_000,
        context_window=400_000,
    ),
    "gpt-5-mini": ModelLimits(
        input_limit=272_000,
        output_limit=128_000,
        context_window=400_000,
    ),
}

DEFAULT_LIMITS = ModelLimits(
    input_limit=128_000,
    output_limit=16_000,
    context_window=128_000,
)


def get_model_limits(model: str) -> ModelLimits:
    """Get token limits for a specific model."""
    if model in MODEL_LIMITS:
        return MODEL_LIMITS[model]
    if model.startswith("gpt-5"):
        return MODEL_LIMITS["gpt-5"]
    return DEFAULT_LIMITS


def is_over_threshold(
    total_tokens: int,
    context_window: int,
    threshold: float = DEFAULT_THRESHOLD,
) -> bool:
    """Check if token usage exceeds the threshold."""
    return total_tokens > context_window * threshold


def calculate_usage_percentage(total_tokens: int, context_window: int) -> float:
    """Calculate usage percentage."""
    return (total_tokens / context_window) * 100
```

## Conversation Compaction

When the conversation gets too long, we summarize it. Create `src/agent/context/compaction.py`:

```python
from typing import Any
from openai import OpenAI
from src.agent.context.token_estimator import extract_message_text

client = OpenAI()

SUMMARIZATION_PROMPT = """You are a conversation summarizer. Your task is to create a concise summary of the conversation so far that preserves:

1. Key decisions and conclusions reached
2. Important context and facts mentioned
3. Any pending tasks or questions
4. The overall goal of the conversation

Be concise but complete. The summary should allow the conversation to continue naturally.

Conversation to summarize:
"""


def messages_to_text(messages: list[dict[str, Any]]) -> str:
    """Format messages as readable text for summarization."""
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown").upper()
        content = extract_message_text(msg)
        lines.append(f"[{role}]: {content}")
    return "\n\n".join(lines)


def compact_conversation(
    messages: list[dict[str, Any]],
    model: str = "gpt-5-mini",
) -> list[dict[str, Any]]:
    """Compact a conversation by summarizing it with an LLM.

    Returns a new messages array with a summary + acknowledgment.
    """
    # Filter out system messages — they're handled separately
    conversation_messages = [m for m in messages if m.get("role") != "system"]

    if not conversation_messages:
        return []

    conversation_text = messages_to_text(conversation_messages)

    response = client.responses.create(
        model=model,
        input=[
            {"role": "user", "content": SUMMARIZATION_PROMPT + conversation_text}
        ],
    )

    summary = response.output_text

    return [
        {
            "role": "user",
            "content": (
                f"[CONVERSATION SUMMARY]\n"
                f"The following is a summary of our conversation so far:\n\n"
                f"{summary}\n\n"
                f"Please continue from where we left off."
            ),
        },
        {
            "role": "assistant",
            "content": (
                "I understand. I've reviewed the summary of our conversation "
                "and I'm ready to continue. How can I help you next?"
            ),
        },
    ]
```

### Export Barrel

Create `src/agent/context/__init__.py`:

```python
from src.agent.context.token_estimator import (
    estimate_tokens,
    estimate_messages_tokens,
    extract_message_text,
    TokenUsage,
)
from src.agent.context.model_limits import (
    DEFAULT_THRESHOLD,
    get_model_limits,
    is_over_threshold,
    calculate_usage_percentage,
)
from src.agent.context.compaction import compact_conversation
```

## Integrating into the Agent Loop

Update the beginning of `run_agent` in `src/agent/run.py`:

```python
from src.agent.context import (
    estimate_messages_tokens,
    get_model_limits,
    is_over_threshold,
    calculate_usage_percentage,
    compact_conversation,
    DEFAULT_THRESHOLD,
)
from src.agent.system.filter_messages import filter_compatible_messages


def run_agent(
    user_message: str,
    conversation_history: list[dict[str, Any]],
    callbacks: AgentCallbacks,
) -> list[dict[str, Any]]:

    model_limits = get_model_limits(MODEL_NAME)

    # Filter and check if we need to compact
    working_history = filter_compatible_messages(conversation_history)
    pre_check_tokens = estimate_messages_tokens([
        # Count the system prompt towards usage even though it's sent via `instructions`
        {"role": "user", "content": SYSTEM_PROMPT},
        *working_history,
        {"role": "user", "content": user_message},
    ])

    if is_over_threshold(pre_check_tokens.total, model_limits.context_window):
        working_history = compact_conversation(working_history, MODEL_NAME)

    input_items: list[dict[str, Any]] = [
        *working_history,
        {"role": "user", "content": user_message},
    ]

    # Report token usage
    def report_token_usage():
        if callbacks.on_token_usage:
            usage = estimate_messages_tokens(
                [{"role": "user", "content": SYSTEM_PROMPT}, *input_items]
            )
            callbacks.on_token_usage(TokenUsageInfo(
                input_tokens=usage.input,
                output_tokens=usage.output,
                total_tokens=usage.total,
                context_window=model_limits.context_window,
                threshold=DEFAULT_THRESHOLD,
                percentage=calculate_usage_percentage(
                    usage.total, model_limits.context_window
                ),
            ))

    report_token_usage()

    # ... rest of the loop (call report_token_usage() after each turn)
```

## Summary

In this chapter you:

- Added web search as a provider tool
- Built message filtering for provider tool compatibility
- Implemented token estimation and context window tracking
- Created conversation compaction via LLM summarization
- Integrated context management into the agent loop

The agent can now search the web and handle arbitrarily long conversations. In the next chapter, we'll add shell command execution.

---

**Next: [Chapter 8: Shell Tool →](./08-shell-tool.md)**
