# 第 9 章：Human-in-the-Loop

## 安全层

我们已经构建了一个拥有七个工具的 agent。其中四个工具可以修改你的系统：writeFile、deleteFile、runCommand 和 executeCode。现在，agent 会自动批准所有事情：如果 LLM 请求 `deleteFile`，循环会直接执行，不会询问用户。

Human-in-the-Loop（HITL）的意思是：agent 在执行危险操作之前暂停，并询问用户：“我想做这件事，要继续吗？”

这是最后一块拼图。本章结束后，你会拥有一个完整且更安全的 CLI agent。

它建立在第 4 章的执行模式之上：`streamText()` 接收面向模型、没有 `execute` 函数的工具，而 agent loop 保留真正可执行的工具。正是这种分离，让我们可以在任何危险操作真正运行之前先请求审批。

## 架构

HITL 会嵌入第 4 章构建的 agent loop。流程会变成：

```
1. LLM 请求工具调用
2. Agent loop 在执行前收到这个请求
3. 这个工具危险吗？
   - 不危险（readFile、listFiles、webSearch）→ 立即执行
   - 危险（writeFile、deleteFile、runCommand、executeCode）→ 请求审批
4. 用户批准 → 执行
   用户拒绝 → 停止循环，返回已有内容
5. 继续
```

审批机制会使用我们在第 1 章的 `AgentCallbacks` interface 里定义过的 `onToolApproval` callback。现在把它接起来。

## 更新 Agent Loop

第 4 章的 agent loop 已经把工具执行控制在我们手里。关键点是：`streamText()` 拿到的是 `modelTools`，而真正执行时通过 `executeTool()` 使用真实工具：

```typescript
const result = streamText({
  model: provider.chat(MODEL_NAME),
  messages,
  tools: modelTools,
});
```

现在，在循环执行每个工具请求之前加入审批。下面是 `src/agent/run.ts` 里的关键片段：

```typescript
// Process tool calls sequentially with approval for each
let rejected = false;
for (const tc of toolCalls) {
  const approved = await callbacks.onToolApproval(tc.toolName, tc.args);

  if (!approved) {
    rejected = true;
    break;
  }

  const result = await executeTool(tc.toolName, tc.args);
  callbacks.onToolCallEnd(tc.toolName, result);

  messages.push({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text", value: result },
      },
    ],
  });
  reportTokenUsage();
}

if (rejected) {
  break;
}
```

当用户拒绝一个工具调用时：

1. 我们停止处理剩余的工具调用
2. 跳出 agent loop
3. agent 返回目前已经生成的文本

这是一个硬停止。agent 不会获得再次尝试其他方案的机会。在生产系统里，你可能希望行为更温和一些：拒绝这个工具，但让 agent 继续用纯文本回答。对于我们的 CLI agent，硬停止更简单，也更安全。

## 构建终端 UI

现在我们需要一个终端界面，让用户可以：

- 输入消息
- 看到流式响应
- 看到工具调用正在发生
- 批准或拒绝危险工具
- 看到 token 使用情况

我们会使用 **React + Ink**。Ink 是一个把 React 渲染到终端，而不是浏览器 DOM 的 renderer。

### 快速入门：React + Ink

如果你以前没用过 React，这里是 60 秒版本。React 让你用 **组件** 构建 UI：组件就是返回一段“要渲染什么”的函数。组件可以持有 **state**（会随时间变化的数据），当 state 变化时会自动 **重新渲染**。

```typescript
// A component is just a function that returns UI
function Counter() {
  // useState creates a piece of state and a function to update it
  const [count, setCount] = useState(0);

  // When count changes, React re-renders this component
  return <Text>Count: {count}</Text>;
}
```

**Ink** 是终端里的 React。它不是渲染到浏览器 DOM，而是渲染到你的终端。API 几乎一样：

| 浏览器（React DOM） | 终端（Ink） |
|---------------------|-------------|
| `<div>` | `<Box>` |
| `<span>` | `<Text>` |
| `onClick` | `useInput` hook |
| `style={{ display: 'flex' }}` | `<Box flexDirection="column">` |

你只需要知道这些。如果某个东西看起来不熟悉，就先把 `<Box>` 想成 `<div>`，把 `<Text>` 想成 `<span>`，整体模式就会说得通。

### 入口文件

创建 `src/index.ts`：

```typescript
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App));
```

再创建 `src/cli.ts`（给 npm bin 使用）：

```typescript
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App));
```

### Spinner 组件

创建 `src/ui/components/Spinner.tsx`：

