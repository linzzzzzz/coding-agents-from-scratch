import { tools as baseTools } from "./tools/index.ts";

export type ToolSet = Partial<typeof baseTools>;
export type ToolName = keyof typeof baseTools;

export async function executeToolFromSet(
  tools: ToolSet,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const selectedTool = tools[name as keyof typeof tools];

  if (!selectedTool) {
    return `Unknown tool: ${name}`;
  }

  const execute = selectedTool.execute;
  if (!execute) {
    return `Provider tool ${name} - executed by model provider`;
  }

  const result = await execute(args as never, {
    toolCallId: "",
    messages: [],
  });

  return String(result);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return executeToolFromSet(baseTools, name, args);
}