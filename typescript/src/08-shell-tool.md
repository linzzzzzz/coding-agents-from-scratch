# Chapter 8: Shell Tool

> 💻 **Code:** start from the [`lesson-08`](https://github.com/Hendrixer/agents-v2/tree/lesson-08) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## The Most Powerful (and Dangerous) Tool

A shell tool turns your agent into something genuinely powerful. With it, the agent can:

- Install packages (`npm install`)
- Run tests (`npm test`)
- Check git status (`git log`)
- Run any system command

It's also the most dangerous tool. A file write can damage one file. A shell command can damage your entire system. `rm -rf /` is just a string the LLM might generate. This is why Chapter 9 (Human-in-the-Loop) exists.

As in the previous chapters, the tool has an `execute` function, but the model should not run it directly. The agent loop receives the tool request first, then decides whether execution is allowed.

## The Shell Tool

Create `src/agent/tools/shell.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import shell from "shelljs";

/**
 * Run a shell command
 */
export const runCommand = tool({
  description:
    "Execute a shell command and return its output. Use this for system operations, running scripts, or interacting with the operating system.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
  }),
  execute: async ({ command }: { command: string }) => {
    const result = shell.exec(command, { silent: true });

    let output = "";
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += result.stderr;
    }

    if (result.code !== 0) {
      return `Command failed (exit code ${result.code}):\n${output}`;
    }

    return output || "Command completed successfully (no output)";
  },
});
```

We use ShellJS instead of Node's `child_process` because it provides consistent behavior across platforms (Windows, macOS, Linux) and a simpler API.

Key design choices:

- **`{ silent: true }`** — Prevents command output from leaking to the terminal. We capture it and return it to the LLM.
- **Both stdout and stderr** — Commands write to both streams. We combine them so the LLM sees everything.
- **Exit code handling** — Non-zero exit codes mean failure. We tell the LLM the command failed so it can adjust.
- **Empty output handling** — Some successful commands produce no output (like `mkdir`). We provide a confirmation message.

## Code Execution Tool

While we're adding execution capabilities, let's add a more specialized tool: code execution. This is a **composite tool** — internally it writes a file and runs it, combining what would otherwise be two tool calls.

Create `src/agent/tools/codeExecution.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import os from "os";
import shell from "shelljs";

/**
 * Execute code by writing to temp file and running it
 * This is a composite tool that demonstrates doing multiple steps internally
 * vs letting the model orchestrate separate tools (writeFile + runCommand)
 */
export const executeCode = tool({
  description:
    "Execute code for anything you need compute for. Supports JavaScript (Node.js), Python, and TypeScript. Returns the output of the execution.",
  inputSchema: z.object({
    code: z.string().describe("The code to execute"),
    language: z
      .enum(["javascript", "python", "typescript"])
      .describe("The programming language of the code")
      .default("javascript"),
  }),
  execute: async ({
    code,
    language,
  }: {
    code: string;
    language: "javascript" | "python" | "typescript";
  }) => {
    // Determine file extension and run command based on language
    const extensions: Record<string, string> = {
      javascript: ".js",
      python: ".py",
      typescript: ".ts",
    };

    const commands: Record<string, (file: string) => string> = {
      javascript: (file) => `node ${file}`,
      python: (file) => `python3 ${file}`,
      typescript: (file) => `npx tsx ${file}`,
    };

    const ext = extensions[language];
    const getCommand = commands[language];
    const tmpFile = path.join(os.tmpdir(), `code-exec-${Date.now()}${ext}`);

    try {
      // Write code to temp file
      await fs.writeFile(tmpFile, code, "utf-8");

      // Execute the code
      const command = getCommand(tmpFile);
      const result = shell.exec(command, { silent: true });

      let output = "";
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        output += result.stderr;
      }

      if (result.code !== 0) {
        return `Execution failed (exit code ${result.code}):\n${output}`;
      }

      return output || "Code executed successfully (no output)";
    } catch (error) {
      const err = error as Error;
      return `Error executing code: ${err.message}`;
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
```

### Composite Tool Design

The `executeCode` tool is an interesting design choice. The agent could accomplish the same thing with two calls:

```
1. writeFile("/tmp/code.js", "console.log('hello')")
2. runCommand("node /tmp/code.js")
```

But the composite tool:
- **Reduces round trips** — One tool call instead of two means fewer LLM calls
- **Handles cleanup** — The `finally` block deletes the temp file automatically
- **Simplifies the LLM's job** — "Execute this code" is clearer than "write a file then run it"
- **Uses `os.tmpdir()`** — Writes to the system temp directory, not the project

The tradeoff: the agent has less control. It can't inspect the temp file between writing and running. For code execution, that's fine. For other workflows, separate tools might be better.

### The `z.enum()` Pattern

```typescript
language: z
  .enum(["javascript", "python", "typescript"])
  .describe("The programming language of the code")
  .default("javascript"),
```

This constrains the LLM to valid choices. Without the enum, the LLM might pass "js", "node", "py", or any other variation. The enum forces it to use exact values that map to our execution logic.

## Updating the Registry

Update `src/agent/tools/index.ts`:

```typescript
import { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
import { runCommand } from "./shell.ts";
import { executeCode } from "./codeExecution.ts";
import { webSearch } from "./webSearch.ts";

// All tools combined for the agent
export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
  runCommand,
  executeCode,
  webSearch,
};

// Export individual tools for selective use in evals
export { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
export { runCommand } from "./shell.ts";
export { executeCode } from "./codeExecution.ts";
export { webSearch } from "./webSearch.ts";

// Tool sets for evals
export const fileTools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};

export const shellTools = {
  runCommand,
};
```

## Shell Tool Evals

Create `evals/data/shell-tools.json`:

```json
[
  {
    "data": {
      "prompt": "Run ls to see what's in the current directory",
      "tools": ["runCommand"]
    },
    "target": {
      "expectedTools": ["runCommand"],
      "category": "golden"
    },
    "metadata": {
      "description": "Explicit shell command request"
    }
  },
  {
    "data": {
      "prompt": "Check if git is installed on this system",
      "tools": ["runCommand"]
    },
    "target": {
      "expectedTools": ["runCommand"],
      "category": "golden"
    },
    "metadata": {
      "description": "System check requires shell"
    }
  },
  {
    "data": {
      "prompt": "What's the current disk usage?",
      "tools": ["runCommand"]
    },
    "target": {
      "expectedTools": ["runCommand"],
      "category": "secondary"
    },
    "metadata": {
      "description": "Likely needs shell for df/du command"
    }
  },
  {
    "data": {
      "prompt": "What is 2 + 2?",
      "tools": ["runCommand"]
    },
    "target": {
      "forbiddenTools": ["runCommand"],
      "category": "negative"
    },
    "metadata": {
      "description": "Simple math should not use shell"
    }
  }
]
```

Create `evals/shell-tools.eval.ts`:

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import { shellTools } from "../src/agent/tools/index.ts";
import {
  toolsSelected,
  toolsAvoided,
  toolSelectionScore,
} from "./evaluators.ts";
import type { EvalData, EvalTarget } from "./types.ts";
import dataset from "./data/shell-tools.json" with { type: "json" };
import { singleTurnExecutor } from "./executors.ts";

const executor = async (data: EvalData) => {
  return singleTurnExecutor(data, shellTools);
};

evaluate({
  data: dataset as Array<{ data: EvalData; target: EvalTarget }>,
  executor,
  evaluators: {
    toolsSelected: (output, target) => {
      if (target?.category !== "golden") return 1;
      return toolsSelected(output, target);
    },
    toolsAvoided: (output, target) => {
      if (target?.category !== "negative") return 1;
      return toolsAvoided(output, target);
    },
    selectionScore: (output, target) => {
      if (target?.category !== "secondary") return 1;
      return toolSelectionScore(output, target);
    },
  },
  config: {
    projectApiKey: process.env.LMNR_API_KEY,
  },
  groupName: "shell-tools-selection",
});
```

Run:

```bash
npm run eval:shell-tools
```

## Security Considerations

The shell tool is powerful but risky. Consider these scenarios:

| User Says | LLM Might Run | Risk |
|-----------|---------------|------|
| "Clean up temp files" | `rm -rf /tmp/*` | Could delete important temp data |
| "Update my packages" | `npm install` | Could introduce vulnerabilities |
| "Check server status" | `curl http://internal-api` | Network access |
| "Optimize disk space" | `rm -rf node_modules` | Deletes dependencies |

None of these are malicious — they're reasonable interpretations of user requests. The problem is that the LLM might be too eager to act.

Mitigations (we'll implement the first one in Chapter 9):

1. **Human approval** — Require user confirmation before executing (Chapter 9)
2. **Allowlists** — Only permit specific commands
3. **Sandboxing** — Run commands in a container
4. **Read-only mode** — Only allow commands that don't modify the system

For our CLI agent, human approval is the right balance. The user is sitting at the terminal and can see what the agent wants to do before the loop runs the command.

## Summary

In this chapter you:

- Built a shell command execution tool
- Created a composite code execution tool
- Learned about the design tradeoffs of composite vs. separate tools
- Used `z.enum()` to constrain LLM choices
- Understood the security implications of shell access

The agent now has seven tools: readFile, writeFile, listFiles, deleteFile, runCommand, executeCode, and webSearch. Four of them are dangerous (writeFile, deleteFile, runCommand, executeCode). In the final chapter, we'll add a human approval gate before the loop executes those dangerous tools.

---

**Next: [Chapter 9: Human-in-the-Loop →](./09-human-in-the-loop.md)**
