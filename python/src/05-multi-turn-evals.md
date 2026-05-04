# Chapter 5: Multi-Turn Evaluations


## Beyond Single Turns

Single-turn evals test tool selection — "given this prompt, does the LLM pick the right tool?" But agents are multi-turn. A real task might require:

1. List the files
2. Read a specific file
3. Modify it
4. Write it back

Testing this requires running the full agent loop with multiple tool calls. But there's a problem: real tools have side effects. You don't want your eval suite creating and deleting files on disk. The solution: **mocked tools**.

## Mocked Tools

A mocked tool has the same name and description as the real tool, but its execute function returns a fixed value instead of doing real work.

We already built `build_mocked_tools` in `evals/utils.py`. Let's also create specific mock helpers. Create `evals/mocks/tools.py`:

```python
from typing import Any


def create_mock_read_file(mock_content: str):
    """Create a mock read_file executor."""
    def execute(args: dict[str, Any]) -> str:
        return mock_content
    return execute


def create_mock_write_file(mock_response: str = None):
    """Create a mock write_file executor."""
    def execute(args: dict[str, Any]) -> str:
        if mock_response:
            return mock_response
        content = args.get("content", "")
        path = args.get("path", "unknown")
        return f"Successfully wrote {len(content)} characters to {path}"
    return execute


def create_mock_list_files(mock_files: list[str]):
    """Create a mock list_files executor."""
    def execute(args: dict[str, Any]) -> str:
        return "\n".join(mock_files)
    return execute


def create_mock_delete_file(mock_response: str = None):
    """Create a mock delete_file executor."""
    def execute(args: dict[str, Any]) -> str:
        if mock_response:
            return mock_response
        return f"Successfully deleted {args.get('path', 'unknown')}"
    return execute


def create_mock_shell(mock_output: str):
    """Create a mock shell command executor."""
    def execute(args: dict[str, Any]) -> str:
        return mock_output
    return execute
```

## The Multi-Turn Executor

Add the multi-turn executor to `evals/executors.py`:

```python
import json
from typing import Any
from openai import OpenAI
from src.agent.system.prompt import SYSTEM_PROMPT
from evals.types import MultiTurnEvalData, MultiTurnResult
from evals.utils import build_mocked_tools

client = OpenAI()


def multi_turn_with_mocks(data: dict[str, Any]) -> MultiTurnResult:
    """Run a multi-turn evaluation with mocked tools using the Responses API."""
    tool_definitions, executor_map = build_mocked_tools(data["mock_tools"])

    # Build the input items list (no system message — that goes in `instructions`).
    if "messages" in data and data["messages"]:
        # Strip any system message from supplied messages — `instructions` carries it.
        input_items = [m for m in data["messages"] if m.get("role") != "system"]
    else:
        input_items = [{"role": "user", "content": data["prompt"]}]

    model = "gpt-5-mini"
    max_steps = 20
    if data.get("config"):
        model = data["config"].get("model", model)
        max_steps = data["config"].get("max_steps", max_steps)

    all_tool_calls: list[str] = []
    steps: list[dict[str, Any]] = []
    final_text = ""

    for step_num in range(max_steps):
        response = client.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=input_items,
            tools=tool_definitions if tool_definitions else None,
        )

        step_data: dict[str, Any] = {}
        step_tool_calls = []
        step_tool_results = []
        step_text = ""

        # Walk every output item: append to history, collect function_calls,
        # and capture any assistant text for the step record.
        function_calls = []
        for item in response.output:
            item_dict = item.model_dump(exclude_none=True)
            input_items.append(item_dict)

            if item_dict.get("type") == "function_call":
                try:
                    args = json.loads(item_dict.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                function_calls.append({
                    "call_id": item_dict["call_id"],
                    "name": item_dict["name"],
                    "args": args,
                })
            elif item_dict.get("type") == "message":
                # Assistant message — extract text from its content parts
                for part in item_dict.get("content", []):
                    if part.get("type") == "output_text":
                        step_text += part.get("text", "")

        if function_calls:
            for fc in function_calls:
                tool_name = fc["name"]
                args = fc["args"]
                all_tool_calls.append(tool_name)
                step_tool_calls.append({"tool_name": tool_name, "args": args})

                executor = executor_map.get(tool_name)
                result = executor(args) if executor else f"Unknown tool: {tool_name}"
                step_tool_results.append({"tool_name": tool_name, "result": result})

                # Append the function_call_output item back into the input
                input_items.append({
                    "type": "function_call_output",
                    "call_id": fc["call_id"],
                    "output": result,
                })

            step_data["tool_calls"] = step_tool_calls
            step_data["tool_results"] = step_tool_results

        if step_text:
            step_data["text"] = step_text
            final_text = step_text

        steps.append(step_data)

        # Stop if the model didn't call any tools this turn (it's done)
        if not function_calls:
            break

    tools_used = list(set(all_tool_calls))

    return MultiTurnResult(
        text=final_text,
        steps=steps,
        tools_used=tools_used,
        tool_call_order=all_tool_calls,
    )
```

