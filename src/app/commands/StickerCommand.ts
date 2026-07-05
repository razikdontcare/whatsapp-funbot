import { downloadMediaMessage, proto, WAMessage } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  BotConfig,
  getCurrentConfig,
  log,
} from "../../infrastructure/config/config.js";
import { getMongoClient } from "../../infrastructure/config/mongo.js";
import { VIPService } from "../../domain/services/VIPService.js";
import { UserPreferenceService } from "../../domain/services/UserPreferenceService.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import sharp from "sharp";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import extractUrlsFromText from "../../shared/utils/extractUrlsFromText.js";
import {
  createFetchClient,
  isFetchError,
} from "../../shared/utils/fetchClient.js";
import webpmux from "node-webpmux";
import { WorkerPool } from "../../shared/utils/WorkerPool.js";
import type { Logger } from "pino";

// Type definitions
interface MediaData {
  buffer: Buffer;
  mediaType: "image" | "video";
  sourceExtension: string;
}

interface DetectedMediaInfo {
  mediaType: "image" | "video";
  extension: string;
}

export class StickerCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "sticker",
    aliases: ["s", "stiker"],
    description: "Convert gambar, video, atau GIF menjadi sticker WhatsApp.",
    helpText: `*Cara pakai:* 🎨
• Kirim gambar/video dengan caption *${BotConfig.prefix}sticker*
• Reply gambar/video/GIF dengan *${BotConfig.prefix}sticker*
• Kirim link media (contoh Giphy/Tenor) dengan *${BotConfig.prefix}sticker <url>*
• Cari GIF Giphy: *${BotConfig.prefix}sticker giphy <kata kunci>*
• Cari GIF Tenor: *${BotConfig.prefix}sticker tenor <kata kunci>*

*Opsi:*
• *${BotConfig.prefix}sticker --crop* — Crop ke tengah (512x512)
• Default: auto-fit dengan padding putih

*Batasan:*
• Ukuran file: maksimal 16MB
• Video: maksimal 10 detik (akan jadi animated sticker 🎬)

*Contoh:*
• Kirim gambar dengan caption: *${BotConfig.prefix}s*
• Reply gambar: *${BotConfig.prefix}s*
• Dari link Giphy: *${BotConfig.prefix}s https://giphy.com/gifs/...*
• Cari di Giphy: *${BotConfig.prefix}s giphy kucing lucu*
• Cari di Tenor: *${BotConfig.prefix}s tenor kucing lucu*
• Crop mode: *${BotConfig.prefix}s --crop*

👑 *VIP Members:* 
• No cooldown!
• Ganti nama pack: *${BotConfig.prefix}s pack <Nama Pack>*
• Ganti nama author: *${BotConfig.prefix}s author <Nama Author>*
(Otomatis tersimpan buat sticker selanjutnya)`,
    category: "utility",
    commandClass: StickerCommand,
    cooldown: 5000,
    maxUses: 3,
    vipBypassCooldown: true,
  };

  private readonly MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
  private readonly STICKER_SIZE = 512;
  private readonly URL_FETCH_TIMEOUT = 20000;
  private readonly MAX_REDIRECT_DEPTH = 3;
  private readonly PACK_NAME_MAX_LENGTH = 256;

  // Provider constants
  private readonly PROVIDERS = {
    GIPHY: "giphy.com",
    GIPHY_MEDIA: "media.giphy.com",
    TENOR: "tenor.com",
  } as const;

  private fetchClient = createFetchClient({
    timeout: this.URL_FETCH_TIMEOUT,
    headers: {
      "User-Agent": `${BotConfig.name}/1.0.0`,
      Accept: "*/*",
    },
  });

  private userPreferenceService: UserPreferenceService | null = null;

  private async getServices() {
    if (!this.userPreferenceService) {
      const mongoClient = await getMongoClient();
      this.userPreferenceService = new UserPreferenceService(mongoClient);
    }
    const vipService = await VIPService.getInstance();
    return {
      userPreferenceService: this.userPreferenceService,
      vipService,
    };
  }

  // Helper method to download media from WhatsApp message (eliminates code duplication)
  private async downloadMediaFromMessage(
    msg: proto.IWebMessageInfo,
    sock: WebSocketInfo,
    jid: string,
  ): Promise<MediaData | null> {
    try {
      // Priority 1: Direct image message
      if (msg.message?.imageMessage) {
        const stream = await downloadMediaMessage(
          <WAMessage>msg,
          "buffer",
          {},
          {
            logger: log as unknown as Logger,
            reuploadRequest: sock.updateMediaMessage,
          },
        );
        if (stream) {
          return {
            buffer: Buffer.from(stream),
            mediaType: "image",
            sourceExtension: "jpg",
          };
        }
      }

      // Priority 2: Direct video message
      if (msg.message?.videoMessage) {
        const videoMsg = msg.message.videoMessage;
        const stream = await downloadMediaMessage(
          <WAMessage>msg,
          "buffer",
          {},
          {
            logger: log as unknown as Logger,
            reuploadRequest: sock.updateMediaMessage,
          },
        );
        if (stream) {
          const isGif = videoMsg.gifPlayback || videoMsg.mimetype?.toLowerCase().includes("gif");
          return {
            buffer: Buffer.from(stream),
            mediaType: "video",
            sourceExtension: isGif ? "gif" : "mp4",
          };
        }
      }

      // Priority 3: Quoted message
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quotedMsg) {
        const baseQuotedMsg: proto.IWebMessageInfo = {
          key: {
            remoteJid: jid,
            fromMe: !msg.message?.extendedTextMessage?.contextInfo?.participant,
            id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
            participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
          },
          message: quotedMsg,
        };

        // Quoted image
        if (quotedMsg.imageMessage) {
          const stream = await downloadMediaMessage(
            <WAMessage>baseQuotedMsg,
            "buffer",
            {},
            {
              logger: log as unknown as Logger,
              reuploadRequest: sock.updateMediaMessage,
            },
          );
          if (stream) {
            return {
              buffer: Buffer.from(stream),
              mediaType: "image",
              sourceExtension: "jpg",
            };
          }
        }

        // Quoted video
        if (quotedMsg.videoMessage) {
          const videoMsg = quotedMsg.videoMessage;
          const stream = await downloadMediaMessage(
            <WAMessage>baseQuotedMsg,
            "buffer",
            {},
            {
              logger: log as unknown as Logger,
              reuploadRequest: sock.updateMediaMessage,
            },
          );
          if (stream) {
            const isGif = videoMsg.gifPlayback || videoMsg.mimetype?.toLowerCase().includes("gif");
            return {
              buffer: Buffer.from(stream),
              mediaType: "video",
              sourceExtension: isGif ? "gif" : "mp4",
            };
          }
        }

        // Reject quoted stickers
        if (quotedMsg.stickerMessage) {
          return null; // Special signal handled in main flow
        }
      }

      return null;
    } catch (error) {
      log.error("Error downloading media from message:", error);
      return null;
    }
  }

  // Validate and sanitize user input for pack/author names
  private sanitizePackName(name: string): string {
    return name
      .slice(0, this.PACK_NAME_MAX_LENGTH)
      .replace(/[^\w\s-]/g, "")
      .trim();
  }

  // Check if input is valid pack/author name
  private isValidPackName(name: string): boolean {
    return name.length > 0 && name.length <= this.PACK_NAME_MAX_LENGTH;
  }

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const config = await getCurrentConfig();
    const { userPreferenceService, vipService } = await this.getServices();

    try {
      const isVip = await vipService.isVIP(user);

      // Handle subcommands for VIP users to set custom pack/author
      if (
        args.length >= 2 &&
        (args[0].toLowerCase() === "pack" || args[0].toLowerCase() === "author")
      ) {
        if (!isVip) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Fitur ubah nama pack & author cuma buat VIP members bestie! 👑\n\nKetik *${config.prefix}vip* buat info lanjut.`,
          });
          return;
        }

        const value = args.slice(1).join(" ").trim();
        if (args[0].toLowerCase() === "pack") {
          await userPreferenceService.set(user, { stickerPack: value });
          await sock.sendMessage(jid, {
            text: `✅ Mantap! Mulai sekarang sticker kamu bakal pakai nama pack: *${value}*`,
          });
        } else {
          await userPreferenceService.set(user, { stickerAuthor: value });
          await sock.sendMessage(jid, {
            text: `✅ Mantap! Mulai sekarang sticker kamu bakal pakai nama author: *${value}*`,
          });
        }
        return; // Exit since we just updated preferences
      }

      const fullArgs = args.join(" ");
      let customPack: string | undefined;
      let customAuthor: string | undefined;

      const packMatch = fullArgs.match(/--pack\s+([^'"\s]+|'[^']+'|"[^"]+")/);
      if (packMatch) {
        customPack = packMatch[1].replace(/['"]/g, "");
      }

      const authorMatch = fullArgs.match(
        /--author\s+([^'"\s]+|'[^']+'|"[^"]+")/,
      );
      if (authorMatch) {
        customAuthor = authorMatch[1].replace(/['"]/g, "");
      }

      // Filter out parsed flags from args for cleaner extraction
      const cleanArgs = args.filter((arg, i) => {
        if (arg === "--pack" || arg === "--author") return false;
        if (i > 0 && (args[i - 1] === "--pack" || args[i - 1] === "--author"))
          return false;
        // if the arg was grouped in quotes it might be split across indices, but args.filter isn't perfect for quoted strings.
        // We'll rely on the existing logic and strip out matches from fullArgs string later if needed.
        return true;
      });

      // Instead of trying to patch args array flawlessly, let's just replace the raw matches in fullArgs
      const cleanCommandText = fullArgs
        .replace(/--pack\s+([^'"\s]+|'[^']+'|"[^"]+")/g, "")
        .replace(/--author\s+([^'"\s]+|'[^']+'|"[^"]+")/g, "")
        .replace(/--(c(rop)?|kotak)/g, "")
        .trim();

      const parsedArgs = cleanCommandText ? cleanCommandText.split(/\s+/) : [];

      if ((customPack || customAuthor) && !isVip) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Fitur edit nama pack & author cuma buat VIP members bestie! 👑\n\nKetik *${config.prefix}vip* buat info lanjut.`,
        });
        return;
      }

      let packName = config.name || "Nexa AI";
      let authorName = msg.pushName || user.split("@")[0];

      if (isVip) {
        const prefs = await userPreferenceService.get(user);

        if (customPack) {
          packName = customPack;
        } else if (prefs?.stickerPack) {
          packName = prefs.stickerPack;
        }

        if (customAuthor) {
          authorName = customAuthor;
        } else if (prefs?.stickerAuthor) {
          authorName = prefs.stickerAuthor;
        }

        if (customPack || customAuthor) {
          await userPreferenceService.set(user, {
            ...(customPack && { stickerPack: customPack }),
            ...(customAuthor && { stickerAuthor: customAuthor }),
          });
        }
      }

      // Check for crop flag
      const useCrop =
        fullArgs.includes("--crop") ||
        fullArgs.includes("--c") ||
        fullArgs.includes("--kotak") ||
        args.includes("crop") ||
        args.includes("c") ||
        args.includes("kotak");

      let mediaBuffer: Buffer | null = null;
      let mediaType: "image" | "video" | null = null;
      let sourceExtension = "mp4";

      // Priority 1: Check direct media message (image/video sent with command in caption)
      if (msg.message?.imageMessage) {
        mediaType = "image";
        const stream = await downloadMediaMessage(
          <WAMessage>msg,
          "buffer",
          {},
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            logger: log as any,
            reuploadRequest: sock.updateMediaMessage,
          },
        );
        mediaBuffer = stream ? Buffer.from(stream) : null;
      } else if (msg.message?.videoMessage) {
        mediaType = "video";
        sourceExtension =
          msg.message.videoMessage.gifPlayback ||
          msg.message.videoMessage.mimetype?.toLowerCase().includes("gif")
            ? "gif"
            : "mp4";
        const stream = await downloadMediaMessage(
          <WAMessage>msg,
          "buffer",
          {},
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            logger: log as any,
            reuploadRequest: sock.updateMediaMessage,
          },
        );
        mediaBuffer = stream ? Buffer.from(stream) : null;
      }
      // Priority 2: Check for quoted/replied message
      else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted =
          msg.message.extendedTextMessage.contextInfo.quotedMessage;

        if (quoted.imageMessage) {
          mediaType = "image";
          const quotedMsg: proto.IWebMessageInfo = {
            key: {
              remoteJid: jid,
              fromMe:
                !msg.message?.extendedTextMessage?.contextInfo?.participant,
              id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
              participant:
                msg.message?.extendedTextMessage?.contextInfo?.participant,
            },
            message: quoted,
          };
          const stream = await downloadMediaMessage(
            <WAMessage>quotedMsg,
            "buffer",
            {},
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              logger: log as any,
              reuploadRequest: sock.updateMediaMessage,
            },
          );
          mediaBuffer = stream ? Buffer.from(stream) : null;
        } else if (quoted.videoMessage) {
          mediaType = "video";
          sourceExtension =
            quoted.videoMessage.gifPlayback ||
            quoted.videoMessage.mimetype?.toLowerCase().includes("gif")
              ? "gif"
              : "mp4";
          const quotedMsg: proto.IWebMessageInfo = {
            key: {
              remoteJid: jid,
              fromMe:
                !msg.message?.extendedTextMessage?.contextInfo?.participant,
              id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
              participant:
                msg.message?.extendedTextMessage?.contextInfo?.participant,
            },
            message: quoted,
          };
          const stream = await downloadMediaMessage(
            <WAMessage>quotedMsg,
            "buffer",
            {},
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              logger: log as any,
              reuploadRequest: sock.updateMediaMessage,
            },
          );
          mediaBuffer = stream ? Buffer.from(stream) : null;
        } else if (quoted.stickerMessage) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Gambar yang kamu quote itu udah sticker bestie! 😅\n\nCoba quote gambar/video biasa aja.`,
          });
          return;
        }
      }

      // Priority 3: Check for URL source from args or quoted text
      if (!mediaBuffer || !mediaType) {
        const giphyQuery = this.extractGiphyQuery(parsedArgs);

        if (giphyQuery) {
          try {
            const giphyMediaUrl = await this.searchGiphyMediaUrl(giphyQuery);

            if (!giphyMediaUrl) {
              await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gak nemu hasil Giphy buat *${giphyQuery}* 😔\n\nCoba kata kunci lain ya.`,
              });
              return;
            }

            const downloadedMedia =
              await this.downloadMediaFromUrl(giphyMediaUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from Giphy query:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal cari GIF dari Giphy. Coba lagi ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        const tenorQuery = this.extractTenorQuery(parsedArgs);

        if ((!mediaBuffer || !mediaType) && tenorQuery) {
          try {
            const tenorMediaUrl = await this.searchTenorMediaUrl(tenorQuery);

            if (!tenorMediaUrl) {
              await sock.sendMessage(jid, {
                text: `${config.emoji.error} Gak nemu hasil Tenor buat *${tenorQuery}* 😔\n\nCoba kata kunci lain ya.`,
              });
              return;
            }

            const downloadedMedia =
              await this.downloadMediaFromUrl(tenorMediaUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from Tenor query:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal cari GIF dari Tenor. Coba lagi ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        const sourceUrl = this.extractSourceUrl(parsedArgs, msg);

        if ((!mediaBuffer || !mediaType) && sourceUrl) {
          try {
            const downloadedMedia = await this.downloadMediaFromUrl(sourceUrl);
            mediaBuffer = downloadedMedia.buffer;
            mediaType = downloadedMedia.mediaType;
            sourceExtension = downloadedMedia.sourceExtension;
          } catch (error) {
            log.error("Failed to create sticker from URL source:", error);

            const errorText =
              error instanceof Error
                ? error.message
                : "Gagal ambil media dari URL. Coba link lain ya.";

            await sock.sendMessage(jid, {
              text: `${config.emoji.error} ${errorText}`,
            });
            return;
          }
        }

        if ((!mediaBuffer || !mediaType) && this.isGiphyMode(parsedArgs)) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Kata kunci Giphy-nya mana bestie? 🤔\n\nContoh: *${config.prefix}sticker giphy kucing lucu*`,
          });
          return;
        }

        if ((!mediaBuffer || !mediaType) && this.isTenorMode(parsedArgs)) {
          await sock.sendMessage(jid, {
            text: `${config.emoji.error} Kata kunci Tenor-nya mana bestie? 🤔\n\nContoh: *${config.prefix}sticker tenor kucing lucu*`,
          });
          return;
        }
      }

      if (!mediaBuffer || !mediaType) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Mana gambar/video/link media-nya bestie? 🤔\n\n*Cara pakai:*\n• Kirim gambar/video dengan caption *${config.prefix}sticker*\n• Reply gambar/video dengan *${config.prefix}sticker*\n• Kasih link media (contoh Giphy/Tenor) dengan *${config.prefix}sticker <url>*\n• Cari GIF Giphy: *${config.prefix}sticker giphy <kata kunci>*\n• Cari GIF Tenor: *${config.prefix}sticker tenor <kata kunci>*\n\nPake *--crop* buat crop mode!`,
        });
        return;
      }

      // Check file size
      if (mediaBuffer.length > this.MAX_FILE_SIZE) {
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Waduh, file-nya terlalu gede nih (${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB)!\n\nMaksimal 16MB ya bestie 📦`,
        });
        return;
      }

      // Process media to sticker via Worker Pool to keep main thread responsive
      let stickerBuffer: Buffer;
      const workerPool = WorkerPool.getInstance();

      // Use helper to get the correct path for worker in both dev and prod
      const getProcessorPath = () => {
        if (process.env.NODE_ENV === "production" || process.env.USE_DIST) {
          return join(process.cwd(), "dist", "shared", "utils", "stickerProcessor.js");
        }
        return join(process.cwd(), "src", "shared", "utils", "stickerProcessor.ts");
      };

      const processorPath = getProcessorPath();

      try {
        if (mediaType === "video") {
          // Create animated sticker from video
          const result = await workerPool.run<Uint8Array>(
            processorPath,
            "createAnimatedSticker",
            [new Uint8Array(mediaBuffer), useCrop, sourceExtension],
          );
          stickerBuffer = Buffer.from(result);
        } else {
          const result = await workerPool.run<Uint8Array>(
            processorPath,
            "createSticker",
            [new Uint8Array(mediaBuffer), useCrop],
          );
          stickerBuffer = Buffer.from(result);
        }

        // Add EXIF via worker
        const sanitizedPackName = this.sanitizePackName(packName);
        const sanitizedAuthorName = this.sanitizePackName(authorName);

        const exifResult = await workerPool.run<Uint8Array>(
          processorPath,
          "addExif",
          [
            new Uint8Array(stickerBuffer),
            sanitizedPackName,
            sanitizedAuthorName,
          ],
        );

        // Send sticker
        await sock.sendMessage(jid, {
          sticker: Buffer.from(exifResult),
        });

        log.info(`Sticker created for user ${user} in ${jid}`);
      } catch (workerError) {
        log.error("Error in worker pool processing:", workerError);
        await sock.sendMessage(jid, {
          text: `${config.emoji.error} Error saat process sticker (worker error). Coba lagi ya! 😢`,
        });
      }
    } catch (error) {
      log.error("Error in StickerCommand:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Yah ada error nih pas bikin sticker 😢\n\nCoba lagi atau pakai gambar yang lain!`,
      });
    }
  }

  private extractSourceUrl(
    args: string[],
    msg: proto.IWebMessageInfo,
  ): string | null {
    const commandText = args.filter((arg) => !arg.startsWith("--")).join(" ");
    const urlFromArgs = extractUrlsFromText(commandText)[0];

    if (urlFromArgs) {
      return this.normalizeUrl(urlFromArgs);
    }

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
      return null;
    }

    const quotedText =
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption ||
      "";

    const urlFromQuoted = extractUrlsFromText(quotedText)[0];
    return urlFromQuoted ? this.normalizeUrl(urlFromQuoted) : null;
  }

  private isGiphyMode(args: string[]): boolean {
    const normalizedArgs = args
      .filter((arg) => !arg.startsWith("--"))
      .map((arg) => arg.toLowerCase());

    return normalizedArgs[0] === "giphy";
  }

  private isTenorMode(args: string[]): boolean {
    const normalizedArgs = args
      .filter((arg) => !arg.startsWith("--"))
      .map((arg) => arg.toLowerCase());

    return normalizedArgs[0] === "tenor";
  }

  private extractGiphyQuery(args: string[]): string | null {
    const normalizedArgs = args.filter((arg) => !arg.startsWith("--"));
    if (
      normalizedArgs.length < 2 ||
      normalizedArgs[0].toLowerCase() !== "giphy"
    ) {
      return null;
    }

    const query = normalizedArgs.slice(1).join(" ").trim();
    if (!query) {
      return null;
    }

    const maybeUrl = extractUrlsFromText(query)[0];
    return maybeUrl ? null : query;
  }

  private extractTenorQuery(args: string[]): string | null {
    const normalizedArgs = args.filter((arg) => !arg.startsWith("--"));
    if (
      normalizedArgs.length < 2 ||
      normalizedArgs[0].toLowerCase() !== "tenor"
    ) {
      return null;
    }

    const query = normalizedArgs.slice(1).join(" ").trim();
    if (!query) {
      return null;
    }

    const maybeUrl = extractUrlsFromText(query)[0];
    return maybeUrl ? null : query;
  }

  private async searchGiphyMediaUrl(query: string): Promise<string | null> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      return null;
    }

    const searchUrl = `https://giphy.com/search/${encodeURIComponent(normalizedQuery)}`;
    const response = await this.fetchClient.get<string>(searchUrl, {
      responseType: "text",
      timeout: this.URL_FETCH_TIMEOUT,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const giphyId = this.extractFirstGiphyIdFromHtml(response.data);
    if (!giphyId) {
      return null;
    }

    return `https://media.giphy.com/media/${giphyId}/giphy.mp4`;
  }

  private async searchTenorMediaUrl(query: string): Promise<string | null> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      return null;
    }

    type TenorResponse = {
      results?: Array<{
        media_formats?: Record<string, { url?: string }>;
      }>;
    };

    const response = await this.fetchClient.get<TenorResponse>(
      "https://g.tenor.com/v1/search",
      {
        params: {
          q: normalizedQuery,
          key: "LIVDSRZULELA",
          limit: 1,
          media_filter: "mp4,gif,webm",
          contentfilter: "medium",
        },
        responseType: "json",
        timeout: this.URL_FETCH_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 400,
      },
    );

    const mediaFormats = response.data.results?.[0]?.media_formats;
    return this.pickTenorMediaUrl(mediaFormats);
  }

  private pickTenorMediaUrl(
    mediaFormats?: Record<string, { url?: string }>,
  ): string | null {
    if (!mediaFormats) {
      return null;
    }

    const preferredFormats = [
      "mp4",
      "tinymp4",
      "nanomp4",
      "gif",
      "tinygif",
      "nanogif",
      "webm",
      "tinywebm",
    ];

    for (const formatKey of preferredFormats) {
      const url = mediaFormats[formatKey]?.url;
      if (url) {
        return url;
      }
    }

    return null;
  }

  private extractFirstGiphyIdFromHtml(html: string): string | null {
    const patterns = [
      /"id":"([a-zA-Z0-9]+)"/,
      /media\.giphy\.com\/media\/([a-zA-Z0-9]+)\/giphy\.(?:gif|mp4)/,
      /\/gifs\/[a-z0-9-]*-([a-zA-Z0-9]+)(?=["'/])/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  private normalizeUrl(url: string): string {
    return url.startsWith("www.") ? `https://${url}` : url;
  }

  private async downloadMediaFromUrl(url: string): Promise<{
    buffer: Buffer;
    mediaType: "image" | "video";
    sourceExtension: string;
  }> {
    this.validateSourceUrl(url);
    const resolvedUrl = this.resolveKnownProviderUrl(url);

    try {
      return await this.fetchMediaFromUrl(resolvedUrl);
    } catch (error) {
      if (isFetchError(error)) {
        const status = error.response?.status;
        if (status === 403 || status === 404) {
          throw new Error(
            "URL ini gak bisa diakses. Coba link media langsung ya.",
          );
        }

        throw new Error(
          "Gagal ambil media dari URL. Coba link lain atau ulangi sebentar lagi.",
        );
      }

      throw error;
    }
  }

  private resolveKnownProviderUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();

      if (!hostname.includes(this.PROVIDERS.GIPHY)) {
        return url;
      }

      const giphyId = this.extractGiphyId(parsedUrl.pathname);
      if (!giphyId) {
        return url;
      }

      return `https://${this.PROVIDERS.GIPHY_MEDIA}/media/${giphyId}/giphy.mp4`;
    } catch {
      return url;
    }
  }

  private extractGiphyId(pathname: string): string | null {
    const pathParts = pathname.split("/").filter(Boolean);

    const mediaIndex = pathParts.indexOf("media");
    if (mediaIndex >= 0 && pathParts[mediaIndex + 1]) {
      return pathParts[mediaIndex + 1];
    }

    const lastPathSegment = pathParts[pathParts.length - 1] || "";
    const candidate = lastPathSegment.split("-").pop() || "";

    return /^[a-zA-Z0-9]+$/.test(candidate) ? candidate : null;
  }

  private async fetchMediaFromUrl(
    initialUrl: string,
  ): Promise<{
    buffer: Buffer;
    mediaType: "image" | "video";
    sourceExtension: string;
  }> {
    let currentUrl = initialUrl;
    let depth = 0;

    // Iterative approach instead of recursive to prevent stack overflow
    while (depth < this.MAX_REDIRECT_DEPTH) {
      const response = await this.fetchClient.get<ArrayBuffer>(currentUrl, {
        responseType: "arraybuffer",
        timeout: this.URL_FETCH_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

      // Check size upfront to avoid unnecessary memory allocation
      if (contentLength > 0 && contentLength > this.MAX_FILE_SIZE) {
        throw new Error("File dari URL terlalu besar. Maksimal 16MB ya.");
      }

      const buffer = Buffer.from(response.data);

      if (buffer.length > this.MAX_FILE_SIZE) {
        throw new Error("File dari URL terlalu besar. Maksimal 16MB ya.");
      }

      const contentType = (response.headers.get("content-type") || "")
        .split(";")[0]
        .toLowerCase();

      if (
        contentType === "text/html" ||
        contentType === "application/xhtml+xml"
      ) {
        const htmlContent = buffer.toString("utf8");
        const mediaUrl = this.extractMediaUrlFromHtml(htmlContent, currentUrl);

        if (!mediaUrl) {
          throw new Error(
            "Link ini bukan media langsung. Coba link gambar/video/GIF ya.",
          );
        }

        this.validateSourceUrl(mediaUrl);
        currentUrl = mediaUrl;
        depth++;
        continue; // Try next URL
      }

      const detectedMedia = this.detectMediaType(contentType, currentUrl);
      if (!detectedMedia) {
        throw new Error(
          "Format media dari link ini belum didukung buat sticker.",
        );
      }

      return {
        buffer,
        mediaType: detectedMedia.mediaType,
        sourceExtension: detectedMedia.extension,
      };
    }

    throw new Error(
      "Terlalu banyak redirect/halaman perantara. Kasih link media langsung ya.",
    );
  }

  private extractMediaUrlFromHtml(
    html: string,
    baseUrl: string,
  ): string | null {
    const patterns = [
      /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<source[^>]+src=["']([^"']+)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const mediaUrl = match[1].replace(/&amp;/g, "&");

      try {
        return new URL(mediaUrl, baseUrl).toString();
      } catch {
        continue;
      }
    }

    return null;
  }

  private detectMediaType(
    contentType: string,
    url: string,
  ): { mediaType: "image" | "video"; extension: string } | null {
    const extensionFromUrl = this.getExtensionFromUrl(url);
    const extensionFromMime = this.getExtensionFromMime(contentType);

    if (contentType.startsWith("video/")) {
      return {
        mediaType: "video",
        extension: extensionFromMime || extensionFromUrl || "mp4",
      };
    }

    if (contentType.startsWith("image/")) {
      if (contentType === "image/gif" || extensionFromUrl === "gif") {
        return {
          mediaType: "video",
          extension: "gif",
        };
      }

      return {
        mediaType: "image",
        extension: extensionFromMime || extensionFromUrl || "png",
      };
    }

    if (!contentType || contentType === "application/octet-stream") {
      if (!extensionFromUrl) {
        return null;
      }

      if (["mp4", "webm", "mov", "mkv", "gif"].includes(extensionFromUrl)) {
        return {
          mediaType: "video",
          extension: extensionFromUrl,
        };
      }

      if (
        ["jpg", "jpeg", "png", "webp", "bmp", "tiff", "avif"].includes(
          extensionFromUrl,
        )
      ) {
        return {
          mediaType: "image",
          extension: extensionFromUrl,
        };
      }
    }

    return null;
  }

  private getExtensionFromUrl(url: string): string | null {
    try {
      const path = new URL(url).pathname;
      const extension = path.split(".").pop()?.toLowerCase() || "";

      return extension && /^[a-z0-9]+$/.test(extension) ? extension : null;
    } catch {
      return null;
    }
  }

  private getExtensionFromMime(contentType: string): string | null {
    const mimeMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/x-matroska": "mkv",
    };

    return mimeMap[contentType] || null;
  }

  private validateSourceUrl(url: string): void {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("URL-nya gak valid. Coba cek lagi link-nya ya.");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("URL harus pakai http atau https.");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    ) {
      throw new Error("URL lokal tidak diizinkan.");
    }

    if (this.isPrivateIPv4(hostname)) {
      throw new Error("URL private network tidak diizinkan.");
    }
  }

  private isPrivateIPv4(hostname: string): boolean {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
      return false;
    }

    const [a, b] = parts.map(Number);

    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  private sanitizeExtension(extension: string): string {
    const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!normalized) {
      return "mp4";
    }

    if (normalized.length > 5) {
      return normalized.slice(0, 5);
    }

    return normalized;
  }
}