```typescript
import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Thinking...' }: SpinnerProps) {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      {' '}
      <Text dimColor>{label}</Text>
    </Text>
  );
}
```

### Input 组件

创建 `src/ui/components/Input.tsx`：

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box>
      <Text color="blue" bold>
        {'> '}
      </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}
    </Box>
  );
}
```

Ink 的 `useInput` hook 会捕获键盘事件。我们处理：

- **Enter**：提交消息
- **Backspace**：删除最后一个字符
- **普通字符**：追加到输入里
- **Ctrl/Meta 组合键**：忽略，避免插入控制字符

agent 工作时会禁用输入，防止用户在响应过程中继续发送消息。

### Message List

创建 `src/ui/components/MessageList.tsx`：

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((message, index) => (
        <Box key={index} flexDirection="column">
          <Text color={message.role === 'user' ? 'blue' : 'green'} bold>
            {message.role === 'user' ? '› You' : '› Assistant'}
          </Text>
          <Box marginLeft={2}>
            <Text>{message.content}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

### 工具调用展示

创建 `src/ui/components/ToolCall.tsx`：

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

export interface ToolCallProps {
  name: string;
  args?: unknown;
  status: 'pending' | 'complete';
  result?: string;
}

export function ToolCall({ name, status, result }: ToolCallProps) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text color="yellow" bold>
          {name}
        </Text>
        {status === 'pending' ? (
          <Text>
            {' '}
            <Text color="cyan">
              <InkSpinner type="dots" />
            </Text>
          </Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
      </Box>
      {status === 'complete' && result && (
        <Box marginLeft={2}>
          <Text dimColor>→ {result.slice(0, 100)}{result.length > 100 ? '...' : ''}</Text>
        </Box>
      )}
    </Box>
  );
}
```

工具调用 pending 时显示 spinner，完成后显示对勾。结果会截断到 100 个字符，让终端保持干净。

### Token Usage 展示

创建 `src/ui/components/TokenUsage.tsx`：

```typescript
import React from "react";
import { Box, Text } from "ink";
import type { TokenUsageInfo } from "../../types.ts";

interface TokenUsageProps {
  usage: TokenUsageInfo | null;
}

export function TokenUsage({ usage }: TokenUsageProps) {
  if (!usage) {
    return null;
  }

  const thresholdPercent = Math.round(usage.threshold * 100);
  const usagePercent = usage.percentage.toFixed(1);

  // Determine color based on usage
  let color: string = "green";
  if (usage.percentage >= usage.threshold * 100) {
    color = "red";
  } else if (usage.percentage >= usage.threshold * 100 * 0.75) {
    color = "yellow";
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        Tokens:{" "}
        <Text color={color} bold>
          {usagePercent}%
        </Text>
        <Text dimColor> (threshold: {thresholdPercent}%)</Text>
      </Text>
    </Box>
  );
}
```

token 展示会随着使用量上升而改变颜色：

- **绿色**：低于阈值的 60%
- **黄色**：达到阈值的 60-100%
- **红色**：超过阈值，接下来会触发压缩

### Tool Approval 组件

这是 HITL 组件，也是本章的核心。创建 `src/ui/components/ToolApproval.tsx`：

