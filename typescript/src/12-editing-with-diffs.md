# Chapter 12: Editing with Diffs

## Why `writeFile` Is Not Enough

`writeFile` is simple, but production coding agents rarely overwrite files blindly. They usually show a diff first, then apply a targeted change.

In this chapter, we'll add a safer edit workflow:

- Read the original file
- Generate a proposed replacement
- Show a diff
- Ask for approval
- Apply only after approval

## The Edit Proposal Type

**Edit `src/agent/edit/types.ts`:**

```typescript
export interface EditProposal {
  path: string;
  original: string;
  updated: string;
  diff: string;
}
```

## Generate a Diff

Install a small diff library:

```bash
npm install diff
npm install -D @types/diff
```

Create a helper:

**Edit `src/agent/edit/diff.ts`:**

```typescript
import { createPatch } from "diff";

export function createFileDiff(filePath: string, original: string, updated: string): string {
  return createPatch(filePath, original, updated, "before", "after");
}
```

## Propose an Edit

**Edit `src/agent/edit/propose.ts`:**

```typescript
import fs from "fs/promises";
import { createFileDiff } from "./diff.ts";
import type { EditProposal } from "./types.ts";

export async function proposeEdit(
  filePath: string,
  updated: string,
): Promise<EditProposal> {
  const original = await fs.readFile(filePath, "utf-8");

  return {
    path: filePath,
    original,
    updated,
    diff: createFileDiff(filePath, original, updated),
  };
}
```

## Apply an Approved Edit

**Edit `src/agent/edit/apply.ts`:**

```typescript
import fs from "fs/promises";
import type { EditProposal } from "./types.ts";

export async function applyEdit(proposal: EditProposal): Promise<string> {
  const current = await fs.readFile(proposal.path, "utf-8");

  if (current !== proposal.original) {
    return `Edit rejected: ${proposal.path} changed since the proposal was created.`;
  }

  await fs.writeFile(proposal.path, proposal.updated, "utf-8");
  return `Applied edit to ${proposal.path}`;
}
```

The `current !== proposal.original` check prevents stale edits from silently overwriting user changes.

## A Safer Edit Tool

You can now replace direct write behavior with a tool that returns a proposal:

**Edit `src/agent/tools/edit.ts`:**

```typescript
import { tool } from "ai";
import { z } from "zod";
import { proposeEdit } from "../edit/propose.ts";

export const proposeFileEdit = tool({
  description:
    "Propose a full-file edit and return a unified diff. The edit is not applied until the user approves it.",
  inputSchema: z.object({
    path: z.string().describe("The file to edit"),
    updated: z.string().describe("The full updated file contents"),
  }),
  execute: async ({ path, updated }: { path: string; updated: string }) => {
    const proposal = await proposeEdit(path, updated);
    return proposal.diff;
  },
});
```

## Manual Test

Create a small file:

```bash
echo 'export const name = "agent";' > scratch.ts
```

Ask the agent:

```text
Change scratch.ts so name is "coding-agent". Show me the diff before applying it.
```

You should see a unified diff rather than an immediate overwrite.

## Summary

In this chapter you:

- Moved from blind writes to proposed edits
- Generated unified diffs
- Added stale-edit protection
- Created the foundation for a real approval-first editing workflow

---

**Next: [Chapter 13: Permission Rules →](./13-permission-rules.md)**
