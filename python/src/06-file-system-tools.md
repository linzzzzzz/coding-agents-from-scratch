# Chapter 6: File System Tools


## Giving the Agent Hands

So far our agent can read files and list directories. That's useful for answering questions about your codebase, but a real agent needs to *change* things. In this chapter, we'll add `write_file` and `delete_file` — tools that modify the filesystem.

These are the first **dangerous tools** in our agent. Reading files is harmless. Writing and deleting files can cause damage. This distinction will become important in Chapter 9 when we add human-in-the-loop approval.

## Write File Tool

Add to `src/agent/tools/file.py`:

```python
import os
from typing import Any


def write_file_execute(args: dict[str, Any]) -> str:
    """Execute the write_file tool."""
    file_path = args["path"]
    content = args["content"]
    try:
        # Create parent directories if they don't exist
        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully wrote {len(content)} characters to {file_path}"
    except Exception as e:
        return f"Error writing file: {e}"


WRITE_FILE_TOOL = {
    "type": "function",
    "name": "write_file",
    "description": "Write content to a file at the specified path. Creates the file if it doesn't exist, overwrites if it does.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the file to write",
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file",
            },
        },
        "required": ["path", "content"],
    },
}
```

Key detail: `os.makedirs(directory, exist_ok=True)` creates parent directories automatically. If the user asks the agent to write to `src/utils/helpers.py` and the `utils/` directory doesn't exist, it gets created.

## Delete File Tool

```python
def delete_file_execute(args: dict[str, Any]) -> str:
    """Execute the delete_file tool."""
    file_path = args["path"]
    try:
        os.unlink(file_path)
        return f"Successfully deleted {file_path}"
    except FileNotFoundError:
        return f"Error: File not found: {file_path}"
    except Exception as e:
        return f"Error deleting file: {e}"


DELETE_FILE_TOOL = {
    "type": "function",
    "name": "delete_file",
    "description": "Delete a file at the specified path. Use with caution as this is irreversible.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the file to delete",
            }
        },
        "required": ["path"],
    },
}
```

Notice the description says "Use with caution as this is irreversible." This isn't just for humans — the LLM reads this too. It influences the model to be more careful about when it uses this tool.

## Updating the Tool Registry

Update `src/agent/tools/__init__.py`:

```python
from src.agent.tools.file import (
    read_file_execute,
    write_file_execute,
    list_files_execute,
    delete_file_execute,
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    DELETE_FILE_TOOL,
)

# Map of tool name -> execute function
TOOL_EXECUTORS: dict[str, callable] = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
}

# All tool definitions for the API
ALL_TOOLS = [
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    DELETE_FILE_TOOL,
]

# Tool sets for evals
FILE_TOOLS = [READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL, DELETE_FILE_TOOL]
FILE_TOOL_EXECUTORS = {
    "read_file": read_file_execute,
    "write_file": write_file_execute,
    "list_files": list_files_execute,
    "delete_file": delete_file_execute,
}
```

## Error Handling Patterns

All four tools follow the same pattern:

```python
try:
    # Do the operation
    return "Success message"
except FileNotFoundError:
    return f"Error: File not found: {file_path}"
except Exception as e:
    return f"Error: {e}"
```

Important: we return error messages as strings rather than raising exceptions. Why? Because tool results go back to the LLM. If `read_file` fails with "File not found", the LLM can try a different path or ask the user for clarification. If we raised an exception, the agent loop would crash.

This is a general principle: **tools should always return, never raise**. The LLM is the decision-maker. Let it decide how to handle errors.

## Summary

In this chapter you:

- Added `write_file` and `delete_file` tools
- Learned why tools should return errors instead of raising exceptions
- Understood the importance of tool descriptions in influencing LLM behavior
- Updated the tool registry

The agent can now read, write, list, and delete files. But these write and delete operations are dangerous — there's nothing stopping the agent from overwriting important files. We'll fix that in Chapter 9 with human-in-the-loop approval. But first, let's add more capabilities.

---

**Next: [Chapter 7: Web Search & Context Management →](./07-web-search-context-management.md)**
