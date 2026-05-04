# Chapter 4: The Agent Loop


## The Heart of an Agent

This is the most important chapter in the book. Everything before this was setup. Everything after builds on this.

The agent loop is what transforms a language model from a question-answering machine into an autonomous agent. Here's the pattern:

```
while True:
  1. Send messages to LLM (with tools)
  2. Stream the response
  3. If LLM wants to call tools:
     a. Execute each tool
     b. Add results to message history
     c. Continue the loop
  4. If LLM is done (no tool calls):
     a. Break out of the loop
     b. Return the final response
```

The LLM decides when to stop. It might call one tool, process the result, call another, and then respond with text. Or it might call three tools in one turn, process all results, and respond. The loop keeps going until the LLM says "I'm done — here's my answer."

## The Responses API

We're going to use OpenAI's **Responses API** (`client.responses.create`) — the newer, recommended path for building agents. It's simpler than Chat Completions for tool-using agents because:

- **Tool calls and tool outputs are first-class typed items** in the conversation history, not parallel arrays you have to keep in sync.
- **The system prompt is passed via the `instructions` parameter**, not as a system message in the input.
- **Tool definitions are flat** — `{"type": "function", "name": ..., "parameters": ...}` — no nested `"function": {...}` wrapper. (That's why we used the flat shape from Chapter 2 onwards.)
- **Streaming is event-based.** The stream yields events like `response.output_text.delta` (text chunks) and a final `response.completed` (the full response object). You don't have to reassemble fragmented `delta.tool_calls` from Chat Completions — the completed event hands you the full `output` array containing every item the model produced.

With `stream=True`, the SDK returns an iterator that yields events as they arrive:

```python
stream = client.responses.create(
    model="gpt-5-mini",
    instructions=SYSTEM_PROMPT,
    input=input_items,
    tools=tools,
    stream=True,
)

for event in stream:
    if event.type == "response.output_text.delta":
        # A piece of text arrived
        print(event.delta, end="", flush=True)
    elif event.type == "response.completed":
        # Full response object — walk event.response.output for tool calls
        ...
```

## Input Items

Conversation history with the Responses API is a list of typed *input items*:

- `{"role": "user"|"assistant", "content": "..."}` — plain messages
- `{"type": "function_call", "call_id": ..., "name": ..., "arguments": "..."}` — when the model calls a tool
- `{"type": "function_call_output", "call_id": ..., "output": "..."}` — when you return the result

The `call_id` links a tool result back to the request.

## Building the Agent Loop

Create `src/agent/run.py`:

```python
import json
from typing import Any
from openai import OpenAI
from dotenv import load_dotenv

from src.agent.tools import ALL_TOOLS
from src.agent.execute_tool import execute_tool
from src.agent.system.prompt import SYSTEM_PROMPT
from src.agent.system.filter_messages import filter_compatible_messages
from src.types import AgentCallbacks, ToolCallInfo

load_dotenv()

_client: OpenAI | None = None
MODEL_NAME = "gpt-5-mini"


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def run_agent(
    user_message: str,
    conversation_history: list[dict[str, Any]],
    callbacks: AgentCallbacks,
) -> list[dict[str, Any]]:
    """Run the agent loop using the OpenAI Responses API.

    Conversation history is a list of Responses API "input items":
      - {"role": "user"|"assistant", "content": "..."}
      - {"type": "function_call", "call_id": "...", "name": "...", "arguments": "..."}
      - {"type": "function_call_output", "call_id": "...", "output": "..."}

    The system prompt is sent via the `instructions` parameter, not as a message.
    """
    working_history = filter_compatible_messages(conversation_history)

    input_items: list[dict[str, Any]] = [
        *working_history,
        {"role": "user", "content": user_message},
    ]

    full_response = ""

    while True:
        stream = _get_client().responses.create(
            model=MODEL_NAME,
            instructions=SYSTEM_PROMPT,
            input=input_items,
            tools=ALL_TOOLS if ALL_TOOLS else None,
            stream=True,
        )

        # Stream text deltas to the UI; capture the final response object on
        # `response.completed` so we can read its full output items.
        final_response = None
        current_text = ""

        for event in stream:
            event_type = getattr(event, "type", None)

            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    current_text += delta
                    callbacks.on_token(delta)

            elif event_type == "response.completed":
                final_response = getattr(event, "response", None)

        full_response += current_text

        if final_response is None:
            # Stream ended without a completed event — nothing more to do
            break

        # Walk the output items: append everything (assistant text, reasoning,
        # function_call) to history so the next turn has full context, and
        # collect any function_call items we need to execute.
        function_calls: list[ToolCallInfo] = []

        for item in final_response.output:
            item_dict = item.model_dump(exclude_none=True)
            input_items.append(item_dict)

            if item_dict.get("type") == "function_call":
                try:
                    args = json.loads(item_dict.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                function_calls.append(ToolCallInfo(
                    tool_call_id=item_dict["call_id"],
                    tool_name=item_dict["name"],
                    args=args,
                ))

        # No function calls → the model gave a final answer; we're done
        if not function_calls:
            break

        for tc in function_calls:
            callbacks.on_tool_call_start(tc.tool_name, tc.args)

        # Execute each function call and append the corresponding
        # function_call_output item back into the input.
        for tc in function_calls:
            result = execute_tool(tc.tool_name, tc.args)
            callbacks.on_tool_call_end(tc.tool_name, result)

            input_items.append({
                "type": "function_call_output",
                "call_id": tc.tool_call_id,
                "output": result,
            })

    callbacks.on_complete(full_response)
    return input_items
```

Let's walk through this step by step.

### Function Signature

```python
def run_agent(
    user_message: str,
    conversation_history: list[dict[str, Any]],
    callbacks: AgentCallbacks,
) -> list[dict[str, Any]]:
```

The function takes:
- **`user_message`** — The latest message from the user
- **`conversation_history`** — All previous messages (for multi-turn conversations)
- **`callbacks`** — Functions to notify the UI about streaming tokens, tool calls, etc.

It returns the updated message history, which the caller stores for the next turn.

### Streaming events

While the response streams, we only care about two event types:

- **`response.output_text.delta`** — text chunks. We forward each one to the UI via `callbacks.on_token` and accumulate them locally so we can return the full text at the end.
- **`response.completed`** — the final event that hands us the full `response` object. Its `output` array contains every typed item the model produced this turn (assistant text, reasoning, `function_call`, etc.).

That's it. There's no per-chunk reassembly of fragmented tool call arguments — the SDK does that for us and gives us the complete `function_call` items in `response.output`.

### The Input Item Format

History on the Responses API is a list of typed items rather than role-tagged messages with parallel `tool_calls` arrays. After a turn that calls `list_files`, your `input_items` list looks like:

```python
[
    {"role": "user", "content": "What files are in the current directory?"},
    # The model's tool call — emitted in response.output, appended verbatim
    {
        "type": "function_call",
        "call_id": "call_abc123",
        "name": "list_files",
        "arguments": '{"directory": "."}',
    },
    # Our tool result — we build this and append it
    {
        "type": "function_call_output",
        "call_id": "call_abc123",
        "output": "[dir] src\n[file] README.md",
    },
]
```

The `call_id` links the result back to the request. The next call to `responses.create` sees the full list and the model picks up where it left off.

### The Loop

```python
while True:
    stream = client.responses.create(...)
    # ... stream text deltas, capture final_response on response.completed ...

    # Append every output item to input_items, collect function_call items
    for item in final_response.output:
        input_items.append(item.model_dump(exclude_none=True))
        if item is a function_call:
            function_calls.append(...)

    if not function_calls:
        break  # model gave a final answer

    # Execute each tool, append a function_call_output for each, loop
```

Each iteration:
1. Sends the current input items to the model
2. Streams the response, accumulating text deltas and capturing the final response object
3. Appends every output item to history, then collects any `function_call` items
4. If there are no function calls → the model is done. Break.
5. Otherwise, execute each one, append a matching `function_call_output`, and loop.

## Testing the Loop

Let's test with a simple script. Update `src/main.py`:

```python
from dotenv import load_dotenv
from src.agent.run import run_agent
from src.types import AgentCallbacks

load_dotenv()

history: list = []

result = run_agent(
    "What files are in the current directory? Then read the pyproject.toml file.",
    history,
    AgentCallbacks(
        on_token=lambda token: print(token, end="", flush=True),
        on_tool_call_start=lambda name, args: print(f"\n[Tool] {name} {args}"),
        on_tool_call_end=lambda name, result: print(
            f"[Result] {name}: {result[:100]}..."
        ),
        on_complete=lambda response: print("\n[Done]"),
    ),
)

print(f"\nTotal items: {len(result)}")
```

Run it:

```bash
python -m src.main
```

You should see the agent:
1. Call `list_files` to see the directory contents
2. Call `read_file` to read `pyproject.toml`
3. Respond with a summary of what it found

That's the loop in action. The LLM made two tool calls across potentially multiple loop iterations, got the results, and synthesized a coherent response.

## The Input Item History

After the loop, the `input_items` list looks something like:

```
[user]                  "What files are in the current directory? Then read..."
[function_call]         list_files({"directory": "."})
[function_call_output]  "[dir] src\n[file] pyproject.toml..."
[function_call]         read_file({"path": "pyproject.toml"})
[function_call_output]  "[project]\nname = 'agi'..."
[assistant message]     "Your project has the following files... The pyproject.toml shows..."
```

Note that the system prompt is *not* in this list — it's passed via `instructions` on every call. Everything else is the full conversation history. The LLM sees all of it on each iteration, which is how it maintains context. This is also why context management (Chapter 7) becomes important — this history grows with every interaction.

## Summary

In this chapter you:

- Built the core agent loop on the OpenAI Responses API
- Streamed text deltas to the UI and captured the final response on `response.completed`
- Worked with typed input items (`function_call`, `function_call_output`) instead of role-tagged messages
- Used callbacks to decouple agent logic from UI

This is the engine of the agent. Everything else — more tools, context management, human approval — plugs into this loop. In the next chapter, we'll build multi-turn evaluations to test the full loop.

---

**Next: [Chapter 5: Multi-Turn Evaluations →](./05-multi-turn-evals.md)**
