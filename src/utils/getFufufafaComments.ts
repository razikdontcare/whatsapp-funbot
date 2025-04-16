import axios from "axios";
import { log } from "../core/config.js";

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
      "https://fufufafapi.vanirvan.my.id/api/random",
      {
        timeout: 5000,
        family: 4,
      }
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
    log.error("Error fetching random Fufufafa comment:", error);
    throw error;
  }
}

export async function getFufufafaCommentById(id: number) {
  try {
    const response = await axios.get(
      `https://fufufafapi.vanirvan.my.id/api/${id}`,
      {
        timeout: 5000,
        family: 4,
      }
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
    log.error("Error fetching Fufufafa comment by ID:", error);
    throw error;
  }
}
