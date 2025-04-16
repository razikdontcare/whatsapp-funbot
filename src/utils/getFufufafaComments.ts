import axios from "axios";

export type FufufafaCommentsResponse = {
  id: number;
  content: string;
  datetime: string;
  doksli: string;
  image_url: string;
};

export async function getRandomFufufafaComment(): Promise<FufufafaCommentsResponse> {
  try {
    const response = await axios.get(
      "https://fufufafapi.vanirvan.my.id/api/random"
    );
    const data = response.data;

    if (data) {
      return {
        id: data.id,
        content: data.content,
        datetime: data.datetime,
        doksli: data.doksli,
        image_url: data.image_url,
      };
    } else {
      throw new Error("No data found");
    }
  } catch (error) {
    console.error("Error fetching random Fufufafa comment:", error);
    throw error;
  }
}

export async function getFufufafaCommentById(id: number) {
  try {
    const response = await axios.get(
      `https://fufufafapi.vanirvan.my.id/api/${id}`
    );
    const data = response.data;

    if (data) {
      return {
        id: data.id,
        content: data.content,
        datetime: data.datetime,
        doksli: data.doksli,
        image_url: data.image_url,
      };
    } else {
      throw new Error("No data found");
    }
  } catch (error) {
    console.error("Error fetching Fufufafa comment by ID:", error);
    throw error;
  }
}
