import type { ModelMessage } from "ai";
import type { ToolName } from "../executeTool.ts";

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: ToolName[];
  buildContext?: (input: {
    task: string;
    history: ModelMessage[];
  }) => ModelMessage[];
}