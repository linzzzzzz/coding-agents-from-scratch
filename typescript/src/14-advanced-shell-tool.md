# Chapter 14: Advanced Shell Tool

## Why the Shell Tool Needs More Work

The basic shell tool waits for a command to finish and then returns all output. Production agents need more:

- Timeouts
- Streaming output
- Background tasks
- Cancellation
- Better command metadata

This chapter upgrades the shell tool without turning it into a terminal emulator.

## Shell Result Type

**Edit `src/agent/shell/types.ts`:**

```typescript
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}
```

## Use `spawn` Instead of `shell.exec`

**Edit `src/agent/shell/runShell.ts`:**

```typescript
import { spawn } from "child_process";
import type { ShellResult } from "./types.ts";

export function runShellCommand(
  command: string,
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.(text);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}
```

## Update the Tool

**Edit `src/agent/tools/shell.ts`:**

```typescript
const result = await runShellCommand(command, timeout ?? 30_000);

const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

if (result.timedOut) {
  return `Command timed out:\n${output}`;
}

if (result.exitCode !== 0) {
  return `Command failed (exit code ${result.exitCode}):\n${output}`;
}

return output || "Command completed successfully (no output)";
```

## Background Commands

For long-running commands, add a separate tool later:

```typescript
startBackgroundCommand({ command })
readBackgroundCommand({ id })
stopBackgroundCommand({ id })
```

Do not hide background behavior inside `runCommand`. Make it explicit so the user knows something is still running.

## Manual Test

Timeout:

```text
Run sleep 60 with a 1000ms timeout
```

Expected result:

```text
Command timed out
```

Streaming:

```text
Run node -e "let i=0; setInterval(() => console.log(++i), 500)"
```

You should see output arrive while the command runs if you wire `onOutput` into a callback.

## Summary

In this chapter you:

- Switched from buffered shell execution to process spawning
- Added timeout support
- Created a path toward streaming and background commands

---

**Next: [Chapter 15: MCP and Plugins →](./15-mcp-and-plugins.md)**
