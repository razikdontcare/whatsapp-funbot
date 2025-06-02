import axios from "axios";
import { proto } from "baileys";
import { CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import extractUrlsFromText from "../utils/extractUrlsFromText.js";
import { lookup } from "mime-types";

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

type Status = "tunnel" | "redirect" | "error" | "picker" | "local-processing";

type ResponseStatus<T extends Status, Extra = {}> = { status: T } & Extra;

type PickerObject = {
  type: "photo" | "video" | "gif";
  url: string;
  thumb?: string;
};

type ErrorContext = {
  service?: string;
  limit?: number;
};

type CobaltResponse =
  | ResponseStatus<"tunnel" | "redirect", { url: string; filename: string }>
  | ResponseStatus<
      "picker",
      { audio?: string; audioFilename?: string; picker: PickerObject[] }
    >
  | ResponseStatus<"error", { error: { code: string; context?: ErrorContext } }>
  | ResponseStatus<"local-processing">;

export class DownloaderCommand implements CommandInterface {
  static commandInfo = {
    name: "downloader",
    aliases: ["dl", "download"],
    description: "Download video atau gambar dari platform yang didukung.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}downloader <url> — Download video atau gambar
• reply pesan lain yang berisi URL dengan ${BotConfig.prefix}downloader

*Contoh:*
${BotConfig.prefix}downloader https://vt.tiktok.com/ZSrG9QPK7/`,
    category: "general",
    commandClass: DownloaderCommand,
    cooldown: 10000,
    maxUses: 3,
  };

  private BASE_URL = "https://cobalt.razik.net";
  private client = axios.create({
    baseURL: this.BASE_URL,
    timeout: 5000,
    family: 4,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    // 1. Handle help and url subcommands first
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: `Penggunaan: ${DownloaderCommand.commandInfo.helpText}`,
      });
      return;
    }
    if (args.length > 0 && args[0] === "url") {
      const supportedPlatformsRequest = await this.client.get("/");

      const supportedPlatforms = supportedPlatformsRequest.data.cobalt.services;

      await sock.sendMessage(jid, {
        text: `URL yang didukung: ${supportedPlatforms.join(", ")}`,
      });
      return;
    }

    // 2. Try to extract URL from args or quoted message
    let url = args[0] ? args[0] : null;
    if (!url && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      // Try to extract from quoted message text
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      let quotedText = "";
      if (quoted?.conversation) quotedText = quoted.conversation;
      else if (quoted?.extendedTextMessage?.text)
        quotedText = quoted.extendedTextMessage.text;
      else if (quoted?.imageMessage?.caption)
        quotedText = quoted.imageMessage.caption;
      if (quotedText) {
        const urls = extractUrlsFromText(quotedText);
        url = urls[0] || null;
      }
    }
    // If still no URL, try to extract from the current message text
    if (!url && msg.message?.extendedTextMessage?.text) {
      const urls = extractUrlsFromText(msg.message.extendedTextMessage.text);
      url = urls[0] || null;
    }

    if (!url) {
      await sock.sendMessage(jid, {
        text: "Silakan masukkan URL yang valid atau balas pesan yang berisi URL.",
      });
      return;
    }

    // 4. Download and send media
    log.info("Downloading media from URL:", url);
    const mediaUrl = await this.getMediaURL(url);
    if (mediaUrl instanceof Error) {
      await sock.sendMessage(jid, {
        text: `Terjadi kesalahan saat mengunduh media: ${mediaUrl.message}`,
      });
      return;
    }
    if (Array.isArray(mediaUrl)) {
      // If multiple media URLs are returned, send them all
      await sock.sendMessage(jid, {
        text: `Media tersedia: ${mediaUrl.length} items ditemukan.`,
      });
      for (const singleUrl of mediaUrl) {
        if (singleUrl.type === "photo") {
          await sock.sendMessage(jid, {
            image: { url: singleUrl.url },
          });
        } else if (singleUrl.type === "video") {
          await sock.sendMessage(jid, {
            video: { url: singleUrl.url },
          });
        } else if (singleUrl.type === "gif") {
          await sock.sendMessage(jid, {
            video: { url: singleUrl.url },
          });
        }
        log.info("Media sent:", singleUrl.url);
      }
    } else {
      // If a single media URL is returned, send it directly
      const mediaType = this.getMediaType(mediaUrl.filename);
      if (mediaType === "image") {
        await sock.sendMessage(jid, {
          image: { url: mediaUrl.url },
        });
      } else if (mediaType === "video") {
        await sock.sendMessage(jid, {
          video: { url: mediaUrl.url },
        });
      } else if (mediaType === "gif") {
        await sock.sendMessage(jid, {
          video: { url: mediaUrl.url },
        });
      } else {
        await sock.sendMessage(jid, {
          text: `Media tidak didukung untuk ${url}`,
        });
        return;
      }
      log.info("Media sent:", mediaUrl.url);
    }
    log.info("Media download completed for URL:", url);
  }

  getMediaType(filename: string): "image" | "video" | "gif" | "unknown" {
    const mimeType = lookup(filename);
    if (!mimeType) return "unknown";

    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType === "image/gif") return "gif";

    return "unknown";
  }

  async getMediaURL(
    url: string
  ): Promise<{ url: string; filename: string } | PickerObject[] | Error> {
    try {
      const response = (await this.client.post(`/`, {
        url,
      })) as ApiResponse<CobaltResponse>;

      if (
        response.data.status === "error" ||
        response.data.status === "local-processing"
      ) {
        log.error("Error fetching media data:", response.data);
        return new Error("Error fetching media data for URL: " + url);
      } else if (response.data.status === "picker") {
        log.info("Picker response received, media options available.");
        const picker = response.data.picker;
        if (picker.length === 0) {
          return new Error("No media options available for this URL.");
        }
        // Return URLs of all available media
        return picker;
      } else if (
        response.data.status === "tunnel" ||
        response.data.status === "redirect"
      ) {
        log.info("Media URL fetched successfully:", response.data.url);
        return response.data;
      } else {
        log.error("Unexpected response status:", response.data.status);
        return new Error("Unexpected response status: " + response.data.status);
      }
    } catch (error) {
      log.error("Error downloading media:", error);
      return new Error("Unknown error occurred while downloading media.");
    }
  }
}
