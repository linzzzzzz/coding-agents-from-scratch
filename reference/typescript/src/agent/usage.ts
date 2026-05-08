export interface UsageLimits {
  maxTokensPerConversation: number;
  maxToolCallsPerTurn: number;
  maxLoopIterationsPerTurn: number;
  maxCostPerConversation: number; // in dollars
}

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
  maxTokensPerConversation: 500_000,
  maxToolCallsPerTurn: 10,
  maxLoopIterationsPerTurn: 50,
  maxCostPerConversation: 5.00,
};

export class UsageTracker {
  private totalTokens = 0;
  private totalCost = 0;
  private toolCallsThisTurn = 0;
  private loopIterationsThisTurn = 0;

  constructor(private limits: UsageLimits) {}

  startTurn(): void {
    this.toolCallsThisTurn = 0;
    this.loopIterationsThisTurn = 0;
  }

  addTokens(count: number, isOutput: boolean): void {
    this.totalTokens += count;
    // Approximate cost (adjust rates per model)
    const rate = isOutput ? 0.000015 : 0.000005; // per token
    this.totalCost += count * rate;
  }

  addToolCall(): void {
    this.toolCallsThisTurn++;
  }

  addIteration(): void {
    this.loopIterationsThisTurn++;
  }

  check(): { ok: boolean; reason?: string } {
    if (this.totalTokens > this.limits.maxTokensPerConversation) {
      return { ok: false, reason: `Token limit exceeded (${this.totalTokens})` };
    }
    if (this.toolCallsThisTurn > this.limits.maxToolCallsPerTurn) {
      return { ok: false, reason: `Tool call limit exceeded (${this.toolCallsThisTurn})` };
    }
    if (this.loopIterationsThisTurn > this.limits.maxLoopIterationsPerTurn) {
      return { ok: false, reason: `Loop iteration limit exceeded (${this.loopIterationsThisTurn})` };
    }
    if (this.totalCost > this.limits.maxCostPerConversation) {
      return { ok: false, reason: `Cost limit exceeded ($${this.totalCost.toFixed(2)})` };
    }
    return { ok: true };
  }
}