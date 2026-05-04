# Chapter 15: MCP and Plugins

## Why Plugins Matter

Hardcoding every tool into `src/agent/tools/index.ts` does not scale. Production agents need tools from:

- Local project plugins
- MCP servers
- Internal company APIs
- User-installed integrations

This chapter adds a simple plugin shape and prepares the agent for MCP-style tools.

## Plugin Manifest

Create a plugin manifest type:

**Edit `src/agent/plugins/types.ts`:**

```typescript
export interface PluginManifest {
  name: string;
  description: string;
  entry: string;
  enabled: boolean;
}
```

Example plugin config:

**Edit `.agent/plugins.json`:**

```json
[
  {
    "name": "local-tools",
    "description": "Project-specific tools",
    "entry": "./plugins/local-tools.ts",
    "enabled": true
  }
]
```

## Loading Plugin Config

**Edit `src/agent/plugins/config.ts`:**

```typescript
import fs from "fs/promises";
import path from "path";
import type { PluginManifest } from "./types.ts";

const PLUGINS_PATH = path.join(process.cwd(), ".agent", "plugins.json");

export async function loadPluginManifests(): Promise<PluginManifest[]> {
  try {
    const raw = await fs.readFile(PLUGINS_PATH, "utf-8");
    return JSON.parse(raw) as PluginManifest[];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }
}
```

## Plugin Tool Shape

For now, a plugin exports a tool map:

```typescript
import type { ToolSet } from "ai";

export const tools: ToolSet = {
  // plugin tools here
};
```

Later, MCP servers can be adapted into the same shape.

## Loading Tools Dynamically

**Edit `src/agent/plugins/load.ts`:**

```typescript
import type { ToolSet } from "ai";
import { pathToFileURL } from "url";
import path from "path";
import { loadPluginManifests } from "./config.ts";

export async function loadPluginTools(): Promise<ToolSet> {
  const manifests = await loadPluginManifests();
  const result: ToolSet = {};

  for (const manifest of manifests) {
    if (!manifest.enabled) continue;

    const fullPath = path.resolve(process.cwd(), manifest.entry);
    const mod = (await import(pathToFileURL(fullPath).href)) as { tools?: ToolSet };

    Object.assign(result, mod.tools ?? {});
  }

  return result;
}
```

## Wiring Into the Agent

Before calling `streamText`:

```typescript
const pluginTools = await loadPluginTools();
const allTools = {
  ...tools,
  ...pluginTools,
};
```

Then pass:

```typescript
tools: allTools
```

## MCP Later

MCP is a standard way for external processes to expose tools. In a production agent, the plugin loader would:

- Start configured MCP servers
- List their tools
- Convert MCP schemas into AI SDK tool schemas
- Route tool calls back to the MCP server

The key design is the same: normalize every external tool into your internal `ToolSet`.

## Summary

In this chapter you:

- Added plugin manifests
- Loaded plugin tools dynamically
- Prepared the tool registry for MCP-style extensibility

---

**Next: [Chapter 16: Provider Layer →](./16-provider-layer.md)**
