import axios from "axios";

export type KBBIResponse = {
  lemma: string;
  definition: string;
};

export async function getRandomKBBI(): Promise<KBBIResponse> {
  try {
    const response = await axios.get(
      "https://kbbi.raf555.dev/api/v1/entry/_random"
    );
    const data = response.data;

    if (data) {
      const lemma = data.lemma;
      // Check if the lemma contains spaces or hyphens
      if (lemma.includes(" ") || lemma.includes("-")) {
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
    console.error("Error fetching random KBBI word:", error);
    throw error;
  }
}
