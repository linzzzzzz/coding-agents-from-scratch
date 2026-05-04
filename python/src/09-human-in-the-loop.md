# Chapter 9: Human-in-the-Loop


## The Safety Layer

We've built an agent with seven tools. Four of them can modify your system: write_file, delete_file, run_command, and execute_code. Right now, the agent auto-approves everything — if the LLM says "delete this file," it happens immediately.

Human-in-the-Loop (HITL) means the agent pauses before dangerous operations and asks the user: "I want to do this. Should I proceed?"

This is the final piece. After this chapter, you'll have a complete, safe CLI agent.

## The Architecture

HITL fits into the agent loop we built in Chapter 4. The flow becomes:

```
1. LLM requests tool call
2. Is this tool dangerous?
   - No (read_file, list_files, web_search) → Execute immediately
   - Yes (write_file, delete_file, run_command, execute_code) → Ask for approval
3. User approves → Execute
   User rejects → Stop the loop, return what we have
4. Continue
```

The approval mechanism uses the `on_tool_approval` callback we defined in our `AgentCallbacks` dataclass back in Chapter 1.

## Building the Terminal UI

Now we need a terminal interface where users can:
- Type messages
- See streaming responses
- See tool calls happening
- Approve or reject dangerous tools
- See token usage

We'll use **Rich** for output formatting and **Prompt Toolkit** for interactive input. Together, they give us a polished terminal experience.

### Quick Primer: Rich + Prompt Toolkit

If you haven't used these libraries:

**Rich** handles output — colors, panels, tables, spinners, markdown rendering:

```python
from rich.console import Console
from rich.panel import Panel

console = Console()
console.print("[bold green]Hello[/bold green] from Rich!")
console.print(Panel("This is a panel", title="Info"))
```

**Prompt Toolkit** handles input — interactive prompts with history, key bindings, and async support:

```python
from prompt_toolkit import prompt

user_input = prompt(">>> ")
```

Think of Rich as `console.log` on steroids and Prompt Toolkit as `input()` on steroids.

### The Spinner

Create `src/ui/spinner.py`:

```python
from rich.console import Console
from rich.spinner import Spinner as RichSpinner
from rich.live import Live


class Spinner:
    """A terminal spinner for showing loading state."""

    def __init__(self, label: str = "Thinking..."):
        self.console = Console()
        self.label = label
        self.live = None

    def start(self):
        self.live = Live(
            RichSpinner("dots", text=f" {self.label}"),
            console=self.console,
            refresh_per_second=10,
        )
        self.live.start()

    def stop(self):
        if self.live:
            self.live.stop()
            self.live = None
```

### The Message List

Create `src/ui/message_list.py`:

```python
from rich.console import Console
from rich.text import Text


console = Console()


def print_message(role: str, content: str) -> None:
    """Print a chat message with color coding."""
    if role == "user":
        label = Text("› You", style="bold blue")
    else:
        label = Text("› Assistant", style="bold green")

    console.print(label)
    console.print(f"  {content}")
    console.print()
```

### Tool Call Display

Create `src/ui/tool_call.py`:

```python
from rich.console import Console
from rich.text import Text

console = Console()


def print_tool_start(name: str, args: dict = None) -> None:
    """Show a tool call starting."""
    summary = ""
    if args:
        for key in ("path", "command", "query", "code", "content"):
            if key in args and isinstance(args[key], str):
                value = args[key]
                if len(value) > 50:
                    value = value[:50] + "..."
                summary = f"({value})"
                break

    console.print(f"  ⚡ [bold yellow]{name}[/bold yellow]{summary} ...", end="")


def print_tool_end(name: str, result: str) -> None:
    """Show a tool call completed."""
    console.print(" [green]✓[/green]")
    truncated = result[:100] + "..." if len(result) > 100 else result
    console.print(f"    [dim]→ {truncated}[/dim]")
```

### Token Usage Display

Create `src/ui/token_usage.py`:

```python
from rich.console import Console
from rich.panel import Panel
from src.types import TokenUsageInfo

console = Console()


def print_token_usage(usage: TokenUsageInfo) -> None:
    """Display token usage with color-coded percentage."""
    threshold_percent = round(usage.threshold * 100)
    usage_percent = f"{usage.percentage:.1f}"

    # Color based on usage
    if usage.percentage >= usage.threshold * 100:
        color = "red"
    elif usage.percentage >= usage.threshold * 100 * 0.75:
        color = "yellow"
    else:
        color = "green"

    text = f"Tokens: [{color} bold]{usage_percent}%[/{color} bold] [dim](threshold: {threshold_percent}%)[/dim]"
    console.print(Panel(text, border_style="dim"))
```