```typescript
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ToolApprovalProps {
  toolName: string;
  args: unknown;
  onResolve: (approved: boolean) => void;
}

const MAX_PREVIEW_LINES = 5;

function formatArgs(args: unknown): { preview: string; extraLines: number } {
  const formatted = JSON.stringify(args, null, 2);
  const lines = formatted.split("\n");

  if (lines.length <= MAX_PREVIEW_LINES) {
    return { preview: formatted, extraLines: 0 };
  }

  const preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
  const extraLines = lines.length - MAX_PREVIEW_LINES;
  return { preview, extraLines };
}

function getArgsSummary(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return String(args);
  }

  const obj = args as Record<string, unknown>;
  const meaningfulKeys = ["path", "filePath", "command", "query", "code", "content"];
  for (const key of meaningfulKeys) {
    if (key in obj && typeof obj[key] === "string") {
      const value = obj[key] as string;
      if (value.length > 50) {
        return value.slice(0, 50) + "...";
      }
      return value;
    }
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && typeof obj[keys[0]] === "string") {
    const value = obj[keys[0]] as string;
    if (value.length > 50) {
      return value.slice(0, 50) + "...";
    }
    return value;
  }

  return "";
}

export function ToolApproval({ toolName, args, onResolve }: ToolApprovalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = ["Yes", "No"];

  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
        return;
      }

      if (key.return) {
        onResolve(selectedIndex === 0);
      }
    },
    { isActive: true }
  );

  const argsSummary = getArgsSummary(args);
  const { preview, extraLines } = formatArgs(args);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        Tool Approval Required
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text color="cyan" bold>{toolName}</Text>
          {argsSummary && (
            <Text dimColor>({argsSummary})</Text>
          )}
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>{preview}</Text>
          {extraLines > 0 && (
            <Text color="gray">... +{extraLines} more lines</Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="row" gap={2}>
        {options.map((option, index) => (
          <Text
            key={option}
            color={selectedIndex === index ? "green" : "gray"}
            bold={selectedIndex === index}
          >
            {selectedIndex === index ? "› " : "  "}
            {option}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

审批组件会：

1. **用青色显示工具名**，让你立刻知道哪个工具想运行
2. **显示一行摘要**：对 `runCommand` 来说是命令，对 `writeFile` 来说是路径
3. **用格式化 JSON 显示完整参数**，最多预览 5 行
4. **用上/下箭头** 在 Yes 和 No 之间切换
5. **用 Enter** 确认选择
6. **resolve agent loop 正在等待的 Promise**

`getArgsSummary` 函数会智能选择适合内联展示的参数。它优先展示 `path`、`command`、`query` 和 `code`，也就是各类工具里最有意义的字段。

### 主 App

最后，创建 `src/ui/App.tsx`，把所有东西接起来：

```typescript
import React, { useState, useCallback } from "react";
import { Box, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import { runAgent } from "../agent/run.ts";
import { MessageList, type Message } from "./components/MessageList.tsx";
import { ToolCall, type ToolCallProps } from "./components/ToolCall.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { Input } from "./components/Input.tsx";
import { ToolApproval } from "./components/ToolApproval.tsx";
import { TokenUsage } from "./components/TokenUsage.tsx";
import type { ToolApprovalRequest, TokenUsageInfo } from "../types.ts";

interface ActiveToolCall extends ToolCallProps {
  id: string;
}

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    ModelMessage[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<ToolApprovalRequest | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);

  const handleSubmit = useCallback(
    async (userInput: string) => {
      if (
        userInput.toLowerCase() === "exit" ||
        userInput.toLowerCase() === "quit"
      ) {
        exit();
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: userInput }]);
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

      try {
        const newHistory = await runAgent(userInput, conversationHistory, {
          onToken: (token) => {
            setStreamingText((prev) => prev + token);
          },
          onToolCallStart: (name, args) => {
            setActiveToolCalls((prev) => [
              ...prev,
              {
                id: `${name}-${Date.now()}`,
                name,
                args,
                status: "pending",
              },
            ]);
          },
          onToolCallEnd: (name, result) => {
            setActiveToolCalls((prev) =>
              prev.map((tc) =>
                tc.name === name && tc.status === "pending"
                  ? { ...tc, status: "complete", result }
                  : tc,
              ),
            );
          },
          onComplete: (response) => {
            if (response) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: response },
              ]);
            }
            setStreamingText("");
            setActiveToolCalls([]);
          },
          onToolApproval: (name, args) => {
            return new Promise<boolean>((resolve) => {
              setPendingApproval({ toolName: name, args, resolve });
            });
          },
          onTokenUsage: (usage) => {
            setTokenUsage(usage);
          },
        });

        setConversationHistory(newHistory);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${errorMessage}` },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationHistory, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          🤖 AI Agent
        </Text>
        <Text dimColor> (type "exit" to quit)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <MessageList messages={messages} />

        {streamingText && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              › Assistant
            </Text>
            <Box marginLeft={2}>
              <Text>{streamingText}</Text>
              <Text color="gray">▌</Text>
            </Box>
          </Box>
        )}

        {activeToolCalls.length > 0 && !pendingApproval && (
          <Box flexDirection="column" marginTop={1}>
            {activeToolCalls.map((tc) => (
              <ToolCall
                key={tc.id}
                name={tc.name}
                args={tc.args}
                status={tc.status}
                result={tc.result}
              />
            ))}
          </Box>
        )}

        {isLoading && !streamingText && activeToolCalls.length === 0 && !pendingApproval && (
          <Box marginTop={1}>
            <Spinner />
          </Box>
        )}

        {pendingApproval && (
          <ToolApproval
            toolName={pendingApproval.toolName}
            args={pendingApproval.args}
            onResolve={(approved) => {
              pendingApproval.resolve(approved);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {!pendingApproval && (
        <Input onSubmit={handleSubmit} disabled={isLoading} />
      )}

      <TokenUsage usage={tokenUsage} />
    </Box>
  );
}
```

