export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCallStart: (name: string, args: unknown) => void;
  onToolCallEnd: (name: string, result: string) => void;
  onComplete: (response: string) => void;
  onToolApproval: (name: string, args: unknown) => Promise<boolean>;
  onTokenUsage?: (usage: TokenUsageInfo) => void;
  onContextCompactStart?: (info: ContextCompactStartInfo) => void;
  onContextCompactEnd?: (info: ContextCompactEndInfo) => void;
}

export interface ToolApprovalRequest {
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ModelLimits {
  inputLimit: number;
  outputLimit: number;
  contextWindow: number;
}

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  threshold: number;
  percentage: number;
}

export interface ContextCompactStartInfo {
  estimatedTokens: number;
  contextWindow: number;
  threshold: number;
}

export interface ContextCompactEndInfo {
  messageCount: number;
}
