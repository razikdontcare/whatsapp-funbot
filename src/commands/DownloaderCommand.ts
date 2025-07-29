import axios, { AxiosResponse } from "axios";
import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, getCurrentConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import extractUrlsFromText from "../utils/extractUrlsFromText.js";
import { mimeType } from "mime-type/with-db";
import { convertMp3ToOgg } from "../utils/ffmpeg.js";

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
  localProcessing?: "disabled" | "preferred" | "forced";
  subtitleLang?: string; // ISO 639-1 language code
  youtubeVideoCodec?: "h264" | "av1" | "vp9";
  youtubeVideoContainer?: "auto" | "mp4" | "webm" | "mkv";
  youtubeDubLang?: string; // ISO 639-1 language code
  convertGif?: boolean;
  allowH265?: boolean;
  tiktokFullAudio?: boolean;
  youtubeBetterAudio?: boolean;
  youtubeHLS?: boolean;
};

export class DownloaderCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
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
    timeout: 15000, // Increased timeout for better reliability
    family: 4,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "WhatsApp-FunBot/1.0.0", // Add user agent for better compatibility
    },
    validateStatus: (status) => status < 500, // Don't throw on 4xx errors
  });

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const config = await getCurrentConfig();
    // 1. Handle help and url subcommands first
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: `Penggunaan: ${DownloaderCommand.commandInfo.helpText}`,
      });
      return;
    }
    if (args.length > 0 && args[0] === "url") {
      try {
        const supportedPlatformsRequest = await this.client.get("/");
        const supportedPlatforms =
          supportedPlatformsRequest.data.cobalt.services;

        await sock.sendMessage(jid, {
          text: `🌐 Platform yang didukung:\n${supportedPlatforms.join(", ")}`,
        });
      } catch (error) {
        log.error("Failed to fetch supported platforms:", error);
        await sock.sendMessage(jid, {
          text: "❌ Duh, gabisa ambil list platform yang didukung. Coba lagi aja ya bestie! 😅",
        });
      }
      return;
    }

    if (!config.disableWarning) {
      await sock.sendMessage(jid, {
        text: `*Info:* Platform YouTube dengan command ini sedang bermasalah, gunakan alternatif "${BotConfig.prefix}dla" untuk mengunduh video/audio YouTube.`,
      });
    }

    const downloadMode = args.includes("audio")
      ? "audio"
      : args.includes("mute")
      ? "mute"
      : "auto";
    log.info("Download mode set to:", downloadMode);

    // 2. Try to extract URL from args or quoted message
    let url: string | null = null;

    try {
      const urlsFromArgs = extractUrlsFromText(args.join(" "));
      url = urlsFromArgs.length > 0 ? urlsFromArgs[0] : null;
    } catch (error) {
      log.error("Failed to extract URL from args:", error);
    }

    if (!url && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      try {
        // Try to extract from quoted message text
        const quoted =
          msg.message.extendedTextMessage.contextInfo.quotedMessage;
        let quotedText = "";
        if (quoted?.conversation) quotedText = quoted.conversation;
        else if (quoted?.extendedTextMessage?.text)
          quotedText = quoted.extendedTextMessage.text;
        else if (quoted?.imageMessage?.caption)
          quotedText = quoted.imageMessage.caption;

        if (quotedText) {
          const urls = extractUrlsFromText(quotedText);
          url = urls.length > 0 ? urls[0] : null;
        }
      } catch (error) {
        log.error("Failed to extract URL from quoted message:", error);
      }
    }

    if (!url) {
      await sock.sendMessage(jid, {
        text: `💔 Eh mana URL-nya? Gak ada yang bisa didownload nih!\n\n*How to use:*\n• ${BotConfig.prefix}downloader <url> — Paste link kamu di sini\n• Reply pesan yang ada link-nya pakai ${BotConfig.prefix}downloader\n\nBingung platform mana aja? Ketik ${BotConfig.prefix}downloader url buat liat list-nya! ✨`,
      });
      return;
    }

    // 4. Download and send media
    log.info("Downloading media from URL:", url);

    try {
      const mediaResponse = await this.getMediaURL(url, downloadMode);

      if (mediaResponse instanceof Error) {
        log.error("Error downloading media:", mediaResponse.message);
        await sock.sendMessage(jid, {
          text: `❌ ${mediaResponse.message}`,
        });
        return;
      }

      if (Array.isArray(mediaResponse)) {
        // If multiple media URLs are returned, send them all
        const mediaCount = mediaResponse.length;
        await sock.sendMessage(jid, {
          text: `📁 Ketemu ${mediaCount} media nih! Ngirim sekarang... 🚀`,
        });

        let successCount = 0;
        for (const singleUrl of mediaResponse) {
          try {
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
            successCount++;
            log.info("Media sent:", singleUrl.url);
          } catch (sendError) {
            log.error("Failed to send media:", singleUrl.url, sendError);
            // Continue with other media even if one fails
          }
        }

        if (successCount === 0) {
          await sock.sendMessage(jid, {
            text: "💀 Waduh, semua media gagal dikirim. Ada error nih, coba lagi nanti ya!",
          });
        } else if (successCount < mediaCount) {
          await sock.sendMessage(jid, {
            text: `🤔 Hmm, cuma berhasil kirim ${successCount} dari ${mediaCount} media. Yang lain ada kendala kayaknya~`,
          });
        }
      } else {
        // If a single media URL is returned, send it directly
        const mediaType = this.getMediaType(mediaResponse.filename);

        try {
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
            try {
              const resp = await axios.get(mediaResponse.url, {
                responseType: "arraybuffer",
                family: 4,
                timeout: 30000, // Increased timeout for audio files
                maxContentLength: 50 * 1024 * 1024, // 50MB limit
                maxBodyLength: 50 * 1024 * 1024, // 50MB limit
              });

              const audioBuffer = Buffer.from(resp.data);

              // Check buffer size before processing
              if (audioBuffer.length > 50 * 1024 * 1024) {
                // 50MB
                throw new Error("Audio file too large");
              }

              // Convert MP3 to OGG if needed
              const oggBuffer = await convertMp3ToOgg(audioBuffer);

              await sock.sendMessage(jid, {
                audio: oggBuffer,
                mimetype: "audio/mp4",
                ptt: false,
              });

              await sock.sendMessage(jid, {
                text: `🎵 Audio udah sampe! Gw convert ke OGG biar WA-nya happy~\n\nKalo mau format asli ya langsung aja: ${mediaResponse.url}`,
              });
            } catch (audioError) {
              log.error("Failed to process audio:", audioError);
              await sock.sendMessage(jid, {
                text: `💔 Yah, audio-nya error pas diproses. Langsung download aja ya: ${mediaResponse.url}`,
              });
            }
          } else {
            await sock.sendMessage(jid, {
              text: `🙄 Media type-nya gak support buat dikirim otomatis.\n\nYa udah, download manual aja: ${mediaResponse.url}`,
            });
            return;
          }
        } catch (sendError) {
          log.error("Failed to send media:", sendError);
          await sock.sendMessage(jid, {
            text: `😔 Yah gabisa kirim media-nya. Tapi tenang, direct link-nya ada kok: ${mediaResponse.url}`,
          });
          return;
        }
      }

      log.info("Media download completed for URL:", url);
    } catch (unexpectedError) {
      log.error("Unexpected error in handleCommand:", unexpectedError);
      await sock.sendMessage(jid, {
        text: "💀 Yah ada error yang aneh nih. Coba lagi aja nanti ya bestie! 🥺",
      });
    }
  }

  getMediaType(
    filename: string
  ): "image" | "video" | "gif" | "audio" | "unknown" {
    const mime = mimeType.lookup(filename);
    if (!mime) return "unknown";

    const mimeString = Array.isArray(mime) ? mime[0] : mime;
    if (mimeString === "image/gif") return "gif"; // Check GIF first before general image check
    if (mimeString.startsWith("image/")) return "image";
    if (mimeString.startsWith("video/")) return "video";
    if (mimeString.startsWith("audio/")) return "audio";

    return "unknown";
  }

  private async makeRequestWithRetry(
    requestBody: CobaltRequestBody,
    maxRetries: number = 2
  ): Promise<AxiosResponse<CobaltResponse>> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await this.client.post(`/`, requestBody);
        return response as AxiosResponse<CobaltResponse>;
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (4xx) or specific server errors
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status && (status < 500 || status === 503)) {
            // Don't retry on 4xx errors or 503 (service unavailable)
            throw error;
          }
        }

        // Wait before retrying (exponential backoff)
        if (attempt <= maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
          log.info(
            `Request failed, retrying in ${delay}ms (attempt ${attempt}/${
              maxRetries + 1
            })`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async getMediaURL(
    url: string,
    downloadMode: "auto" | "audio" | "mute" = "auto"
  ): Promise<{ url: string; filename: string } | PickerObject[] | Error> {
    try {
      // Validate URL format
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return new Error(
          "Heh, URL-nya mana? Kosong gini gimana mau download 🤨"
        );
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return new Error(
          "URL-nya aneh deh, formatnya salah. Paste yang bener dong! 😅"
        );
      }

      // Prepare request body according to API specification
      const requestBody: CobaltRequestBody = {
        url: url.trim(),
        downloadMode,
        audioFormat: "mp3", // Set default audio format
        videoQuality: "1080", // Set default video quality
        filenameStyle: "basic", // Set default filename style
      };

      const response = await this.makeRequestWithRetry(requestBody);

      // Handle error responses with detailed error messages
      if (response.data.status === "error") {
        const errorData = response.data as ResponseStatus<
          "error",
          { error: { code: string; context?: ErrorContext } }
        >;
        const errorCode = errorData.error.code;
        const context = errorData.error.context;

        log.error("Cobalt API error:", { code: errorCode, context });

        // Return user-friendly error messages based on error codes
        switch (errorCode) {
          case "error.api.fetch.empty":
            return new Error(
              "Duh, gak ada konten apapun di URL itu. Coba link yang lain! 😕"
            );
          case "error.api.link.unsupported":
            const service = context?.service
              ? ` Link ${context.service} yang kamu kasih gak didukung nih. Make sure link-nya valid ya bestie! 🤷‍♀️`
              : "";
            return new Error(`Yah URL-nya gak support.${service}`);
          case "error.api.link.invalid":
            return new Error(
              "Link-nya invalid bestie. Double check lagi dong! 🔍"
            );
          default:
            // For all other error codes, provide a general error message
            // with the error code for debugging purposes
            const contextInfo = context?.service
              ? ` (Platform: ${context.service})`
              : context?.limit
              ? ` (Limit: ${context.limit})`
              : "";
            return new Error(
              `Waduh gagal download media-nya${contextInfo}. Coba lagi aja nanti! 🥺`
            );
        }
      }

      // Handle local processing (not supported in this implementation)
      if (response.data.status === "local-processing") {
        log.warn("Local processing required but not supported:", response.data);
        return new Error(
          "Oof, konten ini butuh processing khusus yang belum disupport. Coba link lain ya! 😅"
        );
      }

      // Handle picker response
      if (response.data.status === "picker") {
        log.info("Picker response received, media options available.");
        const pickerData = response.data as ResponseStatus<
          "picker",
          { audio?: string; audioFilename?: string; picker: PickerObject[] }
        >;
        const picker = pickerData.picker;

        if (!picker || picker.length === 0) {
          return new Error(
            "Gak ada opsi media yang bisa diambil dari URL ini. Sad 😢"
          );
        }

        // Return URLs of all available media
        return picker;
      }

      // Handle successful tunnel/redirect responses
      if (
        response.data.status === "tunnel" ||
        response.data.status === "redirect"
      ) {
        const mediaData = response.data as ResponseStatus<
          "tunnel" | "redirect",
          { url: string; filename: string }
        >;

        if (!mediaData.url) {
          return new Error(
            "Eh, server gak kasih link media-nya. Aneh banget! 🤔"
          );
        }

        return {
          url: mediaData.url,
          filename: mediaData.filename || "downloaded_media",
        };
      }

      // Handle unexpected status
      log.error("Unexpected response status:", response.data.status);
      return new Error(
        `Server response-nya aneh: ${response.data.status}. Something's not right 🤨`
      );
    } catch (error) {
      log.error("Error downloading media:", error);

      // Handle specific axios errors
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          return new Error(
            "Yah, server lama banget responnya. Timeout deh! Coba lagi nanti ya 😴"
          );
        }
        if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
          return new Error(
            "Gabisa connect ke server download. Ada masalah nih, kontak admin dong! 📞"
          );
        }
        if (error.response?.status === 429) {
          return new Error(
            "Waduh, terlalu banyak request! Slow down bestie 🐌"
          );
        }
        if (error.response?.status === 503) {
          return new Error("Server-nya lagi down. Coba lagi nanti ya! 🔧");
        }
        if (error.response && error.response.status >= 500) {
          return new Error(
            "Server error nih. Admin-nya pasti lagi pusing! Coba lagi nanti 🤕"
          );
        }
        if (error.response?.status === 400) {
          return new Error(
            "Request-nya invalid. Cek lagi URL yang kamu masukin! 🔍"
          );
        }
        if (error.response?.status === 404) {
          return new Error(
            "Endpoint gak ketemu. Sepertinya ada config yang salah. Hit up admin! 🚨"
          );
        }

        return new Error(
          `HTTP error ${error.response?.status || "unknown"}: ${
            error.message
          } - Something went wrong bestie! 😵`
        );
      }

      // Handle other types of errors
      if (error instanceof Error) {
        return new Error(
          `Network error: ${error.message} - Internet lagi lemot? 🐌`
        );
      }

      return new Error(
        "Ada error yang gak jelas nih pas download media. Mystery error! 👻"
      );
    }
  }
}
