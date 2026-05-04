# Chapter 17: Context Engine

## Beyond Simple Compaction

Context management is not just "summarize when too long." Production agents decide what belongs in the prompt:

- Recent conversation
- Relevant files
- Tool results
- Memory
- Project instructions
- Summaries of older work

This chapter introduces a context assembly step.

## Context Item Type

**Edit `src/agent/contextEngine/types.ts`:**

```typescript
export interface ContextItem {
  id: string;
  kind: "message" | "file" | "memory" | "summary" | "tool-result";
  content: string;
  estimatedTokens: number;
  priority: number;
}
```

Higher `priority` means the item is more important.

## Budget Allocation

**Edit `src/agent/contextEngine/budget.ts`:**

```typescript
import type { ContextItem } from "./types.ts";

export function selectContextItems(
  items: ContextItem[],
  budget: number,
): ContextItem[] {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const selected: ContextItem[] = [];
  let used = 0;

  for (const item of sorted) {
    if (used + item.estimatedTokens > budget) continue;
    selected.push(item);
    used += item.estimatedTokens;
  }

  return selected;
}
```

This is simple, but it makes the decision explicit.

## File Relevance

A minimal relevance score:

```typescript
export function scoreFileRelevance(filePath: string, userMessage: string): number {
  const lowerPath = filePath.toLowerCase();
  const words = userMessage.toLowerCase().split(/\W+/);

  return words.filter((word) => word && lowerPath.includes(word)).length;
}
```

Later, replace this with embeddings, ripgrep hits, or language-server references.

## Tool Result Truncation

Large tool results should not flood context:

```typescript
export function truncateToolResult(result: string, maxChars = 12_000): string {
  if (result.length <= maxChars) return result;

  return `${result.slice(0, maxChars)}

[Tool result truncated: ${result.length - maxChars} characters omitted]`;
}
```

## Manual Test

Create several fake context items with different priorities and token sizes. Confirm:

- High-priority memory survives
- Recent user message survives
- Large low-priority tool output is dropped or truncated

## Summary

In this chapter you:

- Created explicit context items
- Added a budget allocator
- Introduced file relevance scoring
- Added tool-result truncation

---

**Next: [Chapter 18: Production Terminal UI →](./18-production-terminal-ui.md)**