### The Tool Approval Component

This is the HITL component — the heart of this chapter. Create `src/ui/tool_approval.py`:

```python
import json
from rich.console import Console
from rich.panel import Panel
from prompt_toolkit import prompt
from prompt_toolkit.key_binding import KeyBindings

console = Console()

MAX_PREVIEW_LINES = 5


def format_args_preview(args: dict) -> tuple[str, int]:
    """Format args as JSON preview with line limit."""
    formatted = json.dumps(args, indent=2)
    lines = formatted.split("\n")

    if len(lines) <= MAX_PREVIEW_LINES:
        return formatted, 0

    preview = "\n".join(lines[:MAX_PREVIEW_LINES])
    extra = len(lines) - MAX_PREVIEW_LINES
    return preview, extra


def get_args_summary(args) -> str:
    """Get a one-line summary of the most meaningful arg."""
    if not isinstance(args, dict):
        return str(args)

    for key in ("path", "filePath", "command", "query", "code", "content"):
        if key in args and isinstance(args[key], str):
            value = args[key]
            if len(value) > 50:
                return value[:50] + "..."
            return value

    keys = list(args.keys())
    if keys and isinstance(args[keys[0]], str):
        value = args[keys[0]]
        if len(value) > 50:
            return value[:50] + "..."
        return value

    return ""


def request_approval(tool_name: str, args: dict) -> bool:
    """Show tool approval prompt and return True if approved."""
    console.print()
    console.print("[bold yellow]Tool Approval Required[/bold yellow]")

    summary = get_args_summary(args)
    summary_text = f" [dim]({summary})[/dim]" if summary else ""
    console.print(f"  [bold cyan]{tool_name}[/bold cyan]{summary_text}")

    preview, extra = format_args_preview(args)
    console.print(f"    [dim]{preview}[/dim]")
    if extra > 0:
        console.print(f"    [dim]... +{extra} more lines[/dim]")

    console.print()

    while True:
        try:
            answer = prompt("  Approve? [Y/n] ").strip().lower()
            if answer in ("", "y", "yes"):
                return True
            if answer in ("n", "no"):
                return False
            console.print("  [dim]Please enter Y or N[/dim]")
        except (KeyboardInterrupt, EOFError):
            return False
```

The approval component:

1. **Shows the tool name** in cyan
2. **Shows a one-line summary** — for `run_command`, the command; for `write_file`, the path
3. **Shows the full args** as formatted JSON (truncated to 5 lines)
4. **Prompts Y/n** — Enter defaults to Yes, Ctrl+C defaults to No

### The Main App

Create `src/ui/app.py` — the component that wires everything together:

