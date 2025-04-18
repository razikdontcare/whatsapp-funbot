import axios from "axios";
import { log } from "../core/config.js";

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
    const response = await kbbiClient.get("/api/v1/entry/_random");
    const data = response.data;

    if (data) {
      const lemma = data.lemma;
      if (
        lemma.includes(" ") ||
        lemma.includes("-") ||
        lemma.includes(",") ||
        lemma.includes(".")
      ) {
        // If it does, recursively call the function to get another word
        return await getRandomKBBI();
      }
      return {
        lemma,
        definition: data.entries[0].definitions[0].definition,
      }; // Return the single word lemma without special characters
    } else {
      throw new Error("No data found");
    }
  } catch (error) {
    log.error("Error fetching random KBBI word:", error);
    throw error;
  }
}
