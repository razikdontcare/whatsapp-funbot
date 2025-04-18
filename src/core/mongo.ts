import { MongoClient } from "mongodb";

let client: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!client) {
    const uri = process.env.MONGO_URI!;
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}
