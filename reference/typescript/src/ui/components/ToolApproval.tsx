import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ToolApprovalProps {
  toolName: string;
  args: unknown;
  onResolve: (approved: boolean) => void;
}

const MAX_PREVIEW_LINES = 5;

function formatArgs(args: unknown): { preview: string; extraLines: number } {
  const formatted = JSON.stringify(args, null, 2);
  const lines = formatted.split("\n");

  if (lines.length <= MAX_PREVIEW_LINES) {
    return { preview: formatted, extraLines: 0 };
  }

  const preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
  const extraLines = lines.length - MAX_PREVIEW_LINES;
  return { preview, extraLines };
}

function getArgsSummary(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return String(args);
  }

  const obj = args as Record<string, unknown>;
  const meaningfulKeys = ["path", "filePath", "command", "query", "code", "content"];
  for (const key of meaningfulKeys) {
    if (key in obj && typeof obj[key] === "string") {
      const value = obj[key] as string;
      if (value.length > 50) {
        return value.slice(0, 50) + "...";
      }
      return value;
    }
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && typeof obj[keys[0]] === "string") {
    const value = obj[keys[0]] as string;
    if (value.length > 50) {
      return value.slice(0, 50) + "...";
    }
    return value;
  }

  return "";
}

export function ToolApproval({ toolName, args, onResolve }: ToolApprovalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = ["Yes", "No"];

  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
        return;
      }

      if (key.return) {
        onResolve(selectedIndex === 0);
      }
    },
    { isActive: true }
  );

  const argsSummary = getArgsSummary(args);
  const { preview, extraLines } = formatArgs(args);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        Tool Approval Required
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text color="cyan" bold>{toolName}</Text>
          {argsSummary && (
            <Text dimColor>({argsSummary})</Text>
          )}
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>{preview}</Text>
          {extraLines > 0 && (
            <Text color="gray">... +{extraLines} more lines</Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="row" gap={2}>
        {options.map((option, index) => (
          <Text
            key={option}
            color={selectedIndex === index ? "green" : "gray"}
            bold={selectedIndex === index}
          >
            {selectedIndex === index ? "› " : "  "}
            {option}
          </Text>
        ))}
      </Box>
    </Box>
  );
}