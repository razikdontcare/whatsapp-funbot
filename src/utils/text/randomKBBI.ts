import axios from "axios";
import { log } from "../../core/config.js";

export type KBBIResponse = {
  lemma: string;
  definition: string;
};

const BASE_URL = "https://kbbi.raf555.dev";

const kbbiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 5000,
  family: 4,
});

export async function getRandomKBBI(): Promise<KBBIResponse> {
  try {
    // replace recursion with loop-based retry
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      const response = await kbbiClient.get("/api/v1/entry/_random");
      const data = response.data;
      if (!data) {
        attempts++;
        continue;
      }
      const lemma = data.lemma;
      if (
        lemma.includes(" ") ||
        lemma.includes("-") ||
        lemma.includes(",") ||
        lemma.includes(".")
      ) {
        attempts++;
        continue;
      }
      return {
        lemma,
        definition: data.entries[0].definitions[0].definition,
      };
    }

    throw new Error(
      `Failed to fetch valid KBBI word after ${maxAttempts} attempts`
    );
  } catch (error) {
    log.error("Error fetching random KBBI word:", error);
    throw error;
  }
}
