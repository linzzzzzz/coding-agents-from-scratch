import fs from "fs/promises";
import path from "path";
import type { ModelMessage } from "ai";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const MEMORY_DIR = path.join(process.cwd(), ".agent", "conversations");
const memoryProvider = createOpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const MEMORY_MODEL = process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23";
const MEMORY_EXTRACT_EVERY_N_TURNS = Number(
  process.env.MEMORY_EXTRACT_EVERY_N_TURNS ?? 3,
);

let turnsSinceMemoryExtraction = 0;

export interface MemoryEntry {
  content: string;
  category: "preference" | "fact" | "instruction";
  createdAt: string;
}

const SEMANTIC_MEMORY_FILE = path.join(process.cwd(), ".agent", "memories.json");

export async function saveConversation(
  id: string,
  messages: ModelMessage[],
): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(MEMORY_DIR, `${id}.json`),
    JSON.stringify(messages, null, 2),
  );
}

export async function loadConversation(id: string): Promise<ModelMessage[] | null> {
  try {
    const data = await fs.readFile(path.join(MEMORY_DIR, `${id}.json`), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function loadMemories(): Promise<MemoryEntry[]> {
  try {
    const data = await fs.readFile(SEMANTIC_MEMORY_FILE, "utf-8");
    return JSON.parse(data) as MemoryEntry[];
  } catch {
    return [];
  }
}

export async function saveMemories(memories: MemoryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(SEMANTIC_MEMORY_FILE), { recursive: true });
  await fs.writeFile(SEMANTIC_MEMORY_FILE, JSON.stringify(memories, null, 2));
}

function dedupeMemories(memories: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = `${memory.category}:${memory.content.toLowerCase().trim()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function extractMemories(
  conversationText: string,
): Promise<MemoryEntry[]> {
  const { object } = await generateObject({
    model: memoryProvider.chat(MEMORY_MODEL),
    schema: z.object({
      entries: z.array(
        z.union([
          z.string(),
          z.object({
            content: z.string(),
            category: z.enum(["preference", "fact", "instruction"]),
          }),
        ]),
      ),
    }),
    prompt: `Extract durable user memories from this conversation.
Return JSON that matches the schema exactly.
The top-level JSON object must use the key "entries" exactly.
Each entry must be either a string or an object with content and category.
Do not use "memories" or any other top-level key.

Example JSON:
{
  "entries": [
    { "content": "The user prefers TypeScript examples.", "category": "preference" }
  ]
}

Conversation:
${conversationText}`,
  });

  return object.entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        content: entry,
        category: "fact" as const,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      ...entry,
      createdAt: new Date().toISOString(),
    };
  });
}

export async function updateMemoriesIfNeeded(
  conversationText: string,
): Promise<void> {
  turnsSinceMemoryExtraction++;

  if (turnsSinceMemoryExtraction < MEMORY_EXTRACT_EVERY_N_TURNS) {
    return;
  }

  turnsSinceMemoryExtraction = 0;

  const existingMemories = await loadMemories();
  const newMemories = await extractMemories(conversationText);
  await saveMemories(dedupeMemories([...existingMemories, ...newMemories]));
}
