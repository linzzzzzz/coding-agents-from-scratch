# Chapter 2: Tool Calling


## How Tool Calling Works

Tool calling is the mechanism that turns a language model into an agent. Here's the flow:

1. You describe available tools to the LLM (name, description, parameter schema)
2. The user sends a message
3. The LLM decides whether to respond with text or call a tool
4. If it calls a tool, you execute the tool and send the result back
5. The LLM uses the result to form its final response

The critical insight: **the LLM doesn't execute the tools**. It outputs structured JSON saying "I want to call this tool with these arguments." Your code does the actual execution. The LLM is the brain; your code is the hands.

```
User: "What's in my project directory?"

LLM thinks: "I should use the list_files tool"
LLM outputs: { tool: "list_files", args: { directory: "." } }

Your code: executes list_files(".")
Your code: returns result to LLM

LLM thinks: "Now I have the file list, let me respond"
LLM outputs: "Your project contains package.json, src/, and README.md"
```

## Defining a Tool with OpenAI's Format

OpenAI uses JSON Schema to define tools. Each tool has:
- A **name** (identifier)
- A **description** (tells the LLM when to use it)
- **parameters** (JSON Schema defining the inputs)
- An **execute function** (what actually runs — this is our code, not part of the API)

Let's start with the simplest possible tool. Create `src/agent/tools/file.py`:

```python
import os
from typing import Any


def read_file_execute(args: dict[str, Any]) -> str:
    """Execute the read_file tool."""
    file_path = args["path"]
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return f"Error: File not found: {file_path}"
    except Exception as e:
        return f"Error reading file: {e}"


def list_files_execute(args: dict[str, Any]) -> str:
    """Execute the list_files tool."""
    directory = args.get("directory", ".")
    try:
        entries = os.listdir(directory)
        items = []
        for entry in sorted(entries):
            full_path = os.path.join(directory, entry)
            entry_type = "[dir]" if os.path.isdir(full_path) else "[file]"
            items.append(f"{entry_type} {entry}")
        return "\n".join(items) if items else f"Directory {directory} is empty"
    except FileNotFoundError:
        return f"Error: Directory not found: {directory}"
    except Exception as e:
        return f"Error listing directory: {e}"


# Tool definitions in OpenAI's Responses API format (flat)
READ_FILE_TOOL = {
    "type": "function",
    "name": "read_file",
    "description": "Read the contents of a file at the specified path. Use this to examine file contents.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the file to read",
            }
        },
        "required": ["path"],
    },
}

LIST_FILES_TOOL = {
    "type": "function",
    "name": "list_files",
    "description": "List all files and directories in the specified directory path.",
    "parameters": {
        "type": "object",
        "properties": {
            "directory": {
                "type": "string",
                "description": "The directory path to list contents of",
                "default": ".",
            }
        },
    },
}
```

Let's break this down:

**Tool Definition**: The dict with `type`, `name`, `description`, and `parameters` is exactly what OpenAI's Responses API expects. This is sent to the LLM so it knows what tools exist. (Note: this *flat* shape is what the Responses API uses. The older Chat Completions API nested these inside a `"function": {...}` key — we use the Responses API throughout this book.)

**Description**: This is surprisingly important. The LLM reads this to decide whether to use the tool. A vague description like "file tool" would confuse the model. Be specific about *what* the tool does and *when* to use it.

**Parameters**: JSON Schema defining what the tool accepts. The `description` on each property helps the LLM understand what values to provide.

**Execute Function**: This is your code that runs when the tool is called. It receives a dict of arguments and returns a string result. Always handle errors gracefully — the result goes back to the LLM, so error messages should be helpful.

## Building the Tool Registry

Now let's wire tools into a registry. Create `src/agent/tools/__init__.py`:

```python
from src.agent.tools.file import (
    read_file_execute,
    list_files_execute,
    READ_FILE_TOOL,
    LIST_FILES_TOOL,
)

# Map of tool name -> execute function
TOOL_EXECUTORS: dict[str, callable] = {
    "read_file": read_file_execute,
    "list_files": list_files_execute,
}

# All tool definitions for the API
ALL_TOOLS = [
    READ_FILE_TOOL,
    LIST_FILES_TOOL,
]

# Tool sets for evals
FILE_TOOLS = [READ_FILE_TOOL, LIST_FILES_TOOL]
FILE_TOOL_EXECUTORS = {
    "read_file": read_file_execute,
    "list_files": list_files_execute,
}
```

