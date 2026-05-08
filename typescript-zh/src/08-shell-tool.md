# 第 8 章：Shell 工具与代码执行

## 最强大，也是最危险的工具

Shell 工具会让你的 agent 真正变得强大。有了它，agent 可以：

- 安装包（`npm install`）
- 运行测试（`npm test`）
- 查看 git 状态（`git log`）
- 运行任何系统命令

它也是最危险的工具。写文件最多可能破坏一个文件。Shell 命令可能破坏整个系统。`rm -rf /` 对 LLM 来说也只是一个它可能生成的字符串。这就是为什么第 9 章需要引入 Human-in-the-Loop。

和前几章一样，这个工具有一个 `execute` 函数，但模型不应该直接运行它。agent loop 会先收到工具请求，然后再决定是否允许执行。

## Shell 工具

创建 `src/agent/tools/shell.ts`：

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

这里使用 ShellJS，而不是 Node 自带的 `child_process`，是因为 ShellJS 在不同平台（Windows、macOS、Linux）上的行为更一致，API 也更简单。

几个关键设计：

- **`{ silent: true }`**：阻止命令输出直接泄露到终端。我们捕获输出，然后把它返回给 LLM。
- **同时处理 stdout 和 stderr**：命令可能往两个流里写内容。我们把它们合并，让 LLM 能看到完整信息。
- **处理退出码**：非 0 退出码表示失败。我们明确告诉 LLM 命令失败了，这样它可以调整下一步。
- **处理空输出**：有些成功命令不会产生输出，比如 `mkdir`。我们返回一条确认信息。

## 代码执行工具

既然已经开始加入执行能力，我们再加一个更专门的工具：代码执行。这是一个 **组合工具**：它内部会写入文件并运行文件，把原本需要两个工具调用完成的事情合并成一个工具调用。

创建 `src/agent/tools/codeExecution.ts`：

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

### 组合工具设计

`executeCode` 是一个很有意思的设计选择。agent 原本也可以用两个工具调用完成同样的事情：

```
1. writeFile("/tmp/code.js", "console.log('hello')")
2. runCommand("node /tmp/code.js")
```

但组合工具有几个好处：

- **减少往返次数**：一个工具调用代替两个工具调用，意味着更少的 LLM 调用。
- **自动清理**：`finally` 块会自动删除临时文件。
- **降低 LLM 的编排负担**：“执行这段代码”比“先写文件再运行文件”更清晰。
- **使用 `os.tmpdir()`**：写入系统临时目录，而不是写到项目目录。

代价是：agent 的控制力变少了。它不能在写入和运行之间检查临时文件。对于代码执行来说，这通常没问题。对于其他工作流，分开的工具可能更合适。

### `z.enum()` 模式

```typescript
language: z
  .enum(["javascript", "python", "typescript"])
  .describe("The programming language of the code")
  .default("javascript"),
```

这会把 LLM 限制在合法选项里。如果没有 enum，LLM 可能传入 `"js"`、`"node"`、`"py"`，或者其他任何变体。enum 强制它使用能映射到我们执行逻辑的精确值。

## 更新工具注册表

更新 `src/agent/tools/index.ts`：

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

## Shell 工具评测

创建 `evals/data/shell-tools.json`：

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

创建 `evals/shell-tools.eval.ts`：

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

运行：

```bash
npm run eval:shell-tools
```

## 安全注意事项

Shell 工具很强大，但也有风险。看看这些场景：

| 用户说 | LLM 可能运行 | 风险 |
|--------|--------------|------|
| "Clean up temp files" | `rm -rf /tmp/*` | 可能删除重要的临时数据 |
| "Update my packages" | `npm install` | 可能引入有漏洞的依赖 |
| "Check server status" | `curl http://internal-api` | 网络访问 |
| "Optimize disk space" | `rm -rf node_modules` | 删除依赖 |

这些请求本身都不是恶意的，它们都是对用户请求的合理理解。问题在于 LLM 可能太急于行动。

缓解方式包括（我们会在第 9 章实现第一个）：

1. **人工审批**：执行前要求用户确认（第 9 章）
2. **允许列表**：只允许特定命令
3. **沙箱**：在容器中运行命令
4. **只读模式**：只允许不会修改系统的命令

对于我们的 CLI agent，人工审批是一个合适的平衡点。用户就在终端前，可以在循环真正运行命令之前看到 agent 想做什么。

## 总结

本章中你完成了：

- 构建 shell 命令执行工具
- 创建组合式代码执行工具
- 理解组合工具和独立工具之间的设计取舍
- 使用 `z.enum()` 限制 LLM 的选择
- 理解 shell 访问带来的安全影响

现在 agent 有七个工具：readFile、writeFile、listFiles、deleteFile、runCommand、executeCode 和 webSearch。其中四个是危险工具：writeFile、deleteFile、runCommand、executeCode。在最后一章里，我们会在循环执行这些危险工具之前加入人工审批门。

---

**下一章：[第 9 章：Human-in-the-Loop →](./09-human-in-the-loop.md)**
