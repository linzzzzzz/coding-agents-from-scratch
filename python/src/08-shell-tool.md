# Chapter 8: Shell Tool


## The Most Powerful (and Dangerous) Tool

A shell tool turns your agent into something genuinely powerful. With it, the agent can:

- Install packages (`pip install`)
- Run tests (`pytest`)
- Check git status (`git log`)
- Run any system command

It's also the most dangerous tool. A file write can damage one file. A shell command can damage your entire system. `rm -rf /` is just a string the LLM might generate. This is why Chapter 9 (Human-in-the-Loop) exists.

## The Shell Tool

Create `src/agent/tools/shell.py`:

```python
import subprocess
from typing import Any


def run_command_execute(args: dict[str, Any]) -> str:
    """Execute a shell command and return its output."""
    command = args["command"]
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += result.stderr

        if result.returncode != 0:
            return f"Command failed (exit code {result.returncode}):\n{output}"

        return output or "Command completed successfully (no output)"

    except subprocess.TimeoutExpired:
        return "Error: Command timed out after 30 seconds"
    except Exception as e:
        return f"Error executing command: {e}"


RUN_COMMAND_TOOL = {
    "type": "function",
    "name": "run_command",
    "description": "Execute a shell command and return its output. Use this for system operations, running scripts, or interacting with the operating system.",
    "parameters": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The shell command to execute",
            }
        },
        "required": ["command"],
    },
}
```

We use Python's built-in `subprocess` module instead of `os.system()` because it gives us:

- **`capture_output=True`** — Captures both stdout and stderr
- **`text=True`** — Returns strings instead of bytes
- **`timeout=30`** — Prevents runaway commands from hanging forever
- **`returncode`** — Tells us if the command succeeded or failed

## Code Execution Tool

Let's add a composite code execution tool. Create `src/agent/tools/code_execution.py`:

```python
import os
import tempfile
import subprocess
from typing import Any


def execute_code_execute(args: dict[str, Any]) -> str:
    """Execute code by writing to a temp file and running it."""
    code = args["code"]
    language = args.get("language", "python")

    extensions = {
        "python": ".py",
        "javascript": ".js",
        "typescript": ".ts",
    }

    commands = {
        "python": lambda f: f"python3 {f}",
        "javascript": lambda f: f"node {f}",
        "typescript": lambda f: f"npx tsx {f}",
    }

    ext = extensions.get(language, ".py")
    get_command = commands.get(language)

    if not get_command:
        return f"Unsupported language: {language}"

    # Write code to temp file
    tmp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=ext, delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp_file = f.name

        # Execute
        command = get_command(tmp_file)
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += result.stderr

        if result.returncode != 0:
            return f"Execution failed (exit code {result.returncode}):\n{output}"

        return output or "Code executed successfully (no output)"

    except subprocess.TimeoutExpired:
        return "Error: Execution timed out after 30 seconds"
    except Exception as e:
        return f"Error executing code: {e}"
    finally:
        # Clean up temp file
        if tmp_file:
            try:
                os.unlink(tmp_file)
            except OSError:
                pass


EXECUTE_CODE_TOOL = {
    "type": "function",
    "name": "execute_code",
    "description": "Execute code for anything you need compute for. Supports Python, JavaScript, and TypeScript. Returns the output of the execution.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "The code to execute",
            },
            "language": {
                "type": "string",
                "enum": ["python", "javascript", "typescript"],
                "description": "The programming language of the code",
                "default": "python",
            },
        },
        "required": ["code"],
    },
}
```

### The `enum` Pattern

```json
"language": {
    "type": "string",
    "enum": ["python", "javascript", "typescript"]
}
```

This constrains the LLM to valid choices. Without the enum, the LLM might pass "py", "node", "js", or any other variation.

## Updating the Registry

Update `src/agent/tools/__init__.py`:

