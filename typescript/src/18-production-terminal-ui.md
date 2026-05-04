# Chapter 18: Production Terminal UI

## From Demo UI to Workbench

The current Ink UI lets you chat and approve tools. Production coding agents need a workbench:

- Session list
- Approval queue
- Tool timeline
- Diff viewer
- Background task panel
- Status bar

This chapter sketches the UI architecture without rebuilding the whole app.

## App State Shape

**Edit `src/ui/state.ts`:**

```typescript
export type ViewMode = "chat" | "sessions" | "diff" | "tasks";

export interface UIState {
  view: ViewMode;
  selectedSessionId?: string;
  pendingApprovals: number;
  runningTasks: number;
}
```

## Layout

Keep one top-level layout:

```typescript
<Box flexDirection="column">
  <StatusBar />
  <MainView />
  <Footer />
</Box>
```

`MainView` switches on `view`.

## Command Palette

Add slash commands:

```text
/sessions
/diff
/tasks
/clear
/resume <session-id>
```

Parse before sending text to the model:

```typescript
if (input.startsWith("/")) {
  handleCommand(input);
  return;
}
```

## Approval Queue

Instead of rendering only the current approval, store pending approvals:

```typescript
interface ApprovalItem {
  id: string;
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
}
```

This makes parallel tool calls easier to review.

## Diff Viewer

For diffs, start simple:

- Green lines for `+`
- Red lines for `-`
- Dim lines for context

Do not try to build a full editor yet. Show the diff clearly and let the user approve or reject.

## Summary

In this chapter you:

- Split UI state from agent state
- Added view modes
- Introduced slash commands
- Designed approval queue and diff viewer foundations

---

**Next: [Chapter 19: Subagents →](./19-subagents.md)**