### UI Barrel

创建 `src/ui/index.tsx`：

```typescript
export { App } from './App.tsx';
export { MessageList, type Message } from './components/MessageList.tsx';
export { ToolCall, type ToolCallProps } from './components/ToolCall.tsx';
export { Spinner } from './components/Spinner.tsx';
export { Input } from './components/Input.tsx';
```

## HITL 流程如何工作

我们用一个具体场景走一遍：

**用户输入：** "Create a file called hello.txt with 'Hello World'"

1. `handleSubmit` 带着用户输入被调用
2. `runAgent` 开始运行并流式输出 token，LLM 决定调用 `writeFile`
3. agent loop 走到 `callbacks.onToolApproval("writeFile", { path: "hello.txt", content: "Hello World" })`
4. callback 创建一个 Promise，并设置 `pendingApproval` state
5. React 重新渲染，`ToolApproval` 组件出现
6. `Input` 组件被隐藏，因为设置了 `pendingApproval`
7. 用户看到：

```
Tool Approval Required
  writeFile(hello.txt)
    {
      "path": "hello.txt",
      "content": "Hello World"
    }
  › Yes    No
```

8. 用户按 Enter（Yes 是默认选项），调用 `onResolve(true)`
9. Promise resolve 为 `true`，agent loop 继续
10. `executeTool("writeFile", ...)` 运行，文件被创建
11. agent loop 继续，LLM 生成响应文本

模型第一次请求 `writeFile` 时，文件并不会被创建。只有当审批 Promise resolve，并且循环调用 `executeTool()` 之后，文件才会被创建。

如果用户选择了 No：

- Promise resolve 为 `false`
- agent loop 里 `rejected = true`
- 循环立刻中断
- agent 返回它当时已有的文本

## Promise 模式

审批机制使用了一个巧妙的模式：**用 Promise 在 React state 和 agent loop 之间通信**。

```typescript
onToolApproval: (name, args) => {
  return new Promise<boolean>((resolve) => {
    setPendingApproval({ toolName: name, args, resolve });
  });
},
```

agent loop 正在 `await` 这个 Promise。同时，React 组件持有 `resolve` 函数的引用。当用户做出选择时，组件调用 `resolve(true)` 或 `resolve(false)`，agent loop 就会被解除阻塞。

这连接了两个世界：

- **agent loop**：异步、顺序执行、等待结果
- **React UI**：事件驱动、state 变化时重新渲染

## 运行完整 Agent

```bash
npm run dev
```

现在你已经拥有一个功能完整的 CLI AI agent，它支持：

- 多轮对话
- 流式响应
- 7 个工具（读、写、列出、删除、shell、代码执行、web search）
- 对危险操作进行人工审批
- token 使用量追踪
- 自动对话压缩

试试这些 prompt：

```
> What files are in this project?
> Read the package.json and tell me about the dependencies
> Create a file called test.txt with "Hello from the agent"
> Run ls -la to see all files
> Search the web for the latest Node.js version
```

对于 `writeFile` 和 `runCommand` 调用，真正执行前都会提示你审批。

## 总结

本章中你完成了：

- 使用 React 和 Ink 构建完整终端 UI
- 为危险工具实现 Human-in-the-Loop 审批
- 使用 Promise 模式连接异步 agent 逻辑和 React state
- 创建消息展示、工具调用、输入和 token 使用量组件
- 组装完整应用

恭喜，你已经从零构建了一个 CLI AI agent。从第一次 `npm init` 到最后的审批提示，每一行代码都是你写出来并理解的。

---

## 接下来

核心学习版 agent 已经完成。接下来的章节会把它进一步加固，靠近 OpenCode 和 Claude Code 这类生产级行为：

- **从原型到产品**：理解剩余差距和加固清单
- **会话系统**：保存、恢复和检查持久化对话
- **基于 diff 的编辑**：应用文件修改前先预览
- **权限规则**：从“每次都问”升级到可配置策略
- **高级 shell**：加入超时、流式输出和后台任务基础
- **插件和 MCP**：不修改核心注册表也能加载外部工具

当前架构已经支持这些扩展。callback 系统、工具注册表和消息历史，都是为了继续扩展而设计的。

**祝你构建愉快。**

---

**下一章：[第 10 章：从原型到产品 →](./10-from-prototype-to-product.md)**