Key difference from `single_turn_executor`: we loop up to `max_steps`, executing mocked tools and feeding results back via `function_call_output` items. This simulates the full agent loop without side effects.

## New Evaluators

We need evaluators that understand multi-turn behavior. Add these to `evals/evaluators.py`:

```python
def tool_order_correct(
    output: MultiTurnResult,
    target: MultiTurnTarget,
) -> float:
    """Check if tools were called in the expected order.
    Returns the fraction of expected tools found in sequence.
    """
    if not target.expected_tool_order:
        return 1.0

    actual_order = output.tool_call_order
    expected_idx = 0

    for tool_name in actual_order:
        if tool_name == target.expected_tool_order[expected_idx]:
            expected_idx += 1
            if expected_idx == len(target.expected_tool_order):
                break

    return expected_idx / len(target.expected_tool_order)
```

This evaluator checks **subsequence ordering**. If we expect `[list_files, read_file, write_file]`, the actual order `[list_files, read_file, read_file, write_file]` gets a score of 1.0 — the expected tools appear in sequence, even with extras in between.

## LLM-as-Judge

The most powerful evaluator uses another LLM to judge the output quality:

```python
from pydantic import BaseModel


class JudgeResult(BaseModel):
    score: int  # 1-10
    reason: str


def llm_judge(
    output: MultiTurnResult,
    target: MultiTurnTarget,
) -> float:
    """Use an LLM to judge output quality. Returns 0-1."""
    response = client.responses.parse(
        model="gpt-5.1",
        text_format=JudgeResult,
        instructions="""You are an evaluation judge. Score the agent's response on a scale of 1-10.

Scoring criteria:
- 10: Response fully addresses the task using tool results correctly
- 7-9: Response is mostly correct with minor issues
- 4-6: Response partially addresses the task
- 1-3: Response is mostly incorrect or irrelevant""",
        input=f"""Task: {target.original_task}

Tools called: {json.dumps(output.tool_call_order)}
Tool results provided: {json.dumps(target.mock_tool_results)}

Agent's final response:
{output.text}

Evaluate if this response correctly uses the tool results to answer the task.""",
    )

    return response.output_parsed.score / 10
```

The LLM judge:
1. Gets the original task, the tools that were called, and the mock results
2. Reads the agent's final response
3. Returns a structured score (1-10) with reasoning
4. Uses `client.responses.parse()` with a Pydantic model to guarantee valid output

We use a stronger model (`gpt-5.1`) for judging. The judge model should always be at least as capable as the model being tested.

## Test Data

Create `evals/data/agent_multiturn.json`:

