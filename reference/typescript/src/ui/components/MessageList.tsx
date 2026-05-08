import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((message, index) => (
        <Box key={index} flexDirection="column">
          <Text color={message.role === 'user' ? 'blue' : 'green'} bold>
            {message.role === 'user' ? '› You' : '› Assistant'}
          </Text>
          <Box marginLeft={2}>
            <Text>{message.content}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}