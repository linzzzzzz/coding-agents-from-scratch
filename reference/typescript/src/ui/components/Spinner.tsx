import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Thinking...' }: SpinnerProps) {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      {' '}
      <Text dimColor>{label}</Text>
    </Text>
  );
}