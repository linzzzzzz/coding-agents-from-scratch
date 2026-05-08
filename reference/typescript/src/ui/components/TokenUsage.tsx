import React from "react";
import { Box, Text } from "ink";
import type { TokenUsageInfo } from "../../types.ts";

interface TokenUsageProps {
  usage: TokenUsageInfo | null;
}

export function TokenUsage({ usage }: TokenUsageProps) {
  if (!usage) {
    return null;
  }

  const thresholdPercent = Math.round(usage.threshold * 100);
  const usagePercent = usage.percentage.toFixed(1);

  // Determine color based on usage
  let color: string = "green";
  if (usage.percentage >= usage.threshold * 100) {
    color = "red";
  } else if (usage.percentage >= usage.threshold * 100 * 0.75) {
    color = "yellow";
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        Tokens:{" "}
        <Text color={color} bold>
          {usagePercent}%
        </Text>
        <Text dimColor> (threshold: {thresholdPercent}%)</Text>
      </Text>
    </Box>
  );
}