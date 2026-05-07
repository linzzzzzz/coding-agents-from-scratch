# Chapter 9: Human-in-the-Loop

> 💻 **Code:** start from the [`lesson-09`](https://github.com/Hendrixer/agents-v2/tree/lesson-09) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter. The finished app is on the [`done`](https://github.com/Hendrixer/agents-v2/tree/done) branch.

## The Safety Layer

We've built an agent with seven tools. Four of them can modify your system: writeFile, deleteFile, runCommand, and executeCode. Right now, the agent auto-approves everything — if the LLM requests `deleteFile`, the loop executes it without asking.

Human-in-the-Loop (HITL) means the agent pauses before dangerous operations and asks the user: "I want to do this. Should I proceed?"

This is the final piece. After this chapter, you'll have a complete, safe CLI agent.

This builds on the Chapter 4 execution pattern: `streamText()` receives model-facing tools without `execute` functions, and the agent loop keeps the real executable tools. That separation is what lets us ask for approval before anything dangerous runs.

## The Architecture

HITL fits into the agent loop we built in Chapter 4. The flow becomes:

```
1. LLM requests tool call
2. Agent loop receives the request before execution
3. Is this tool dangerous?
   - No (readFile, listFiles, webSearch) → Execute immediately
   - Yes (writeFile, deleteFile, runCommand, executeCode) → Ask for approval
4. User approves → Execute
   User rejects → Stop the loop, return what we have
5. Continue
```

The approval mechanism uses the `onToolApproval` callback we defined in our `AgentCallbacks` interface back in Chapter 1. Let's wire it up.

## Updating the Agent Loop

The agent loop from Chapter 4 already keeps tool execution under our control. The important part is that `streamText()` gets `modelTools`, while execution uses the real tools through `executeTool()`:

```typescript
const result = streamText({
  model: provider.chat(MODEL_NAME),
  messages,
  tools: modelTools,
});
```

Now add approval before the loop executes each requested tool. Here's the critical section in `src/agent/run.ts`:

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

When the user rejects a tool call:
1. We stop processing remaining tool calls
2. We break out of the agent loop
3. The agent returns whatever text it has so far

This is a hard stop. The agent doesn't get another chance to try a different approach. In a production system, you might want softer behavior — rejecting the tool but letting the agent continue with text. For our CLI agent, the hard stop is simpler and safer.

## Building the Terminal UI

Now we need a terminal interface where users can:
- Type messages
- See streaming responses
- See tool calls happening
- Approve or reject dangerous tools
- See token usage

We'll use **React + Ink** — a React renderer that targets the terminal instead of a browser DOM.

### Quick Primer: React + Ink

If you've never used React, here's the 60-second version. React lets you build UIs from **components** — functions that return a description of what to render. Components can hold **state** (data that changes over time) and **re-render** automatically when state changes.

```typescript
// A component is just a function that returns UI
function Counter() {
  // useState creates a piece of state and a function to update it
  const [count, setCount] = useState(0);

  // When count changes, React re-renders this component
  return <Text>Count: {count}</Text>;
}
```

**Ink** is React for the terminal. Instead of rendering to a browser DOM, it renders to your terminal. The API is almost identical:

| Browser (React DOM) | Terminal (Ink) |
|---------------------|----------------|
| `<div>` | `<Box>` |
| `<span>` | `<Text>` |
| `onClick` | `useInput` hook |
| `style={{ display: 'flex' }}` | `<Box flexDirection="column">` |

That's all you need to know. If something looks unfamiliar, just think of `<Box>` as a `<div>` and `<Text>` as a `<span>`, and the patterns will make sense.

### Entry Point

Create `src/index.ts`:

```typescript
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App));
```

And `src/cli.ts` (for the npm bin):

```typescript
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App));
```

### The Spinner Component

Create `src/ui/components/Spinner.tsx`:

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

### The Input Component

Create `src/ui/components/Input.tsx`:

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

Ink's `useInput` hook captures keyboard events. We handle:
- **Enter** — Submit the message
- **Backspace** — Delete the last character
- **Regular characters** — Append to the input
- **Ctrl/Meta combos** — Ignore (prevents inserting control characters)

The input is disabled while the agent is working, preventing the user from sending messages mid-response.

### The Message List

Create `src/ui/components/MessageList.tsx`:

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

### Tool Call Display

Create `src/ui/components/ToolCall.tsx`:

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

Tool calls show a spinner while pending and a checkmark when complete. Results are truncated to 100 characters to keep the terminal clean.

### Token Usage Display

Create `src/ui/components/TokenUsage.tsx`:

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

The token display changes color as usage increases:
- **Green** — Under 60% of threshold
- **Yellow** — 60-100% of threshold
- **Red** — Over threshold (compaction will trigger)

### The Tool Approval Component

This is the HITL component — the heart of this chapter. Create `src/ui/components/ToolApproval.tsx`:

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

The approval component:

1. **Shows the tool name** in cyan so you immediately know what tool wants to run
2. **Shows a one-line summary** — for `runCommand`, it shows the command; for `writeFile`, the path
3. **Shows the full args** as formatted JSON (truncated to 5 lines)
4. **Up/Down arrows** toggle between Yes and No
5. **Enter** confirms the selection
6. **Resolves the promise** that the agent loop is waiting on

The `getArgsSummary` function is smart about which argument to show inline. It prioritizes `path`, `command`, `query`, and `code` — the most meaningful fields for each tool type.

### The Main App

Finally, create `src/ui/App.tsx` — the component that wires everything together:

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

### The UI Barrel

Create `src/ui/index.tsx`:

```typescript
export { App } from './App.tsx';
export { MessageList, type Message } from './components/MessageList.tsx';
export { ToolCall, type ToolCallProps } from './components/ToolCall.tsx';
export { Spinner } from './components/Spinner.tsx';
export { Input } from './components/Input.tsx';
```

## How the HITL Flow Works

Let's trace through a concrete scenario:

**User types:** "Create a file called hello.txt with 'Hello World'"

1. `handleSubmit` is called with the user input
2. `runAgent` starts, streams tokens, LLM decides to call `writeFile`
3. The agent loop hits `callbacks.onToolApproval("writeFile", { path: "hello.txt", content: "Hello World" })`
4. The callback creates a Promise and sets `pendingApproval` state
5. React re-renders → the `ToolApproval` component appears
6. The `Input` component is hidden (because `pendingApproval` is set)
7. The user sees:

```
Tool Approval Required
  writeFile(hello.txt)
    {
      "path": "hello.txt",
      "content": "Hello World"
    }
  › Yes    No
```

8. User presses Enter (Yes is default) → `onResolve(true)` is called
9. The Promise resolves with `true` → the agent loop continues
10. `executeTool("writeFile", ...)` runs → file is created
11. The agent loop continues, LLM generates response text

The file is not created when the model first requests `writeFile`. It is only created after the approval Promise resolves and the loop calls `executeTool()`.

If the user had selected "No":
- The Promise resolves with `false`
- `rejected = true` in the agent loop
- The loop breaks immediately
- The agent returns whatever text it had

## The Promise Pattern

The approval mechanism uses a clever pattern: **Promise-based communication between React state and the agent loop**.

```typescript
onToolApproval: (name, args) => {
  return new Promise<boolean>((resolve) => {
    setPendingApproval({ toolName: name, args, resolve });
  });
},
```

The agent loop is `await`-ing this Promise. Meanwhile, the React component has a reference to the `resolve` function. When the user makes a choice, the component calls `resolve(true)` or `resolve(false)`, which unblocks the agent loop.

This bridges two worlds:
- The **agent loop** (async, sequential, awaiting results)
- The **React UI** (event-driven, re-rendering on state changes)

## Running the Complete Agent

```bash
npm run dev
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
> Read the package.json and tell me about the dependencies
> Create a file called test.txt with "Hello from the agent"
> Run ls -la to see all files
> Search the web for the latest Node.js version
```

For the `writeFile` and `runCommand` calls, you'll be prompted to approve before they execute.

## Summary

In this chapter you:

- Built a complete terminal UI with React and Ink
- Implemented human-in-the-loop approval for dangerous tools
- Used the Promise pattern to bridge async agent logic and React state
- Created components for message display, tool calls, input, and token usage
- Assembled the complete application

Congratulations — you've built a CLI AI agent from scratch. Every line of code, from the first `npm init` to the final approval prompt, is something you wrote and understand.

---

## What's Next?

The core learning agent is complete. The next chapters harden it toward OpenCode- and Claude Code-style production behavior:

- **From Prototype to Product** — Understand the remaining gaps and hardening checklist
- **Session system** — Save, resume, and inspect durable conversations
- **Diff-based edits** — Preview file changes before applying them
- **Permission rules** — Move from "ask every time" to configurable policy
- **Advanced shell** — Add timeouts, streaming output, and background task foundations
- **Plugins and MCP** — Load external tools without editing the core registry

The architecture supports all of these. The callback system, tool registry, and message history are designed to be extended.

**Happy building.**

---

**Next: [Chapter 10: From Prototype to Product →](./10-from-prototype-to-product.md)**
