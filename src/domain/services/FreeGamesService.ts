import { Collection, MongoClient } from "mongodb";
import { BotConfig, log } from "../../infrastructure/config/config.js";
import { getActiveMongoClient } from "../../infrastructure/config/mongo.js";

export interface GamerPowerGiveaway {
  id: number;
  title: string;
  worth: string;
  thumbnail: string;
  image: string;
  description: string;
  instructions: string;
  open_giveaway_url: string;
  published_date: string;
  type: string;
  platforms: string;
  end_date: string;
  users: number;
  status: string;
  gamerpower_url: string;
  open_giveaway: string;
}

interface SeenGiveaway {
  giveawayId: number;
  publishedAt: Date;
  firstSeenAt: Date;
}

interface PollNewGiveawaysOptions {
  bootstrapIfEmpty?: boolean;
  bootstrapLimit?: number;
  persist?: boolean;
}

export class FreeGamesService {
  private static instance: FreeGamesService | null = null;

  private get collection(): Collection<SeenGiveaway> {
    return getActiveMongoClient().db(BotConfig.sessionName).collection<SeenGiveaway>("freegames_seen");
  }

  private readonly apiUrl = "https://www.gamerpower.com/api/giveaways";

  private constructor(_mongoClient: MongoClient) {
    this.ensureIndexes().catch((error) => {
      log.error("Failed to initialize FreeGamesService indexes:", error);
    });
  }

  static async getInstance(
    mongoClient?: MongoClient,
  ): Promise<FreeGamesService> {
    if (!FreeGamesService.instance) {
      if (!mongoClient) {
        throw new Error(
          "MongoClient is required for first FreeGamesService initialization",
        );
      }
      FreeGamesService.instance = new FreeGamesService(mongoClient);
    }

    return FreeGamesService.instance;
  }

  async pollNewGiveaways(
    options: PollNewGiveawaysOptions = {},
  ): Promise<GamerPowerGiveaway[]> {
    const {
      bootstrapIfEmpty = true,
      bootstrapLimit = 3,
      persist = true,
    } = options;
    const giveaways = await this.fetchGiveaways();
    log.info(
      `[FreeGamesService] Fetched ${giveaways.length} giveaways from API`,
    );
    const invalidIds = giveaways
      .filter(
        (g) => !Number.isFinite(Number((g as unknown as { id?: unknown }).id)),
      )
      .map((g) => String((g as unknown as { id?: unknown }).id));
    if (invalidIds.length > 0) {
      log.warn(
        `[FreeGamesService] Ignoring ${invalidIds.length} giveaway(s) with non-numeric id(s): ${invalidIds.join(", ")}`,
      );
    }
    if (giveaways.length === 0) {
      return [];
    }

    const hasSeenData =
      (await this.collection.findOne({}, { projection: { _id: 1 } })) !== null;

    const ids = giveaways
      .map((item) => item.id)
      .filter((item) => Number.isFinite(item));
    log.debug(
      `[FreeGamesService] Candidate ids for known-check: ${ids.join(",")}`,
    );
    const knownIds = await this.collection
      .find({ giveawayId: { $in: ids } })
      .project({ giveawayId: 1, _id: 0 })
      .toArray();

    log.debug(
      `[FreeGamesService] Found ${knownIds.length} known id(s) in DB out of ${ids.length} candidate id(s)`,
    );

    const knownIdSet = new Set(knownIds.map((item) => item.giveawayId));
    const newGiveaways = giveaways.filter((item) => !knownIdSet.has(item.id));

    log.info(
      `[FreeGamesService] Computed ${newGiveaways.length} new giveaway(s) (fetched ${giveaways.length})`,
    );

    if (newGiveaways.length === 0) {
      log.debug("[FreeGamesService] No new giveaways to persist or return");
      return [];
    }

    // Persist immediately only when requested, or during initial bootstrap
    if (persist || !hasSeenData) {
      await this.persistSeenGiveaways(newGiveaways);
    }

    if (!hasSeenData && bootstrapIfEmpty) {
      const safeLimit = Math.max(1, Math.floor(bootstrapLimit));
      const bootstrapGiveaways = [...newGiveaways]
        .sort(
          (a, b) =>
            this.parseDate(b.published_date).getTime() -
            this.parseDate(a.published_date).getTime(),
        )
        .slice(0, safeLimit)
        .sort(
          (a, b) =>
            this.parseDate(a.published_date).getTime() -
            this.parseDate(b.published_date).getTime(),
        );

      log.info(
        `[FreeGamesService] Initial bootstrap returning ${bootstrapGiveaways.length} giveaway(s) from ${newGiveaways.length} fetched item(s)`,
      );

      return bootstrapGiveaways;
    }

    return newGiveaways.sort(
      (a, b) =>
        this.parseDate(a.published_date).getTime() -
        this.parseDate(b.published_date).getTime(),
    );
  }

