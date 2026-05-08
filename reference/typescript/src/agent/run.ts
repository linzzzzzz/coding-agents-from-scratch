import { streamText, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getTracer } from "@lmnr-ai/lmnr";
import { tools as baseTools } from "./tools/index.ts";
import { executeToolFromSet } from "./executeTool.ts";
import { Laminar } from "@lmnr-ai/lmnr";
import type { AgentCallbacks, ToolCallInfo } from "../types.ts";
import {
	estimateMessagesTokens,
	getModelLimits,
	isOverThreshold,
	calculateUsagePercentage,
	compactConversation,
	DEFAULT_THRESHOLD,
} from "./context/index.ts";
import { filterCompatibleMessages } from "./system/filterMessages.ts";
import { withRetry } from "./retry.ts";
import { loadMemories } from "./memory.ts";
import { UsageTracker } from "./usage.ts";
import { randomUUID } from "node:crypto";
import { AgentLogger } from "./logger.ts";
import { truncateResult } from "./toolResults.ts";
import type { PlanState } from "./mode.ts";
import { buildSystemPrompt } from "./system/prompt.ts";
import { tool } from "ai";
import { z } from "zod";
import { SUBAGENTS } from "./subagents/registry.ts";
import type { SubagentDefinition } from "./subagents/types.ts";

// Initialize Laminar for observability (optional - traces LLM calls)
Laminar.initialize({
	projectApiKey: process.env.LMNR_API_KEY,
});

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
	throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
	apiKey,
	baseURL: process.env.LLM_BASE_URL,
});

const MODEL_NAME = process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23";

function wrapToolResult(toolName: string, result: string): string {
	// Use unique delimiters the LLM is trained to respect
	return `<tool_result name="${toolName}">\n${result}\n</tool_result>`;
}

function withoutSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((message) => message.role !== "system");
}

function withoutToolExecutors<T extends Record<string, { execute?: unknown }>>(
  toolSet: T,
): T {
  return Object.fromEntries(
    Object.entries(toolSet).map(([name, toolDef]) => [
      name,
      { ...toolDef, execute: undefined },
    ]),
  ) as T;
}

// After the LLM generates tool calls, check if they make sense
function validateToolCall(
	toolName: string,
	args: Record<string, unknown>,
	previousToolResults: string[],
): { valid: boolean; reason?: string } {
	// Check if a delete/write was requested right after reading a file
	// that contained instruction-like content
	if (toolName === "deleteFile" || toolName === "runCommand") {
		for (const result of previousToolResults) {
			if (result.includes("delete") || result.includes("ignore all")) {
				return {
					valid: false,
					reason:
						"Suspicious: destructive action following potentially injected content",
				};
			}
		}
	}
	return { valid: true };
}

const CONCURRENCY_SAFE_TOOLS = new Set(["readFile", "listFiles", "webSearch"]);

function isConcurrencySafe(tc: ToolCallInfo): boolean {
	return CONCURRENCY_SAFE_TOOLS.has(tc.toolName);
}

const PLAN_MODE_BLOCKED_TOOLS = new Set([
		"writeFile",
		"deleteFile",
		"runCommand",
		"executeCode",
]);
	
function isBlockedInPlanMode(toolName: string): boolean {
	return PLAN_MODE_BLOCKED_TOOLS.has(toolName);
}

type AgentToolSet = Partial<typeof baseTools>;
export interface RunAgentConfig {
  agentName?: string;
  systemPromptOverride?: string;
  toolsOverride?: AgentToolSet;
  includeMemories?: boolean;
  startNewTurn?: boolean;
}


type ToolBatch = {
	isConcurrencySafe: boolean;
	toolCalls: ToolCallInfo[];
};

function partitionToolCalls(toolCalls: ToolCallInfo[]): ToolBatch[] {
	const batches: ToolBatch[] = [];

	for (const tc of toolCalls) {
		const safe = isConcurrencySafe(tc);
		const last = batches[batches.length - 1];

		if (safe && last?.isConcurrencySafe) {
			last.toolCalls.push(tc);
		} else {
			batches.push({ isConcurrencySafe: safe, toolCalls: [tc] });
		}
	}

	return batches;
}

function pickTools(subagent: SubagentDefinition) {
  return Object.fromEntries(
    subagent.allowedTools.map((name) => [name, baseTools[name]]),
  );
}

async function runSubagent(
  subagent: SubagentDefinition,
  task: string,
  history: ModelMessage[],
  parentCallbacks: AgentCallbacks,
  usageTracker: UsageTracker,
  signal?: AbortSignal,
): Promise<string> {
  let finalResponse = "";
  const context = subagent.buildContext
    ? subagent.buildContext({ task, history })
    : history.slice(-6);

  const callbacks: AgentCallbacks = {
    onToken: () => {},
    onComplete: (response) => {
      finalResponse = response;
    },
    onToolCallStart: (name, args) => {
      parentCallbacks.onToolCallStart(`${subagent.name}.${name}`, args);
    },
    onToolCallEnd: (name, result) => {
      parentCallbacks.onToolCallEnd(`${subagent.name}.${name}`, result);
    },
    onToolApproval: (name, args) =>
      parentCallbacks.onToolApproval(`${subagent.name}.${name}`, args),
  };

  await runAgent(
    task,
    context,
    callbacks,
    usageTracker,
    { mode: "build" },
    signal,
    {
      agentName: subagent.name,
      systemPromptOverride: subagent.systemPrompt,
      toolsOverride: pickTools(subagent),
      includeMemories: false,
	  startNewTurn: false,
    },
  );

  return finalResponse;
}


