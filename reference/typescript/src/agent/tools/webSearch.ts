import { tool } from "ai";
import { z } from "zod";

/**
 * Provider-agnostic web search tool.
 * Requires an Exa API key in EXA_API_KEY.
 */
export const webSearch = tool({
  description:
    "Search the web for current information. Use this when the answer depends on recent or external information.",
  inputSchema: z.object({
    query: z.string().describe("The web search query"),
  }),
  execute: async ({ query }: { query: string }) => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return "Error: Missing EXA_API_KEY. Add it to .env to enable web search.";
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
        contents: {
          highlights: {
            numSentences: 3,
          },
        },
      }),
    });

    if (!response.ok) {
      return `Error searching web: ${response.status} ${response.statusText}`;
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        publishedDate?: string;
        highlights?: string[];
        text?: string;
      }>;
    };

    const results = data.results ?? [];
    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    return results
      .map((result, index) =>
        [
          `${index + 1}. ${result.title ?? "Untitled"}`,
          result.url,
          result.publishedDate ? `Published: ${result.publishedDate}` : undefined,
          result.highlights?.join("\n") ?? result.text,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
  },
});