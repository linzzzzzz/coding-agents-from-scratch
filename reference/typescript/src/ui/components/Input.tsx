import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return || /[\r\n]/.test(input)) {
      const beforeReturn = input.split(/[\r\n]/)[0] ?? '';
      const trimmedValue = `${value}${beforeReturn}`.trim();
      if (trimmedValue) {
        onSubmit(trimmedValue);
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box>
      <Text color="blue" bold>
        {'> '}
      </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}
    </Box>
  );
}