The registry has two parts:
- **`ALL_TOOLS`** — The list of tool definitions sent to the OpenAI API
- **`TOOL_EXECUTORS`** — A dict mapping tool names to their execute functions

## Making a Tool Call

Let's test this with a simple script. Update `src/main.py`:

```python
import json
import os
from dotenv import load_dotenv
from openai import OpenAI
from src.agent.tools import ALL_TOOLS
from src.agent.system.prompt import SYSTEM_PROMPT

load_dotenv()

client = OpenAI()

response = client.responses.create(
    model="gpt-5-mini",
    instructions=SYSTEM_PROMPT,
    input=[
        {"role": "user", "content": "What files are in the current directory?"},
    ],
    tools=ALL_TOOLS,
)

print("Text:", response.output_text)

tool_calls = []
for item in response.output:
    item_dict = item.model_dump(exclude_none=True)
    if item_dict.get("type") == "function_call":
        tool_calls.append({
            "name": item_dict["name"],
            "args": json.loads(item_dict.get("arguments") or "{}"),
        })
print("Tool calls:", json.dumps(tool_calls, indent=2))
```

Run it:

```bash
python -m src.main
```

You should see:

```
Text:
Tool calls: [
  {
    "name": "list_files",
    "args": { "directory": "." }
  }
]
```

Notice the text is empty. The LLM decided to call `list_files` instead of responding with text. It saw the tools available, read their descriptions, and chose the right one.

But there's a problem: the LLM called the tool, but it never got to see the result and form a final text response. That's because the API stops after the tool call — the LLM needs another round to process the tool result and generate text.

This is exactly why we need an **agent loop** — which we'll build in Chapter 4. For now, the important thing is that tool selection works.

## The Tool Execution Pipeline

Before we build the loop, we need a way to dispatch tool calls. Create `src/agent/execute_tool.py`:

```python
from typing import Any
from src.agent.tools import TOOL_EXECUTORS


def execute_tool(name: str, args: dict[str, Any]) -> str:
    """Execute a tool by name with the given arguments."""
    executor = TOOL_EXECUTORS.get(name)

    if executor is None:
        return f"Unknown tool: {name}"

    try:
        result = executor(args)
        return str(result)
    except Exception as e:
        return f"Error executing {name}: {e}"
```

This function takes a tool name and arguments, looks up the executor in our registry, and runs it. It handles two edge cases:

1. **Unknown tool** — Returns an error message (instead of crashing)
2. **Execution errors** — Catches exceptions and returns a message

## How the LLM Chooses Tools

Understanding how tool selection works helps you write better tool descriptions.

When you pass tools to the LLM, the API includes the JSON Schema definitions in the prompt. The LLM sees something like:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "read_file",
      "description": "Read the contents of a file at the specified path.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "The path to the file to read" }
        },
        "required": ["path"]
      }
    }
  ]
}
```

The LLM then decides:
- Should I respond with text, or call a tool?
- If calling a tool, which one?
- What arguments should I pass?

This decision is based entirely on the tool names, descriptions, and parameter descriptions. Good descriptions → good tool selection. Bad descriptions → the LLM picks the wrong tool or doesn't use tools at all.

## Tips for Writing Good Tool Descriptions

1. **Be specific about when to use it**: "Read the contents of a file at the specified path. Use this to examine file contents." tells the LLM exactly when this tool is appropriate.

2. **Describe parameters clearly**: `"description": "The path to the file to read"` is better than just `{"type": "string"}`.

3. **Use defaults wisely**: `"default": "."` means the LLM can call `list_files` without specifying a directory.

4. **Don't overlap**: If two tools do similar things, make the descriptions distinct enough that the LLM can choose correctly.

## Summary

In this chapter you:

- Learned how tool calling works (LLM decides, your code executes)
- Defined tools with JSON Schema in OpenAI's format
- Created a tool registry mapping names to executors
- Built a tool execution dispatcher
- Made your first tool call

The LLM can now select tools, but it can't yet process the results and respond. For that, we need the agent loop. But first, let's build a way to test whether tool selection actually works reliably.

---

**Next: [Chapter 3: Single-Turn Evaluations →](./03-single-turn-evals.md)**
