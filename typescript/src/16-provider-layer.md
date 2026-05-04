# Chapter 16: Provider Layer

## Why a Provider Layer Matters

The course started with one OpenAI-compatible provider. Production agents often need several model roles:

- Main coding model
- Cheap summarizer
- Fast title generator
- Strict judge model
- Memory extractor
- Fallback model

This chapter adds model profiles.

## Model Profile Type

**Edit `src/agent/provider/types.ts`:**

```typescript
export interface ModelProfile {
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface ProviderConfig {
  main: ModelProfile;
  summarizer?: ModelProfile;
  judge?: ModelProfile;
  memory?: ModelProfile;
}
```

## Load From Environment

**Edit `src/agent/provider/config.ts`:**

```typescript
import type { ProviderConfig } from "./types.ts";

export function loadProviderConfig(): ProviderConfig {
  if (!process.env.LLM_API_KEY) {
    throw new Error("Missing LLM_API_KEY");
  }

  return {
    main: {
      name: "main",
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL ?? "qwen-plus",
    },
    summarizer: process.env.SUMMARIZER_MODEL
      ? {
          name: "summarizer",
          apiKey: process.env.LLM_API_KEY,
          baseURL: process.env.LLM_BASE_URL,
          model: process.env.SUMMARIZER_MODEL,
        }
      : undefined,
  };
}
```

## Create Models

**Edit `src/agent/provider/index.ts`:**

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelProfile } from "./types.ts";

export function createModel(profile: ModelProfile) {
  const provider = createOpenAI({
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
  });

  return provider.chat(profile.model);
}
```

## Use Named Models

In `run.ts`:

```typescript
const providerConfig = loadProviderConfig();
const mainModel = createModel(providerConfig.main);
```

Then:

```typescript
streamText({
  model: mainModel,
  messages,
  tools,
});
```

For compaction:

```typescript
const summarizerModel = createModel(
  providerConfig.summarizer ?? providerConfig.main,
);
```

## Fallback Models

A simple fallback pattern:

```typescript
try {
  return await callModel(primary);
} catch (error) {
  return await callModel(fallback);
}
```

Use fallback carefully. It can hide provider outages and make debugging harder. Log when fallback happens.

## Summary

In this chapter you:

- Created model profiles
- Loaded provider configuration from env vars
- Separated main, summarizer, judge, and memory roles
- Prepared the agent for fallback models

---

**Next: [Chapter 17: Context Engine →](./17-context-engine.md)**
