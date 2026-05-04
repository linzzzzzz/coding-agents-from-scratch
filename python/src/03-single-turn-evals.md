# Chapter 3: Single-Turn Evaluations


## Why Evaluate?

You've defined tools and the LLM seems to pick the right ones. But "seems to" isn't good enough. LLMs are probabilistic — they might select the right tool 90% of the time but fail on edge cases. Without evaluations, you won't know until a user hits the bug.

Evaluations (evals) are automated tests for LLM behavior. They answer questions like:

- Does the LLM pick `read_file` when asked to read a file?
- Does it avoid `delete_file` when asked to list files?
- When the prompt is ambiguous, does it choose reasonable tools?

In this chapter, we'll build **single-turn evals** — tests that check tool selection on a single user message without executing the tools or running the agent loop.

## The Eval Architecture

Our eval system has three parts:

1. **Dataset** — Test cases with inputs and expected outputs
2. **Executor** — Runs the LLM with the test input
3. **Evaluators** — Score the output against expectations

```
Dataset → Executor → Evaluators → Scores
```

Each test case has:
- `data`: The input (user prompt + available tools)
- `target`: The expected behavior (which tools should/shouldn't be selected)

## Defining the Types

Create `evals/types.py`:

```python
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class EvalData:
    """Input data for single-turn tool selection evaluations."""
    prompt: str
    tools: list[str]
    system_prompt: Optional[str] = None
    config: Optional[dict[str, Any]] = None


@dataclass
class EvalTarget:
    """Target expectations for single-turn evaluations."""
    category: str  # "golden", "secondary", or "negative"
    expected_tools: Optional[list[str]] = None
    forbidden_tools: Optional[list[str]] = None


@dataclass
class SingleTurnResult:
    """Result from single-turn executor."""
    tool_calls: list[dict[str, Any]]
    tool_names: list[str]
    selected_any: bool


@dataclass
class MockToolConfig:
    """Mock tool configuration for multi-turn evaluations."""
    description: str
    parameters: dict[str, str]
    mock_return: str


@dataclass
class MultiTurnEvalData:
    """Input data for multi-turn agent evaluations."""
    mock_tools: dict[str, MockToolConfig]
    prompt: Optional[str] = None
    messages: Optional[list[dict[str, Any]]] = None
    config: Optional[dict[str, Any]] = None


@dataclass
class MultiTurnTarget:
    """Target expectations for multi-turn evaluations."""
    original_task: str
    mock_tool_results: dict[str, str]
    category: str  # "task-completion", "conversation-continuation", "negative"
    expected_tool_order: Optional[list[str]] = None
    forbidden_tools: Optional[list[str]] = None


@dataclass
class MultiTurnResult:
    """Result from multi-turn executor."""
    text: str
    steps: list[dict[str, Any]]
    tools_used: list[str]
    tool_call_order: list[str]
```

Three test categories:

- **Golden**: The LLM *must* select specific tools. "Read the file at path.txt" → must select `read_file`.
- **Secondary**: The LLM *should* select certain tools, but there's some ambiguity. Scored on precision/recall.
- **Negative**: The LLM *must not* select certain tools. "What's 2+2?" → must not select `read_file`.

## Building the Executor

The executor takes a test case, runs it through the LLM, and returns the raw result. Create `evals/utils.py`:

```python
import json
from typing import Any
from src.agent.system.prompt import SYSTEM_PROMPT


def build_messages(
    data: dict[str, Any],
) -> list[dict[str, str]]:
    """Build message array from eval data.

    Returns a Responses API input list. The system prompt is also returned in
    the array (as a system message) so existing tests that index msgs[0] /
    msgs[1] keep working — single_turn_executor pulls it out and passes it via
    `instructions` instead.
    """
    system_prompt = data.get("system_prompt") or SYSTEM_PROMPT
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": data["prompt"]},
    ]


def build_mocked_tools(
    mock_tools: dict[str, dict[str, Any]],
) -> tuple[list[dict], dict[str, callable]]:
    """Build OpenAI tool definitions and executors from mock config.

    Returns:
        (tool_definitions, executor_map)
    """
    tool_definitions = []
    executor_map = {}

    for name, config in mock_tools.items():
        # Build parameter properties
        properties = {}
        for param_name in config["parameters"]:
            properties[param_name] = {"type": "string"}

        # Responses API uses the flat tool shape (no nested "function" wrapper).
        tool_def = {
            "type": "function",
            "name": name,
            "description": config["description"],
            "parameters": {
                "type": "object",
                "properties": properties,
            },
        }
        tool_definitions.append(tool_def)

        # Create executor that returns the mock value
        mock_return = config["mock_return"]
        executor_map[name] = lambda args, ret=mock_return: ret

    return tool_definitions, executor_map
```

Now create `evals/executors.py`:

```python
import json
from typing import Any
from openai import OpenAI
from src.agent.system.prompt import SYSTEM_PROMPT
from src.agent.tools import ALL_TOOLS, TOOL_EXECUTORS
from evals.types import EvalData, SingleTurnResult
from evals.utils import build_messages

client = OpenAI()


def single_turn_executor(
    data: dict[str, Any],
    available_tools: list[dict],
) -> SingleTurnResult:
    """Run a single-turn evaluation. Gets tool selection without executing.

    Uses the Responses API. `available_tools` is a list of flat-format tool
    definitions ({"type": "function", "name": ..., ...}).
    """
    msgs = build_messages(data)
    # build_messages returns [system, user]; pull the system out into
    # `instructions` and send the rest as input items.
    system_prompt = msgs[0]["content"]
    input_items = msgs[1:]

    # Filter to only tools specified in data
    tool_names_wanted = set(data["tools"])
    tools = [t for t in available_tools if t.get("name") in tool_names_wanted]

    model = "gpt-5-mini"
    if data.get("config") and data["config"].get("model"):
        model = data["config"]["model"]

    response = client.responses.create(
        model=model,
        instructions=system_prompt,
        input=input_items,
        tools=tools if tools else None,
    )

    # Walk response.output for function_call items
    tool_calls = []
    tool_names = []
    for item in response.output:
        item_dict = item.model_dump(exclude_none=True)
        if item_dict.get("type") == "function_call":
            try:
                args = json.loads(item_dict.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append({"tool_name": item_dict["name"], "args": args})
            tool_names.append(item_dict["name"])

    return SingleTurnResult(
        tool_calls=tool_calls,
        tool_names=tool_names,
        selected_any=len(tool_names) > 0,
    )
```

Key detail: we use `client.responses.create()` without streaming and don't pass tool results back. We only want to see which tools the LLM *selects*, not what happens when they run. This makes the eval fast and deterministic (no actual file I/O).

## Writing Evaluators

Evaluators are scoring functions. They take the executor's output and the expected target, and return a number between 0 and 1.

Create `evals/evaluators.py`:

```python
import json
from typing import Any, Union
from openai import OpenAI
from pydantic import BaseModel

from evals.types import (
    EvalTarget,
    SingleTurnResult,
    MultiTurnTarget,
    MultiTurnResult,
)

client = OpenAI()


def tools_selected(
    output: Union[SingleTurnResult, MultiTurnResult],
    target: Union[EvalTarget, MultiTurnTarget],
) -> float:
    """Check if all expected tools were selected. Returns 1 or 0."""
    expected = getattr(target, "expected_tools", None) or getattr(
        target, "expected_tool_order", None
    )
    if not expected:
        return 1.0

    selected = set(
        output.tool_names if hasattr(output, "tool_names") else output.tools_used
    )
    return 1.0 if all(t in selected for t in expected) else 0.0


def tools_avoided(
    output: Union[SingleTurnResult, MultiTurnResult],
    target: Union[EvalTarget, MultiTurnTarget],
) -> float:
    """Check if forbidden tools were avoided. Returns 1 or 0."""
    forbidden = target.forbidden_tools
    if not forbidden:
        return 1.0

    selected = set(
        output.tool_names if hasattr(output, "tool_names") else output.tools_used
    )
    return 0.0 if any(t in selected for t in forbidden) else 1.0


def tool_selection_score(
    output: SingleTurnResult,
    target: EvalTarget,
) -> float:
    """Precision/recall F1 score for tool selection. Returns 0 to 1."""
    if not target.expected_tools:
        return 0.5 if output.selected_any else 1.0

    expected = set(target.expected_tools)
    selected = set(output.tool_names)

    hits = len([t for t in output.tool_names if t in expected])
    precision = hits / len(selected) if selected else 0.0
    recall = hits / len(expected) if expected else 0.0

    if precision + recall == 0:
        return 0.0
    return (2 * precision * recall) / (precision + recall)
```

Three evaluators for three categories:

- **`tools_selected`** — Binary: did the LLM select ALL expected tools? (1 or 0)
- **`tools_avoided`** — Binary: did the LLM avoid ALL forbidden tools? (1 or 0)
- **`tool_selection_score`** — Continuous: F1-score measuring precision and recall (0 to 1)

## Creating Test Data

Create the test dataset at `evals/data/file_tools.json`:

```json
[
  {
    "data": {
      "prompt": "Read the contents of README.md",
      "tools": ["read_file", "write_file", "list_files", "delete_file"]
    },
    "target": {
      "expected_tools": ["read_file"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "What files are in the src directory?",
      "tools": ["read_file", "write_file", "list_files", "delete_file"]
    },
    "target": {
      "expected_tools": ["list_files"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "Show me what's in the project",
      "tools": ["read_file", "write_file", "list_files", "delete_file"]
    },
    "target": {
      "expected_tools": ["list_files"],
      "category": "secondary"
    }
  },
  {
    "data": {
      "prompt": "What is the capital of France?",
      "tools": ["read_file", "write_file", "list_files", "delete_file"]
    },
    "target": {
      "forbiddenTools": ["read_file", "write_file", "list_files", "delete_file"],
      "category": "negative"
    }
  },
  {
    "data": {
      "prompt": "Tell me a joke",
      "tools": ["read_file", "write_file", "list_files", "delete_file"]
    },
    "target": {
      "forbidden_tools": ["read_file", "write_file", "list_files", "delete_file"],
      "category": "negative"
    }
  }
]
```

## Running the Evaluation

Create `evals/file_tools_eval.py`:

```python
import json
import os
from dotenv import load_dotenv

from src.agent.tools import FILE_TOOLS
from evals.executors import single_turn_executor
from evals.evaluators import tools_selected, tools_avoided, tool_selection_score
from evals.types import EvalTarget, SingleTurnResult

load_dotenv()


def load_dataset(path: str) -> list[dict]:
    with open(path, "r") as f:
        return json.load(f)


def run_eval():
    dataset = load_dataset("evals/data/file_tools.json")
    results = []

    for i, entry in enumerate(dataset):
        data = entry["data"]
        target_data = entry["target"]

        target = EvalTarget(
            category=target_data["category"],
            expected_tools=target_data.get("expected_tools"),
            forbidden_tools=target_data.get("forbidden_tools"),
        )

        # Run the executor
        output = single_turn_executor(data, FILE_TOOLS)

        # Run evaluators based on category
        scores = {}
        if target.category == "golden":
            scores["tools_selected"] = tools_selected(output, target)
        elif target.category == "negative":
            scores["tools_avoided"] = tools_avoided(output, target)
        elif target.category == "secondary":
            scores["selection_score"] = tool_selection_score(output, target)

        results.append({
            "prompt": data["prompt"],
            "category": target.category,
            "selected": output.tool_names,
            "scores": scores,
        })

        # Print result
        status = "✓" if all(v >= 1.0 for v in scores.values()) else "✗"
        print(f"  {status} [{target.category}] {data['prompt']}")
        print(f"    Selected: {output.tool_names}")
        print(f"    Scores: {scores}")
        print()

    # Summary
    all_scores = [s for r in results for s in r["scores"].values()]
    avg = sum(all_scores) / len(all_scores) if all_scores else 0
    print(f"Average score: {avg:.2f}")


if __name__ == "__main__":
    print("File Tools Evaluation")
    print("=" * 40)
    run_eval()
```

Run it:

```bash
python -m evals.file_tools_eval
```

You'll see output showing pass/fail for each test case:

```
File Tools Evaluation
========================================
  ✓ [golden] Read the contents of README.md
    Selected: ['read_file']
    Scores: {'tools_selected': 1.0}

  ✓ [golden] What files are in the src directory?
    Selected: ['list_files']
    Scores: {'tools_selected': 1.0}

  ...

Average score: 1.00
```

## Integrating with Laminar (Optional)

If you have a Laminar API key, you can track eval results over time. Update the eval to use the `lmnr` package:

```python
from lmnr import evaluate

evaluate(
    data=dataset,
    executor=lambda data: single_turn_executor(data, FILE_TOOLS),
    evaluators={
        "tools_selected": lambda output, target: tools_selected(output, target),
        "tools_avoided": lambda output, target: tools_avoided(output, target),
    },
    group_name="file-tools-selection",
)
```

## The Value of Evals

Evals might seem like overhead, but they save enormous time:

1. **Catch regressions**: Change the system prompt? Run evals to make sure tool selection still works.
2. **Compare models**: Switch from gpt-5-mini to another model? Evals tell you if it's better or worse.
3. **Guide prompt engineering**: If `tools_avoided` fails, your tool descriptions are too broad. If `tools_selected` fails, they're too narrow.
4. **Build confidence**: Before adding features, know that the foundation is solid.

Think of evals as unit tests for LLM behavior. They're not perfect (LLMs are probabilistic), but they catch the big problems.

## Summary

In this chapter you:

- Built a single-turn evaluation framework
- Created three types of evaluators (golden, secondary, negative)
- Wrote test datasets for file tool selection
- Ran evals with pass/fail output

Your agent can select tools and you can verify that it does so correctly. In the next chapter, we'll build the core agent loop that actually executes tools and lets the LLM process the results.

---

**Next: [Chapter 4: The Agent Loop →](./04-the-agent-loop.md)**