```python
from src.agent.tools.file import (
    read_file_execute, write_file_execute,
    list_files_execute, delete_file_execute,
    READ_FILE_TOOL, WRITE_FILE_TOOL,
    LIST_FILES_TOOL, DELETE_FILE_TOOL,
)
from src.agent.tools.shell import run_command_execute, RUN_COMMAND_TOOL
from src.agent.tools.code_execution import execute_code_execute, EXECUTE_CODE_TOOL
from src.agent.tools.web_search import WEB_SEARCH_TOOL, web_search_execute

TOOL_EXECUTORS: dict[str, callable] = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
    "run_command": run_command_execute,
    "execute_code": execute_code_execute,
    "web_search": web_search_execute,
}

ALL_TOOLS = [
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    DELETE_FILE_TOOL,
    RUN_COMMAND_TOOL,
    EXECUTE_CODE_TOOL,
    WEB_SEARCH_TOOL,
]

FILE_TOOLS = [READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL, DELETE_FILE_TOOL]
FILE_TOOL_EXECUTORS = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
}

SHELL_TOOLS = [RUN_COMMAND_TOOL]
SHELL_TOOL_EXECUTORS = {
    "run_command": run_command_execute,
}
```

## Shell Tool Evals

Create `evals/data/shell_tools.json`:

```json
[
  {
    "data": {
      "prompt": "Run ls to see what's in the current directory",
      "tools": ["run_command"]
    },
    "target": {
      "expected_tools": ["run_command"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "Check if git is installed on this system",
      "tools": ["run_command"]
    },
    "target": {
      "expected_tools": ["run_command"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "What is 2 + 2?",
      "tools": ["run_command"]
    },
    "target": {
      "forbidden_tools": ["run_command"],
      "category": "negative"
    }
  }
]
```

Create `evals/shell_tools_eval.py`:

```python
import json
from dotenv import load_dotenv

from src.agent.tools import SHELL_TOOLS
from evals.executors import single_turn_executor
from evals.evaluators import tools_selected, tools_avoided, tool_selection_score
from evals.types import EvalTarget

load_dotenv()


def run_eval():
    with open("evals/data/shell_tools.json", "r") as f:
        dataset = json.load(f)

    for entry in dataset:
        data = entry["data"]
        target_data = entry["target"]

        target = EvalTarget(
            category=target_data["category"],
            expected_tools=target_data.get("expected_tools"),
            forbidden_tools=target_data.get("forbidden_tools"),
        )

        output = single_turn_executor(data, SHELL_TOOLS)

        scores = {}
        if target.category == "golden":
            scores["tools_selected"] = tools_selected(output, target)
        elif target.category == "negative":
            scores["tools_avoided"] = tools_avoided(output, target)

        status = "✓" if all(v >= 1.0 for v in scores.values()) else "✗"
        print(f"  {status} [{target.category}] {data['prompt']}")
        print(f"    Selected: {output.tool_names}  Scores: {scores}")
        print()


if __name__ == "__main__":
    print("Shell Tools Evaluation")
    print("=" * 40)
    run_eval()
```

Run:

```bash
python -m evals.shell_tools_eval
```

## Security Considerations

The shell tool is powerful but risky. Consider these scenarios:

| User Says | LLM Might Run | Risk |
|-----------|---------------|------|
| "Clean up temp files" | `rm -rf /tmp/*` | Could delete important temp data |
| "Update my packages" | `pip install --upgrade` | Could introduce vulnerabilities |
| "Check server status" | `curl http://internal-api` | Network access |
| "Optimize disk space" | `rm -rf node_modules` | Deletes dependencies |

For our CLI agent, human approval (Chapter 9) is the right balance. The user is sitting at the terminal and can see what the agent wants to do before it runs.

## Summary

In this chapter you:

- Built a shell command execution tool with `subprocess`
- Created a composite code execution tool
- Used JSON Schema `enum` to constrain LLM choices
- Understood the security implications of shell access

The agent now has seven tools. Four of them are dangerous. In the final chapter, we'll add a human approval gate to keep the agent safe.

---

**Next: [Chapter 9: Human-in-the-Loop →](./09-human-in-the-loop.md)**
