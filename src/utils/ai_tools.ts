import { tavily } from "@tavily/core";
import { log, BotConfig } from "../core/config.js";

const tavilyClient = tavily({
  apiKey: BotConfig.tavilyApiKey,
});

export async function web_search(query: string): Promise<string> {
  try {
    log.info(`Performing web search for query: ${query}`);
    if (!query) {
      return "Tidak ada query yang diberikan untuk pencarian web.";
    }
    const response = await tavilyClient.search(query, {
      searchDepth: "advanced",
      includeAnswer: true,
    });
    if (response.answer && response.results && response.results.length > 0) {
      // url, title, and score
      const sources = response.results
        .map((result) => {
          return `- [${result.title}](${result.url}) (Score: ${result.score})`;
        })
        .join("\n");
      return `${response.answer}\n\nSumber:\n${sources}`;
    } else if (response.results && response.results.length > 0) {
      return response.results.map((result) => result.title).join("\n");
    } else {
      return "Tidak ada hasil yang ditemukan.";
    }
  } catch (error) {
    console.error("Error fetching Tavily search results:", error);
    return "Terjadi kesalahan saat melakukan pencarian.";
  }
}
