# Chapter 11: Session System

## Why Sessions Matter

So far, the agent keeps conversation history in memory while the app is running. That works for a demo, but production coding agents need durable sessions:

- Resume a previous conversation
- Inspect what tools ran
- Export transcripts for debugging
- Compact old history without losing the audit trail
- Keep separate projects and tasks from blending together

In this chapter, we'll turn "conversation history" into a real session record.

## The Session Shape

Create a session model:

**Edit `src/agent/session/types.ts`:**

```typescript
import type { ModelMessage } from "ai";

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  messages: ModelMessage[];
}
```

This is intentionally small. Store raw messages first. You can add tool timelines, summaries, and cost later.

## Session Storage

Create the storage helper:

**Edit `src/agent/session/store.ts`:**

```typescript
import fs from "fs/promises";
import path from "path";
import type { SessionRecord } from "./types.ts";

const SESSION_DIR = path.join(process.cwd(), ".agent", "sessions");

export async function saveSession(session: SessionRecord): Promise<void> {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SESSION_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2),
  );
}

export async function loadSession(id: string): Promise<SessionRecord | null> {
  try {
    const raw = await fs.readFile(path.join(SESSION_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as SessionRecord;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

export async function listSessions(): Promise<SessionRecord[]> {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  const files = await fs.readdir(SESSION_DIR);
  const sessions = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => loadSession(path.basename(file, ".json"))),
  );

  return sessions
    .filter((session): session is SessionRecord => session !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
```

## Creating a Session

Create a helper for new sessions:

**Edit `src/agent/session/create.ts`:**

```typescript
import type { ModelMessage } from "ai";
import type { SessionRecord } from "./types.ts";

export function createSession(messages: ModelMessage[] = []): SessionRecord {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: "Untitled session",
    createdAt: now,
    updatedAt: now,
    cwd: process.cwd(),
    messages,
  };
}
```

## Wiring It Into the UI

The app should load one session on startup and save after every turn.

**Edit `src/ui/App.tsx`:**

```typescript
const [session, setSession] = useState<SessionRecord | null>(null);

useEffect(() => {
  async function loadInitialSession() {
    const sessions = await listSessions();
    setSession(sessions[0] ?? createSession());
  }

  void loadInitialSession();
}, []);
```

After the agent returns new history:

```typescript
const updatedSession = {
  ...session,
  updatedAt: new Date().toISOString(),
  messages: newHistory,
};

setSession(updatedSession);
await saveSession(updatedSession);
```

## Manual Test

Run the app:

```bash
npm run start
```

Send one message, then exit. Confirm a session file exists:

```bash
ls .agent/sessions
```

Restart the app. The previous messages should be loaded.

## Summary

In this chapter you:

- Created a durable session model
- Saved and loaded sessions from `.agent/sessions`
- Added a session list helper
- Wired session persistence into the UI

This is the foundation for resume, transcript export, session search, and replay.

---

**Next: [Chapter 12: Editing with Diffs →](./12-editing-with-diffs.md)**
