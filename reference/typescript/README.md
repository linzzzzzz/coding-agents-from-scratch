# TypeScript Reference Implementation

This is the finished TypeScript implementation for [Building Production AI Coding Agents from Scratch](../../README.md).

Use it to compare against your own code, debug a chapter, or run the completed CLI coding agent locally.

## What It Includes

- OpenAI-compatible provider configuration
- Streaming agent loop
- Structured tool calling
- File system tools
- Web search
- Shell command and code execution tools
- Human-in-the-loop tool approval
- Context compaction
- Memory
- Usage limits and structured logging
- Planning mode
- Production-style subagents
- Evals and real tool tests

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```bash
LLM_API_KEY=your-api-key
LLM_MODEL=your-model
LLM_BASE_URL=your-provider-base-url
```

If you use OpenAI directly, `LLM_BASE_URL=https://api.openai.com/v1` works.

## Run

```bash
npm run start
```

## Test

```bash
npm test
```

## Evals

```bash
npm run eval:file-tools
npm run eval:shell-tools
npm run eval:agent
```

Laminar evals require `LMNR_API_KEY`.

## Runtime Files

The app may create `.agent/` while running. That directory stores local conversations, memories, and logs, and is intentionally ignored by git.
