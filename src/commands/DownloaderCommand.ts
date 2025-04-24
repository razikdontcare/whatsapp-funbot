import axios from "axios";
import { proto } from "baileys";
import { CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import extractUrlsFromText from "../utils/extractUrlsFromText.js";

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface TiktokPostDetails {
  id: string;
  desc: string;
  cookies: string;
  userAgent: string;
  type: "video" | "image";
  video?: TiktokVideoDetails;
  music: TiktokMusicDetails;
  author: TiktokAuthorDetails;
  images?: any;
}

export interface TiktokVideoDetails {
  height: number;
  width: number;
  duration: number;
  ratio: string;
  cover: string;
  playAddr: string;
  format: string;
}

export interface TiktokMusicDetails {
  id: string;
  title: string;
  playUrl: string;
  authorName: string;
  duration: number;
  isCopyrighted: boolean;
  original: boolean;
}

export interface TiktokAuthorDetails {
  id: string;
  username: string;
  name: string;
  bio: string;
  verified: boolean;
  picture: string;
}

export interface TiktokImageDetails {
  url: string;
  width: number;
  height: number;
}

export interface FacebookVideoQualityUrls {
  hd: string | null;
  sd: string | null;
}

export class DownloaderCommand implements CommandInterface {
  static commandInfo = {
    name: "downloader",
    aliases: ["dl", "download"],
    description: "Download video atau gambar dari platform yang didukung.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}downloader <url> — Download video atau gambar
• reply pesan lain yang berisi URL dengan ${BotConfig.prefix}downloader

Platform yang didukung saat ini:
- TikTok
- Facebook

*Contoh:*
${BotConfig.prefix}downloader https://vt.tiktok.com/ZSrG9QPK7/`,
    category: "general",
    commandClass: DownloaderCommand,
    cooldown: 10000,
    maxUses: 3,
  };

  private BASE_URL = "https://downloader.razik.net";
  private client = axios.create({
    baseURL: this.BASE_URL,
    timeout: 5000,
    family: 4,
  });
  private supportedPlatforms = [
    "tiktok.com",
    "facebook.com",
    "fb.watch",
  ] as const;

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
      await sock.sendMessage(jid, {
        text: `URL yang didukung: ${this.supportedPlatforms.join(", ")}`,
      });
      return;
    }

    // 2. Try to extract URL from args or quoted message
    let url = args[0] && this.isSupportedUrl(args[0]) ? args[0] : null;
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
        url = urls.find((u) => this.isSupportedUrl(u)) || null;
      }
    }
    // If still no URL, try to extract from the current message text
    if (!url && msg.message?.extendedTextMessage?.text) {
      const urls = extractUrlsFromText(msg.message.extendedTextMessage.text);
      url = urls.find((u) => this.isSupportedUrl(u)) || null;
    }

    if (!url) {
      await sock.sendMessage(jid, {
        text: "Silakan masukkan URL yang valid atau balas pesan yang berisi URL.",
      });
      return;
    }

    // 3. Check if the URL is from a supported platform
    const service = this.supportedPlatforms.find((platform) =>
      url.includes(platform)
    );
    if (!service) {
      await sock.sendMessage(jid, {
        text: `Platform tidak didukung. Saat ini hanya mendukung: ${this.supportedPlatforms.join(
          ", "
        )}`,
      });
      return;
    }

    // 4. Download and send media
    log.info("Downloading media from URL:", url);
    const mediaUrl = await this.getMediaURL(url, service);
    if (!mediaUrl) {
      await sock.sendMessage(jid, {
        text: "Tidak ada media yang ditemukan.",
      });
      return;
    }
    await sock.sendMessage(
      jid,
      {
        text: `Mengunduh media dari ${service}...`,
      },
      { quoted: msg }
    );

    log.info(`Found ${mediaUrl.length} media URLs for ${service}`);

    if (service === "tiktok.com") {
      if (mediaUrl.length > 1) {
        for (const media of mediaUrl) {
          await sock.sendMessage(
            jid,
            { image: { url: media } },
            { quoted: msg }
          );
        }
      } else if (mediaUrl[0].endsWith("view=true")) {
        await sock.sendMessage(
          jid,
          { video: { url: mediaUrl[0] } },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          jid,
          { image: { url: mediaUrl[0] } },
          { quoted: msg }
        );
      }
    } else if (service === "facebook.com" || service === "fb.watch") {
      await sock.sendMessage(
        jid,
        { video: { url: mediaUrl[0] } },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(jid, {
        text: "Tidak ada media yang ditemukan.",
      });
    }
  }

  isSupportedUrl(url: string): boolean {
    return this.supportedPlatforms.some((platform) => url.includes(platform));
  }

  async getMediaURL(
    url: string,
    service: (typeof this.supportedPlatforms)[number]
  ): Promise<string[] | null> {
    try {
      switch (service) {
        case "tiktok.com":
          const tiktokResponse = (
            await this.client.get(`/api/tiktok?url=${encodeURIComponent(url)}`)
          ).data as ApiResponse<TiktokPostDetails>;

          if (!tiktokResponse.success) {
            log.error("Error fetching TikTok data:", tiktokResponse.data);
            return null;
          }

          if (tiktokResponse.data.type === "video") {
            const videoUrl = tiktokResponse.data.video?.playAddr;
            if (videoUrl) {
              return [
                `${this.BASE_URL}/api/tiktok?url=${encodeURIComponent(
                  url
                )}&view=true`,
              ];
            } else {
              log.error(
                "No video URL found in TikTok response:",
                tiktokResponse
              );
              return null;
            }
          } else if (tiktokResponse.data.type === "image") {
            const imageUrl = tiktokResponse.data.images;
            if (imageUrl) {
              return imageUrl.map((image: TiktokImageDetails) => image.url);
            } else {
              log.error(
                "No image URL found in TikTok response:",
                tiktokResponse
              );
              return null;
            }
          } else {
            log.error("Unsupported media type:", tiktokResponse.data.type);
            return null;
          }

        case "facebook.com":
        case "fb.watch":
          const fbResponse = (
            await this.client.get(
              `/api/facebook?url=${encodeURIComponent(url)}`
            )
          ).data as ApiResponse<FacebookVideoQualityUrls[]>;
          if (!fbResponse.success) {
            log.error("Error fetching Facebook data:", fbResponse.message);
            return null;
          }

          const hdUrl = fbResponse.data[0]?.hd;
          const sdUrl = fbResponse.data[0]?.sd;

          if (hdUrl) {
            return [hdUrl];
          } else if (sdUrl) {
            return [sdUrl];
          } else {
            log.error("No video URL found in Facebook response:", fbResponse);
            return null;
          }

        default:
          log.error("Unsupported platform:", service);
          return null;
      }
    } catch (error) {
      log.error("Error downloading media:", error);
      return null;
    }
  }
}