  /**
   * Mark giveaways as seen in the DB. Safe to call after sending messages.
   */
  async markGiveawaysSeen(giveaways: GamerPowerGiveaway[]): Promise<void> {
    await this.persistSeenGiveaways(giveaways);
  }

  async getLatestGiveaways(limit = 5): Promise<GamerPowerGiveaway[]> {
    const giveaways = await this.fetchGiveaways();
    return giveaways
      .sort(
        (a, b) =>
          this.parseDate(b.published_date).getTime() -
          this.parseDate(a.published_date).getTime(),
      )
      .slice(0, limit);
  }

  async getSeenGiveawaysCount(): Promise<number> {
    return this.collection.countDocuments({});
  }

  async resetSeenGiveaways(): Promise<number> {
    const result = await this.collection.deleteMany({});
    return result.deletedCount ?? 0;
  }

  async resolveRedirectLocation(url: string): Promise<string> {
    let currentUrl = url;
    const visited = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      if (visited.has(currentUrl)) {
        break;
      }

      visited.add(currentUrl);
      const nextUrl = await this.getSingleRedirectLocation(currentUrl);
      if (!nextUrl) {
        return currentUrl;
      }

      currentUrl = nextUrl;
    }

    return currentUrl;
  }

  private async fetchGiveaways(): Promise<GamerPowerGiveaway[]> {
    const response = await fetch(this.apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WhatsApp-FunBot",
      },
    });

    if (!response.ok) {
      throw new Error(
        `GamerPower API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Array<
      GamerPowerGiveaway & { id: number | string }
    >;
    if (!Array.isArray(data)) {
      return [];
    }

    const normalized = data
      .map((item) => {
        const id =
          typeof item.id === "number"
            ? item.id
            : Number.parseInt(String(item.id), 10);

        if (!Number.isFinite(id)) {
          return null;
        }

        return {
          ...item,
          id,
        } as GamerPowerGiveaway;
      })
      .filter((item): item is GamerPowerGiveaway => item !== null);

    return normalized;
  }

  private async getSingleRedirectLocation(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "WhatsApp-FunBot",
        },
        signal: controller.signal,
      });

      if (response.status < 300 || response.status >= 400) {
        return null;
      }

      const location = response.headers.get("location");
      if (!location) {
        return null;
      }

      return new URL(location, url).toString();
    } catch (error) {
      log.warn(`Failed to resolve redirect location for URL: ${url}`, error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistSeenGiveaways(
    giveaways: GamerPowerGiveaway[],
  ): Promise<void> {
    if (giveaways.length === 0) {
      return;
    }

    const now = new Date();
    const docs: SeenGiveaway[] = giveaways.map((item) => ({
      giveawayId: item.id,
      publishedAt: this.parseDate(item.published_date),
      firstSeenAt: now,
    }));

    try {
      await this.collection.insertMany(docs, { ordered: false });
    } catch (error) {
      if (!isDuplicateWriteError(error)) {
        throw error;
      }
    }
  }

  private parseDate(input: string): Date {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return new Date();
    }

    return date;
  }

  private async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ giveawayId: 1 }, { unique: true });
    await this.collection.createIndex({ publishedAt: -1 });
  }
}

function isDuplicateWriteError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  try {
    const rec = error as Record<string, unknown>;
    if (rec && typeof rec.code !== "undefined") {
      if (typeof rec.code === "number") {
        return rec.code === 11000;
      }
      // Some drivers use string codes
      if (typeof rec.code === "string") {
        return Number(rec.code) === 11000;
      }
    }
    return false;
  } catch {
    return false;
  }
}