```python
import asyncio
from typing import Any
from rich.console import Console
from prompt_toolkit import prompt as pt_prompt
from prompt_toolkit.patch_stdout import patch_stdout

from src.agent.run import run_agent
from src.types import AgentCallbacks, TokenUsageInfo
from src.ui.message_list import print_message
from src.ui.tool_call import print_tool_start, print_tool_end
from src.ui.tool_approval import request_approval
from src.ui.token_usage import print_token_usage
from src.ui.spinner import Spinner

console = Console()


def run_app():
    """Main application loop."""
    console.print("[bold magenta]🤖 AI Agent[/bold magenta] [dim](type 'exit' to quit)[/dim]")
    console.print()

    conversation_history: list[dict[str, Any]] = []
    token_usage_info: TokenUsageInfo | None = None

    while True:
        # Get user input
        try:
            user_input = pt_prompt("> ").strip()
        except (KeyboardInterrupt, EOFError):
            console.print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("exit", "quit"):
            console.print("Goodbye!")
            break

        print_message("user", user_input)

        # Track streaming state
        streaming_text = ""
        spinner = Spinner()
        spinner_active = False

        def on_token(token: str):
            nonlocal streaming_text, spinner_active
            if spinner_active:
                spinner.stop()
                spinner_active = False
                console.print("[bold green]› Assistant[/bold green]")
                console.print("  ", end="")
            streaming_text += token
            console.print(token, end="", highlight=False)

        def on_tool_call_start(name: str, args: Any):
            nonlocal spinner_active
            if spinner_active:
                spinner.stop()
                spinner_active = False
            print_tool_start(name, args if isinstance(args, dict) else {})

        def on_tool_call_end(name: str, result: str):
            print_tool_end(name, result)

        def on_complete(response: str):
            nonlocal spinner_active
            if spinner_active:
                spinner.stop()
                spinner_active = False
            if streaming_text:
                console.print()  # Newline after streamed text
            console.print()

        async def on_tool_approval(name: str, args: Any) -> bool:
            return request_approval(name, args if isinstance(args, dict) else {})

        def on_token_usage(usage: TokenUsageInfo):
            nonlocal token_usage_info
            token_usage_info = usage

        # Start spinner
        spinner.start()
        spinner_active = True

        try:
            new_history = run_agent(
                user_input,
                conversation_history,
                AgentCallbacks(
                    on_token=on_token,
                    on_tool_call_start=on_tool_call_start,
                    on_tool_call_end=on_tool_call_end,
                    on_complete=on_complete,
                    on_tool_approval=on_tool_approval,
                    on_token_usage=on_token_usage,
                ),
            )
            conversation_history = new_history
        except Exception as e:
            if spinner_active:
                spinner.stop()
            console.print(f"\n  [red]Error: {e}[/red]")
            console.print()

        # Show token usage
        if token_usage_info:
            print_token_usage(token_usage_info)

        streaming_text = ""
```

### Entry Point

Update `src/main.py`:

```python
from dotenv import load_dotenv

load_dotenv()

from src.ui.app import run_app


def main():
    run_app()


if __name__ == "__main__":
    main()
```

### UI Barrel

Create `src/ui/__init__.py`:

```python
from src.ui.app import run_app
from src.ui.message_list import print_message
from src.ui.tool_call import print_tool_start, print_tool_end
from src.ui.spinner import Spinner
```

## How the HITL Flow Works

Let's trace through a concrete scenario:

**User types:** "Create a file called hello.txt with 'Hello World'"

1. `run_agent` starts, streams tokens, LLM decides to call `write_file`
2. The agent loop hits `callbacks.on_tool_approval("write_file", {...})`
3. The callback calls `request_approval()` which prints the approval prompt
4. The user sees:

```
Tool Approval Required
  write_file(hello.txt)
    {
      "path": "hello.txt",
      "content": "Hello World"
    }

  Approve? [Y/n]
```

5. User presses Enter (Y is default) → returns `True`
6. The agent loop continues → `execute_tool("write_file", ...)` runs → file is created
7. The LLM generates its final response

If the user had typed "n":
- `request_approval` returns `False`
- `rejected = True` in the agent loop
- The loop breaks immediately

## Running the Complete Agent

```bash
python -m src.main
```

You now have a fully functional CLI AI agent with:

- Multi-turn conversations
- Streaming responses
- 7 tools (read, write, list, delete, shell, code execution, web search)
- Human approval for dangerous operations
- Token usage tracking
- Automatic conversation compaction

Try some prompts:

```
> What files are in this project?
> Read the pyproject.toml and tell me about it
> Create a file called test.txt with "Hello from the agent"
> Run ls -la to see all files
> Search the web for the latest Python version
```

For the `write_file` and `run_command` calls, you'll be prompted to approve before they execute.

## Summary

In this chapter you:

- Built a complete terminal UI with Rich and Prompt Toolkit
- Implemented human-in-the-loop approval for dangerous tools
- Created components for message display, tool calls, input, and token usage
- Assembled the complete application

Congratulations — you've built a CLI AI agent from scratch. Every line of code, from the first `pip install` to the final approval prompt, is something you wrote and understand.

---

## What's Next?

Here are some ideas for extending the agent:

- **Persistent memory** — Save conversation summaries to disk
- **Custom tools** — Add tools for your specific workflow
- **Better approval UX** — Allow editing tool args before approving
- **Multi-model support** — Switch between OpenAI, Anthropic, and others
- **Plugin system** — Let users add tools without modifying core code

The architecture supports all of these.

**Happy building.**

---

**Next: [Chapter 10: Going to Production →](./10-going-to-production.md)**
