# Chapter 13: Permission Rules

## From Prompts to Policy

Human-in-the-loop approval is safe, but asking every time gets old. Production agents need configurable permission rules:

- Always allow `git status`
- Ask before `npm install`
- Deny `rm -rf`
- Allow file edits only inside the project

This chapter adds a simple rule engine.

## Permission Types

**Edit `src/agent/permissions/types.ts`:**

```typescript
export type PermissionDecision = "allow" | "ask" | "deny";

export interface PermissionRule {
  toolName: string;
  pattern: string;
  decision: PermissionDecision;
}
```

## Permission Config

Create a JSON file:

**Edit `.agent/permissions.json`:**

```json
[
  { "toolName": "runCommand", "pattern": "git status", "decision": "allow" },
  { "toolName": "runCommand", "pattern": "rm *", "decision": "deny" },
  { "toolName": "writeFile", "pattern": "*", "decision": "ask" }
]
```

## Loading Rules

**Edit `src/agent/permissions/store.ts`:**

```typescript
import fs from "fs/promises";
import path from "path";
import type { PermissionRule } from "./types.ts";

const PERMISSIONS_PATH = path.join(process.cwd(), ".agent", "permissions.json");

export async function loadPermissionRules(): Promise<PermissionRule[]> {
  try {
    const raw = await fs.readFile(PERMISSIONS_PATH, "utf-8");
    return JSON.parse(raw) as PermissionRule[];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }
}
```

## Matching Rules

Use simple wildcard matching:

**Edit `src/agent/permissions/match.ts`:**

```typescript
import type { PermissionDecision, PermissionRule } from "./types.ts";

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
}

export function decidePermission(
  rules: PermissionRule[],
  toolName: string,
  summary: string,
): PermissionDecision {
  for (const rule of rules) {
    if (rule.toolName !== toolName) continue;
    if (wildcardToRegExp(rule.pattern).test(summary)) {
      return rule.decision;
    }
  }

  return "ask";
}
```

For `runCommand`, the summary can be the command string. For file tools, it can be the path.

## Wiring Into Approval

Before showing the approval prompt:

```typescript
const rules = await loadPermissionRules();
const decision = decidePermission(rules, toolName, summary);

if (decision === "allow") return true;
if (decision === "deny") return false;

return callbacks.onToolApproval(toolName, args);
```

## Manual Test

Add this rule:

```json
{ "toolName": "runCommand", "pattern": "pwd", "decision": "allow" }
```

Ask:

```text
Run pwd
```

The agent should run it without asking. Then add:

```json
{ "toolName": "runCommand", "pattern": "rm *", "decision": "deny" }
```

Ask:

```text
Run rm notes.txt
```

The agent should deny it without prompting.

## Summary

In this chapter you:

- Added persistent permission rules
- Implemented wildcard matching
- Converted approval from a pure UI prompt into a policy decision

---

**Next: [Chapter 14: Advanced Shell Tool →](./14-advanced-shell-tool.md)**