```json
[
  {
    "data": {
      "prompt": "List the files in the current directory, then read the contents of package.json",
      "mock_tools": {
        "list_files": {
          "description": "List all files and directories in the specified directory path.",
          "parameters": { "directory": "The directory to list" },
          "mock_return": "[file] package.json\n[file] tsconfig.json\n[dir] src\n[dir] node_modules"
        },
        "read_file": {
          "description": "Read the contents of a file at the specified path.",
          "parameters": { "path": "The path to the file to read" },
          "mock_return": "{ \"name\": \"agi\", \"version\": \"1.0.0\" }"
        }
      }
    },
    "target": {
      "original_task": "List files and read package.json",
      "expected_tool_order": ["list_files", "read_file"],
      "mock_tool_results": {
        "list_files": "[file] package.json\n[file] tsconfig.json\n[dir] src\n[dir] node_modules",
        "read_file": "{ \"name\": \"agi\", \"version\": \"1.0.0\" }"
      },
      "category": "task-completion"
    }
  },
  {
    "data": {
      "prompt": "What is 2 + 2?",
      "mock_tools": {
        "read_file": {
          "description": "Read the contents of a file at the specified path.",
          "parameters": { "path": "The path to the file to read" },
          "mock_return": "file contents"
        },
        "run_command": {
          "description": "Execute a shell command and return its output.",
          "parameters": { "command": "The command to execute" },
          "mock_return": "command output"
        }
      }
    },
    "target": {
      "original_task": "Answer a simple math question without using tools",
      "forbidden_tools": ["read_file", "run_command"],
      "mock_tool_results": {},
      "category": "negative"
    }
  }
]
```

## Running Multi-Turn Evals

Create `evals/agent_multiturn_eval.py`:

```python
import json
from dotenv import load_dotenv

from evals.executors import multi_turn_with_mocks
from evals.evaluators import tool_order_correct, tools_avoided, llm_judge
from evals.types import MultiTurnTarget, MultiTurnResult

load_dotenv()


def load_dataset(path: str) -> list[dict]:
    with open(path, "r") as f:
        return json.load(f)


def run_eval():
    dataset = load_dataset("evals/data/agent_multiturn.json")

    for i, entry in enumerate(dataset):
        data = entry["data"]
        target_data = entry["target"]

        target = MultiTurnTarget(
            original_task=target_data["original_task"],
            mock_tool_results=target_data.get("mock_tool_results", {}),
            category=target_data["category"],
            expected_tool_order=target_data.get("expected_tool_order"),
            forbidden_tools=target_data.get("forbidden_tools"),
        )

        # Run the executor
        output = multi_turn_with_mocks(data)

        # Run evaluators
        scores = {}
        if target.expected_tool_order:
            scores["tool_order"] = tool_order_correct(output, target)
        if target.forbidden_tools:
            scores["tools_avoided"] = tools_avoided(output, target)

        scores["output_quality"] = llm_judge(output, target)

        # Print result
        prompt = data.get("prompt", "(mid-conversation)")
        status = "✓" if all(v >= 0.7 for v in scores.values()) else "✗"
        print(f"  {status} [{target.category}] {prompt}")
        print(f"    Tools called: {output.tool_call_order}")
        print(f"    Scores: {scores}")
        print()


if __name__ == "__main__":
    print("Multi-Turn Agent Evaluation")
    print("=" * 40)
    run_eval()
```

Run it:

```bash
python -m evals.agent_multiturn_eval
```

## Summary

In this chapter you:

- Built multi-turn evaluations that test the full agent loop
- Created mocked tools for deterministic, side-effect-free testing
- Implemented tool ordering evaluation (subsequence matching)
- Built an LLM-as-judge evaluator for output quality scoring
- Learned why stronger models should judge weaker ones

You now have a complete evaluation framework — single-turn for tool selection, multi-turn for end-to-end behavior. In the next chapter, we'll expand the agent's capabilities with file system tools.

---

**Next: [Chapter 6: File System Tools →](./06-file-system-tools.md)**
