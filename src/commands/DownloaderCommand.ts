import axios, { AxiosResponse } from "axios";
import { proto } from "baileys";
import { CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import extractUrlsFromText from "../utils/extractUrlsFromText.js";
import { mimeType } from "mime-type/with-db";

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

type CobaltRequestBody = {
  url: string;
  audioBitrate?: "320" | "256" | "128" | "96" | "64" | "8";
  audioFormat?: "best" | "mp3" | "ogg" | "wav" | "opus";
  downloadMode?: "auto" | "audio" | "mute";
  filenameStyle?: "classic" | "pretty" | "basic" | "nerdy";
  videoQuality?:
    | "max"
    | "4320"
    | "2160"
    | "1440"
    | "1080"
    | "720"
    | "480"
    | "360"
    | "240"
    | "144";
  disableMetadata?: boolean;
  alwaysProxy?: boolean;
  localProcessing?: boolean;
};

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

    const downloadMode = args.includes("audio")
      ? "audio"
      : args.includes("mute")
      ? "mute"
      : "auto";
    log.info("Download mode set to:", downloadMode);

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
    const mediaResponse = await this.getMediaURL(url, downloadMode);
    if (mediaResponse instanceof Error) {
      log.error("Error downloading media:", mediaResponse.message);
      await sock.sendMessage(jid, {
        text: `Terjadi kesalahan saat mengunduh media: ${mediaResponse.message}`,
      });
      return;
    }
    if (Array.isArray(mediaResponse)) {
      // If multiple media URLs are returned, send them all
      await sock.sendMessage(jid, {
        text: `Media tersedia: ${mediaResponse.length} items ditemukan.`,
      });
      for (const singleUrl of mediaResponse) {
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
      const mediaType = this.getMediaType(mediaResponse.filename);
      if (mediaType === "image") {
        await sock.sendMessage(jid, {
          image: { url: mediaResponse.url },
        });
      } else if (mediaType === "video") {
        await sock.sendMessage(jid, {
          video: { url: mediaResponse.url },
        });
      } else if (mediaType === "gif") {
        await sock.sendMessage(jid, {
          video: { url: mediaResponse.url },
        });
      } else if (mediaType === "audio") {
        await sock.sendMessage(jid, {
          audio: { url: mediaResponse.url },
          mimetype: "audio/mp4",
          ptt: false,
        });
      } else {
        await sock.sendMessage(jid, {
          text: `Media tidak didukung untuk ${url}`,
        });
        return;
      }
    }
    log.info("Media download completed for URL:", url);
  }

  getMediaType(
    filename: string
  ): "image" | "video" | "gif" | "audio" | "unknown" {
    const mime = mimeType.lookup(filename);
    if (!mime) return "unknown";

    const mimeString = Array.isArray(mime) ? mime[0] : mime;
    if (mimeString.startsWith("image/")) return "image";
    if (mimeString.startsWith("video/")) return "video";
    if (mimeString === "image/gif") return "gif";
    if (mimeString.startsWith("audio/")) return "audio";

    return "unknown";
  }

  async getMediaURL(
    url: string,
    downloadMode: "auto" | "audio" | "mute" = "auto"
  ): Promise<{ url: string; filename: string } | PickerObject[] | Error> {
    try {
      const response = (await this.client.post(`/`, {
        url,
        downloadMode,
      } satisfies CobaltRequestBody)) as AxiosResponse<CobaltResponse>;

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
