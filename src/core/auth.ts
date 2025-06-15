import { MongoClient, Binary } from "mongodb";
import baileys, {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  SignalDataTypeMap,
  SignalDataSet,
} from "baileys";
import { BotConfig, log } from "./config.js";
import { getMongoClient } from "./mongo.js";

const { proto, initAuthCreds } = baileys;

interface AuthDocument {
  _id: string;
  data?: Binary;
}

export const useMongoDBAuthState = async (
  // mongoUri: string,
  dbName: string = BotConfig.sessionName,
  collectionPrefix: string = "auth_"
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  removeCreds: () => Promise<void>;
  close: () => Promise<void>;
}> => {
  log.debug("Connecting to " + dbName + " database");
  log.debug("Using collection prefix: " + collectionPrefix);
  // Use provided client or create a new one
  let client = await getMongoClient();
  log.info("MongoDB connection established successfully");
  // if (!client) {
  //   try {
  //     await client.connect();
  //     log.info("MongoDB connection established successfully");
  //   } catch (error) {
  //     log.error("MongoDB connection error:", error);
  //     throw new Error(
  //       "Failed to connect to MongoDB. Check your connection string and network."
  //     );
  //   }
  // }
  const db = client.db(dbName);
  const collections = {
    creds: db.collection<AuthDocument>(`${collectionPrefix}creds`),
    keys: db.collection<AuthDocument>(`${collectionPrefix}keys`),
  };

  // Helper function to safely serialize data
  const serializeData = (data: unknown): Binary => {
    return new Binary(Buffer.from(JSON.stringify(data, BufferJSON.replacer)));
  };

  // Helper function to safely deserialize data
  const deserializeData = <T>(data: unknown): T | null => {
    try {
      if (data instanceof Binary) {
        return JSON.parse(data.toString(), BufferJSON.reviver) as T;
      }
      return data as T;
    } catch (error) {
      log.error("Deserialization error:", error);
      return null;
    }
  };

  // Helper function to retry database operations
  const retryOperation = async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> => {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.warn(
          `Database operation failed (attempt ${attempt}/${maxRetries}):`,
          lastError.message
        );

        if (attempt < maxRetries) {
          log.info(`Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          // Increase delay for next retry (exponential backoff)
          delayMs *= 1.5;
        }
      }
    }

    throw lastError || new Error("Operation failed after multiple retries");
  };

  // Initialize credentials with retry mechanism
  let creds: AuthenticationCreds;
  try {
    const credsDoc = await retryOperation(
      () => collections.creds.findOne({ _id: "creds" }),
      3,
      800
    );

    creds = credsDoc?.data
      ? deserializeData<AuthenticationCreds>(credsDoc.data) || initAuthCreds()
      : initAuthCreds();
    log.info("WhatsApp credentials loaded successfully");
  } catch (error) {
    log.warn("Failed to load credentials, initializing new ones:", error);
    creds = initAuthCreds();
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [_: string]: SignalDataTypeMap[T] }> => {
          const data: { [_: string]: SignalDataTypeMap[T] } = {};

          if (!ids.length) return data;

          try {
            const client = await getMongoClient();
            const collection = client
              .db(dbName)
              .collection<AuthDocument>(`${collectionPrefix}keys`);

            const docs = await retryOperation(
              () =>
                collections.keys
                  .find({
                    _id: { $in: ids.map((id) => `${type}-${id}`) },
                  })
                  .toArray(),
              3,
              800
            );

            for (const doc of docs) {
              const id = doc._id.replace(`${type}-`, "");
              let value = deserializeData<SignalDataTypeMap[T]>(doc.data);

              if (value && type === "app-state-sync-key") {
                // Cast to unknown first to satisfy TypeScript
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value
                ) as unknown as SignalDataTypeMap[T];
              }

              if (value) {
                data[id] = value;
              }
            }

            // Debug logging if keys were expected but not found
            if (ids.length > 0 && Object.keys(data).length === 0) {
              //   console.debug(`No keys found for type ${type} with ids:`, ids);
            }
          } catch (error) {
            console.error(`Failed to get keys for type ${type}:`, error);
          }

          return data;
        },
        set: async (data: SignalDataSet) => {
          if (!data || Object.keys(data).length === 0) {
            return; // Skip if no data to set
          }

          const client = await getMongoClient();
          const collection = client
            .db(dbName)
            .collection<AuthDocument>(`${collectionPrefix}keys`);

          const bulkOps: any[] = [];

          for (const category in data) {
            const typedCategory = category as keyof SignalDataTypeMap;
            const categoryData = data[typedCategory];

            if (categoryData) {
              for (const id in categoryData) {
                const value = categoryData[id];
                const key = `${typedCategory}-${id}`;

                bulkOps.push({
                  updateOne: {
                    filter: { _id: key },
                    update: {
                      $set: {
                        data:
                          value !== undefined && value !== null
                            ? serializeData(value)
                            : undefined,
                      },
                    },
                    upsert: true,
                  },
                });
              }
            }
          }

          if (bulkOps.length > 0) {
            try {
              await retryOperation(
                () => collections.keys.bulkWrite(bulkOps),
                3,
                800
              );
            } catch (error) {
              log.error("Failed to bulk write keys:", error);

              // If bulk operation fails, try individual writes
              log.warn("Attempting individual key writes as fallback...");
              for (const op of bulkOps) {
                try {
                  await retryOperation(
                    () =>
                      collections.keys.updateOne(
                        op.updateOne.filter,
                        op.updateOne.update,
                        { upsert: true }
                      ),
                    2,
                    500
                  );
                } catch (individualError) {
                  log.error(
                    `Failed to write key ${op.updateOne.filter._id}:`,
                    individualError
                  );
                }
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      try {
        const client = await getMongoClient();
        const collection = client
          .db(dbName)
          .collection<AuthDocument>(`${collectionPrefix}keys`);

        await retryOperation(
          () =>
            collections.creds.updateOne(
              { _id: "creds" },
              { $set: { data: serializeData(creds) } },
              { upsert: true }
            ),
          3,
          800
        );
        // log.debug("WhatsApp credentials saved successfully");
      } catch (error) {
        log.error("Failed to save credentials:", error);
        throw error; // Re-throw to handle upstream
      }
    },
    removeCreds: async () => {
      try {
        const client = await getMongoClient();
        const credsCollection = client
          .db(dbName)
          .collection<AuthDocument>(`${collectionPrefix}creds`);
        const keysCollection = client
          .db(dbName)
          .collection<AuthDocument>(`${collectionPrefix}keys`);

        await Promise.all([
          retryOperation(() => collections.creds.deleteMany({}), 3, 800),
          retryOperation(() => collections.keys.deleteMany({}), 3, 800),
        ]);
        log.info("WhatsApp credentials deleted successfully");
        Object.assign(creds, initAuthCreds());
      } catch (error) {
        log.error("Failed to remove credentials:", error);
        throw error; // Re-throw to handle upstream
      }
    },
    close: async () => {
      log.info(
        "Auth service cleanup completed (shared connection remains open)"
      );
    },
  };
};
