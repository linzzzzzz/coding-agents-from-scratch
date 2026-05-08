export const MAX_TOOL_RESULT_LENGTH = 50_000; // ~13k tokens

export function truncateResult(
  result: string,
  maxLength: number = MAX_TOOL_RESULT_LENGTH,
): string {
  if (result.length <= maxLength) return result;

  const half = Math.floor(maxLength / 2);
  const truncatedLines = result.slice(half, result.length - half).split("\n").length;

  return (
    result.slice(0, half) +
    `\n\n... [${truncatedLines} lines truncated] ...\n\n` +
    result.slice(result.length - half)
  );
}