export async function runAgent(
	userMessage: string,
	conversationHistory: ModelMessage[],
	callbacks: AgentCallbacks,
	usageTracker: UsageTracker,
	planState: PlanState,
	signal?: AbortSignal,
	runConfig: RunAgentConfig = {},
): Promise<ModelMessage[]> {
	const modelLimits = getModelLimits(MODEL_NAME);
	const memories = runConfig.includeMemories === false ? [] : await loadMemories();
	const memoryText = memories.map((memory) => `- ${memory.content}`).join("\n");
	const baseSystemPrompt = runConfig.systemPromptOverride ?? buildSystemPrompt(planState);
	const systemPrompt = memoryText
		? `${baseSystemPrompt}

Known user memories:
${memoryText}`
		: baseSystemPrompt;

	const logger = new AgentLogger(runConfig.agentName ?? "default", randomUUID());
	logger.log("agent_run_started", {
		model: MODEL_NAME,
		historyLength: conversationHistory.length,
		userMessageLength: userMessage.length,
	});


	// Filter and check if we need to compact
	let workingHistory = withoutSystemMessages(
		filterCompatibleMessages(conversationHistory),
	);

	const executionTools = runConfig.toolsOverride ?? {
		...baseTools,
		delegateToSubagent: tool({
			description:
			"Delegate a bounded task to a specialized subagent. Use this for focused review, exploration, or second opinions.",
			inputSchema: z.object({
			subagent: z.enum(["reviewer", "explorer"]),
			task: z.string().describe("The complete task for the subagent."),
			}),
			async execute({ subagent, task }) {
				return runSubagent(
					SUBAGENTS[subagent],
					task,
					workingHistory,
					callbacks,
					usageTracker,
					signal,
				);
			},
		}),
	};
	const modelTools = withoutToolExecutors(executionTools);


	if (runConfig.startNewTurn !== false) {
		usageTracker.startTurn();
	}

	const initialLimitCheck = usageTracker.check();
	if (!initialLimitCheck.ok) {
		const stopMessage = `\n[Agent stopped: ${initialLimitCheck.reason}]`;
		callbacks.onToken(stopMessage);
		callbacks.onComplete(stopMessage);
		return withoutSystemMessages([
			...workingHistory,
			{ role: "user", content: userMessage },
			{ role: "assistant", content: stopMessage.trim() },
		]);
	}

	const preCheckTokens = estimateMessagesTokens([
		{ role: "system", content: systemPrompt },
		...workingHistory,
		{ role: "user", content: userMessage },
	]);

	if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
		callbacks.onContextCompactStart?.({
			estimatedTokens: preCheckTokens.total,
			contextWindow: modelLimits.contextWindow,
			threshold: DEFAULT_THRESHOLD,
		});
		workingHistory = await compactConversation(workingHistory, MODEL_NAME);
		callbacks.onContextCompactEnd?.({
			messageCount: workingHistory.length,
		});
	}

	const messages: ModelMessage[] = [
		{ role: "system", content: systemPrompt },
		...workingHistory,
		{ role: "user", content: userMessage },
	];

	// Report token usage throughout the loop
	const reportTokenUsage = () => {
		if (callbacks.onTokenUsage) {
			const usage = estimateMessagesTokens(messages);
			callbacks.onTokenUsage({
				inputTokens: usage.input,
				outputTokens: usage.output,
				totalTokens: usage.total,
				contextWindow: modelLimits.contextWindow,
				threshold: DEFAULT_THRESHOLD,
				percentage: calculateUsagePercentage(
					usage.total,
					modelLimits.contextWindow,
				),
			});
		}
	};

	reportTokenUsage();

	let fullResponse = "";
	const previousToolResults: string[] = [];

	async function executeApprovedToolCall(
		tc: ToolCallInfo,
	): Promise<ModelMessage> {
		usageTracker.addToolCall();
		const toolLimitCheck = usageTracker.check();

		if (!toolLimitCheck.ok) {
			throw new Error(toolLimitCheck.reason);
		}

		const toolStart = Date.now();
		logger.logToolExecutionStarted(tc.toolName, tc.args);
		const rawToolResult = await executeToolFromSet(executionTools, tc.toolName, tc.args);
		const toolResult = truncateResult(rawToolResult);
		const durationMs = Date.now() - toolStart;

		logger.logToolResult(tc.toolName, toolResult, durationMs);
		previousToolResults.push(toolResult);
		callbacks.onToolCallEnd(tc.toolName, toolResult);

		const wrappedToolResult = wrapToolResult(tc.toolName, toolResult);

		return {
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					output: { type: "text", value: wrappedToolResult },
				},
			],
		};
	}

	while (true) {
		// Check for cancellation at the top of each loop
		if (signal?.aborted) {
			callbacks.onToken("\n[Cancelled by user]");
			break;
		}

		usageTracker.addIteration();
		const limitCheck = usageTracker.check();
		if (!limitCheck.ok) {
			const stopMessage = `\n[Agent stopped: ${limitCheck.reason}]`;
			callbacks.onToken(stopMessage);
			fullResponse += stopMessage;
			break;
		}

		logger.log("llm_call_started", {
			model: MODEL_NAME,
			messageCount: messages.length,
		});

		const result = await withRetry(async () =>
			streamText({
				model: provider.chat(MODEL_NAME),
				messages,
				tools: modelTools,
				allowSystemInMessages: true,
				experimental_telemetry: {
					isEnabled: true,
					tracer: getTracer(),
				},
				abortSignal: signal, // Pass to AI SDK
			}),
		);

		const toolCalls: ToolCallInfo[] = [];
		let currentText = "";

		try {
			for await (const chunk of result.fullStream) {
				if (chunk.type === "text-delta") {
					currentText += chunk.text;
					callbacks.onToken(chunk.text);
				}
				if (chunk.type === "tool-call") {
					const input = "input" in chunk ? chunk.input : {};
					toolCalls.push({
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						args: input as Record<string, unknown>,
					});

					logger.logToolCall(chunk.toolName, input);
					callbacks.onToolCallStart(chunk.toolName, input);
				}
			}
		} catch (error) {
			const streamError = error as Error;
			logger.logError(error as Error, "runAgent");
			if (
				!currentText &&
				!streamError.message.includes("No output generated")
			) {
				throw streamError;
			}
		}

		fullResponse += currentText;

		const finishReason = await result.finishReason;

		const usage = await result.usage;
		usageTracker.addTokens(usage.inputTokens ?? 0, false);
		usageTracker.addTokens(usage.outputTokens ?? 0, true);

		logger.log("llm_call_completed", {
			finishReason,
			inputTokens: usage.inputTokens ?? 0,
			outputTokens: usage.outputTokens ?? 0,
			toolCallCount: toolCalls.length,
		});

		// If the LLM didn't request any tool calls, we're done
		if (finishReason !== "tool-calls" || toolCalls.length === 0) {
			const responseMessages = await result.response;
			messages.push(...responseMessages.messages);
			break;
		}

		// Add the assistant's response (with tool call requests) to history
		const responseMessages = await result.response;
		messages.push(...responseMessages.messages);

		// Process tool calls in order, parallelizing only concurrency-safe batches.
		let rejected = false;

		for (const batch of partitionToolCalls(toolCalls)) {
			const approvedToolCalls: ToolCallInfo[] = [];

			// Keep validation and approval sequential so the user sees one clear decision
			// at a time, even when execution can run in parallel later.
			for (const tc of batch.toolCalls) {
				const validation = validateToolCall(
					tc.toolName,
					tc.args,
					previousToolResults,
				);

				if (!validation.valid) {
					const stopMessage = `\n[Tool blocked: ${validation.reason}]`;
					callbacks.onToken(stopMessage);
					fullResponse += stopMessage;
					rejected = true;
					break;
				}

				if (planState.mode === "plan" && isBlockedInPlanMode(tc.toolName)) {
					const stopMessage = `\n[Tool blocked in plan mode: ${tc.toolName}]`;
					callbacks.onToken(stopMessage);
					fullResponse += stopMessage;
					rejected = true;
					break;
				}

				const approved = await callbacks.onToolApproval(tc.toolName, tc.args);
				logger.log("approval", { toolName: tc.toolName, approved });

				if (!approved) {
					rejected = true;
					break;
				}

				approvedToolCalls.push(tc);
			}

			if (rejected) break;

			try {
				if (batch.isConcurrencySafe) {
					const toolMessages = await Promise.all(
						approvedToolCalls.map(executeApprovedToolCall),
					);
					messages.push(...toolMessages);
					reportTokenUsage();
				} else {
					for (const tc of approvedToolCalls) {
						const toolMessage = await executeApprovedToolCall(tc);
						messages.push(toolMessage);
						reportTokenUsage();
					}
				}
			} catch (error) {
				const err = error as Error;
				const stopMessage = `\n[Agent stopped: ${err.message}]`;
				callbacks.onToken(stopMessage);
				fullResponse += stopMessage;
				rejected = true;
				break;
			}
		}

		if (rejected) {
			break;
		}
	}

	callbacks.onComplete(fullResponse);

	logger.log("agent_run_completed", {
		responseLength: fullResponse.length,
		messageCount: messages.length,
	});

	return withoutSystemMessages(messages);
}
