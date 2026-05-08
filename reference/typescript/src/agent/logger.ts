import { appendFileSync, mkdirSync } from "node:fs";

type LogEvent =
	| "agent_run_started"
	| "agent_run_completed"
	| "llm_call_started"
	| "llm_call_completed"
	| "tool_call"
	| "tool_execution_started"
	| "tool_result"
	| "approval"
	| "error";

interface LogEntry {
	timestamp: string;
	conversationId: string;
	runId: string;
	event: LogEvent;
	data: Record<string, unknown>;
}

export class AgentLogger {
	private entries: LogEntry[] = [];
	private logPath = ".agent/logs/agent.jsonl";

	constructor(
		private conversationId: string,
		private runId: string,
	) {
		mkdirSync(".agent/logs", { recursive: true });
	}

	log(event: LogEvent, data: Record<string, unknown> = {}): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			conversationId: this.conversationId,
			runId: this.runId,
			event,
			data,
		};

		this.entries.push(entry);

		appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
	}

	logToolCall(name: string, args: unknown): void {
		this.log("tool_call", { toolName: name, args });
	}

	logToolExecutionStarted(name: string, args: unknown): void {
		this.log("tool_execution_started", { toolName: name, args });
	}

	logToolResult(name: string, result: string, durationMs: number): void {
		this.log("tool_result", {
			toolName: name,
			resultLength: result.length,
			durationMs,
		});
	}

	logError(error: Error, context: string): void {
		this.log("error", {
			message: error.message,
			stack: error.stack,
			context,
		});
	}
}
