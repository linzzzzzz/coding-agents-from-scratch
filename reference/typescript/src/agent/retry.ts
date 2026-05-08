export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as Error & { status?: number };

      // Don't retry client errors (400, 401, 403) — they won't succeed
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw error;
      }

      if (attempt === maxRetries) throw error;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}
