import { tool } from "ai";
import { z } from "zod";
import shell from "shelljs";
import { execFileSync } from "child_process";

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr)\s+\//,     // rm -rf /
  /mkfs/,                      // format disk
  /dd\s+if=/,                  // raw disk write
  />(\/dev\/|\/etc\/)/,        // redirect to system dirs
  /chmod\s+777/,               // overly permissive
  /curl.*\|\s*(bash|sh)/,      // pipe to shell
];
const SANDBOX_COMMANDS = process.env.SANDBOX_COMMANDS === "true";

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Blocked pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

function executeInSandbox(command: string): string {
  // Mount only the project directory into the container.
  const result = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${process.cwd()}:/workspace`,
      "-w",
      "/workspace",
      "node:20-slim",
      "sh",
      "-c",
      command,
    ],
    { encoding: "utf-8", timeout: 30000 },
  );
  return result;
}




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
    const safety = isCommandSafe(command);
    if (!safety.safe) {
      return `Command blocked: ${safety.reason}`;
    }

    if (SANDBOX_COMMANDS) {
      try {
        return executeInSandbox(command);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        return `Command failed in sandbox: ${err.message}`;
      }
    }

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