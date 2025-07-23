import { MongoClient, ServerApiVersion } from "mongodb";

let client: MongoClient | null = null;

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

export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export function isMongoConnected(): boolean {
  return client !== null;
}
