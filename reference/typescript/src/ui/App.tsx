import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ModelMessage } from "ai";
import { runAgent } from "../agent/run.ts";
import { MessageList, type Message } from "./components/MessageList.tsx";
import { ToolCall, type ToolCallProps } from "./components/ToolCall.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { Input } from "./components/Input.tsx";
import { ToolApproval } from "./components/ToolApproval.tsx";
import { TokenUsage } from "./components/TokenUsage.tsx";
import type { ToolApprovalRequest, TokenUsageInfo } from "../types.ts";
import {
  loadConversation,
  saveConversation,
  updateMemoriesIfNeeded,
} from "../agent/memory.ts";
import { DEFAULT_USAGE_LIMITS, UsageTracker } from "../agent/usage.ts";
import type { PlanState } from "../agent/mode.ts";

interface ActiveToolCall extends ToolCallProps {
  id: string;
}

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    ModelMessage[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<ToolApprovalRequest | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);
  const usageTrackerRef = useRef(new UsageTracker(DEFAULT_USAGE_LIMITS));
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [planState, setPlanState] = useState<PlanState>({ mode: "build" });

  useEffect(() => {
    async function loadMemory() {
      const savedHistory = await loadConversation("default");

      if (savedHistory) {
        setConversationHistory(savedHistory);
      }
    }

    void loadMemory();
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (abortController) {
        abortController.abort();
      } else {
        exit();
      }
    }
  });

  const handleSubmit = useCallback(
    async (userInput: string) => {
      const command = userInput.trim().toLowerCase();
      if (command === "exit" || command === "quit") {
        exit();
        return;
      }

      if (planState.mode === "plan" && command === "approve") {
        const lastAssistantMessage = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");

        setPlanState({
          mode: "build",
          approvedPlan: lastAssistantMessage?.content,
        });
        return;
      }

      const planPrefix = "/plan ";
      const isPlanCommand = userInput.startsWith(planPrefix);

      const agentInput = isPlanCommand
        ? userInput.slice(planPrefix.length)
        : userInput;

      const runPlanState: PlanState = isPlanCommand
        ? { mode: "plan" }
        : planState;
      
      if (isPlanCommand) {
        setPlanState(runPlanState);
      }


      setMessages((prev) => [...prev, { role: "user", content: userInput }]);
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

      try {
        const controller = new AbortController();
        setAbortController(controller);

        const newHistory = await runAgent(agentInput, conversationHistory, {
          onToken: (token) => {
            setStreamingText((prev) => prev + token);
          },
          onToolCallStart: (name, args) => {
            setActiveToolCalls((prev) => [
              ...prev,
              {
                id: `${name}-${Date.now()}`,
                name,
                args,
                status: "pending",
              },
            ]);
          },
          onToolCallEnd: (name, result) => {
            setActiveToolCalls((prev) =>
              prev.map((tc) =>
                tc.name === name && tc.status === "pending"
                  ? { ...tc, status: "complete", result }
                  : tc,
              ),
            );
          },
          onComplete: (response) => {
            if (response) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: response },
              ]);
            }
            setStreamingText("");
            setActiveToolCalls([]);
          },
          onToolApproval: (name, args) => {
            return new Promise<boolean>((resolve) => {
              setPendingApproval({ toolName: name, args, resolve });
            });
          },
          onTokenUsage: (usage) => {
            setTokenUsage(usage);
          },
        },
        usageTrackerRef.current,
        runPlanState,
        controller.signal,
      );

        setConversationHistory(newHistory);
        await saveConversation("default", newHistory);

        const conversationText = newHistory
          .map((message) =>
            typeof message.content === "string"
              ? `${message.role}: ${message.content}`
              : "",
          )
          .join("\n");

        await updateMemoriesIfNeeded(conversationText);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${errorMessage}` },
        ]);
      } finally {
        setAbortController(null);
        setIsLoading(false);
      }
    },
    [conversationHistory, exit, messages, planState],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          🤖 AI Agent
        </Text>
        <Text dimColor> (type "exit" to quit)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <MessageList messages={messages} />

        {streamingText && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              › Assistant
            </Text>
            <Box marginLeft={2}>
              <Text>{streamingText}</Text>
              <Text color="gray">▌</Text>
            </Box>
          </Box>
        )}

        {activeToolCalls.length > 0 && !pendingApproval && (
          <Box flexDirection="column" marginTop={1}>
            {activeToolCalls.map((tc) => (
              <ToolCall
                key={tc.id}
                name={tc.name}
                args={tc.args}
                status={tc.status}
                result={tc.result}
              />
            ))}
          </Box>
        )}

        {isLoading && !streamingText && activeToolCalls.length === 0 && !pendingApproval && (
          <Box marginTop={1}>
            <Spinner />
          </Box>
        )}

        {pendingApproval && (
          <ToolApproval
            toolName={pendingApproval.toolName}
            args={pendingApproval.args}
            onResolve={(approved) => {
              pendingApproval.resolve(approved);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {!pendingApproval && (
        <Input onSubmit={handleSubmit} disabled={isLoading} />
      )}

      <TokenUsage usage={tokenUsage} />
    </Box>
  );
}
