import { MongoClient, ServerApiVersion } from "mongodb";

let client: MongoClient | null = null;

/**
 * Get a singleton MongoDB client instance, connecting if necessary.
 * Ensures connection is alive, reconnects if needed.
 */
export async function getMongoClient(): Promise<MongoClient> {
  if (!client) {
    const uri = process.env.MONGO_URI!;
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();
  }

  try {
    await client.db("admin").command({ ping: 1 });
  } catch (error) {
    if (client) {
      await client.close().catch(() => {});
    }
    client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
  }
  return client;
}

/**
 * Close the MongoDB client connection if open.
 */
export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * Check if the MongoDB client is currently connected.
 */
export function isMongoConnected(): boolean {
  return client !== null;
}
