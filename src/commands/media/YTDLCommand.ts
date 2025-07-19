import { proto } from "baileys";
import { CommandInterface, CommandInfo } from "../../core/CommandInterface.js";
import { BotConfig, getCurrentConfig, log } from "../../core/config.js";
import { WebSocketInfo } from "../../core/types.js";
import { SessionService } from "../../services/SessionService.js";
import { YtDlpWrapper } from "../../utils/media/ytdlp.js";
import extractUrlsFromText from "../../utils/text/extractUrlsFromText.js";

export class YTDLCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "ytdl",
    aliases: ["yt", "youtube", "dla"],
    description:
      "Download video or audio from YouTube or other supported platform.",
    helpText: `*Usage:*
• ${BotConfig.prefix}dla <url> — Download video or audio from YouTube or other supported platform.

*Example:*
• ${BotConfig.prefix}dla https://www.youtube.com/watch?v=dQw4w9WgXcQ`,
    category: "general",
    commandClass: YTDLCommand,
    cooldown: 10000,
    maxUses: 5,
  };

  private ytdl = new YtDlpWrapper();
  private readonly SEND_TIMEOUT = 300000; // 5 minutes timeout
  private readonly MAX_FILE_SIZE_MB = 100;

  private async sendWithTimeout(
    sock: WebSocketInfo,
    jid: string,
    message: any,
    timeoutMs: number = this.SEND_TIMEOUT
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Send timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      sock
        .sendMessage(jid, message)
        .then(() => {
          clearTimeout(timeout);
          resolve(true);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const config = await getCurrentConfig();
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: `Usage: ${YTDLCommand.commandInfo.helpText}`,
      });
      return;
    }

    const downloadMode = args.includes("audio") ? "audio" : "video";
    log.info("Download mode set to:", downloadMode);

    if (!config.disableWarning) {
      await sock.sendMessage(jid, {
        text: `*Info Penting:*\nCommand ini sedang dalam tahap pengembangan. Proses pengunduhan mungkin memerlukan waktu yang lama tergantung pada ukuran file dan kecepatan koneksi server. 
  
  Video akan diunduh dengan kualitas maksimal 1080p untuk mengoptimalkan ukuran file dan kecepatan download.
  
  Gunakan command ini hanya jika media yang diunduh dengan "${BotConfig.prefix}dl" tidak berhasil.\n\nDemi kenyamanan, proses pengunduhan akan dibatasi maksimal 5 menit. Jika file terlalu besar, silakan gunakan command "${BotConfig.prefix}dl" untuk mengunduh media yang lebih besar.`,
      });
    }

    // 2. Try to extract URL from args or quoted message
    let url = extractUrlsFromText(args.join(" "))[0] || null;
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

    if (!url) {
      await sock.sendMessage(jid, {
        text: "Silakan masukkan URL yang valid atau balas pesan yang berisi URL.",
      });
      return;
    }

    try {
      // Get video info first
      await sock.sendMessage(jid, {
        text: "🔍 Mengecek informasi video...",
      });

      const videoInfo = await this.ytdl.getVideoInfo(url);
      const duration = videoInfo.duration
        ? Math.round(videoInfo.duration / 60)
        : 0;
      const title = videoInfo.title || "Unknown";

      await sock.sendMessage(jid, {
        text: `📹 *${title}*\n⏱️ Durasi: ${duration} menit\n🔄 Memulai download ${downloadMode}...`,
      });

      const response =
        downloadMode === "audio"
          ? await this.ytdl.downloadAudio(url)
          : await this.ytdl.downloadVideo(url);

      if (!response) {
        await sock.sendMessage(jid, {
          text: "Gagal mengunduh media. Silakan coba lagi.",
        });
        return;
      }

      // Check file size
      const fileSizeMB = response.buffer.length / (1024 * 1024);
      if (fileSizeMB > this.MAX_FILE_SIZE_MB) {
        await sock.sendMessage(jid, {
          text: `❌ File terlalu besar (${fileSizeMB.toFixed(1)}MB). Maksimal ${
            this.MAX_FILE_SIZE_MB
          }MB.`,
        });
        return;
      }

      await sock.sendMessage(jid, {
        text: `📤 Mengirim ${downloadMode} (${fileSizeMB.toFixed(1)}MB)...`,
      });

      if (downloadMode === "audio") {
        try {
          await this.sendWithTimeout(sock, jid, {
            audio: response.buffer,
            mimetype: "audio/mp4",
            fileName: response.filename,
          });
        } catch (error) {
          log.error("Failed to send audio:", error);
          await sock.sendMessage(jid, {
            text: "Gagal mengirim audio. File mungkin terlalu besar atau koneksi timeout.",
          });
        }
        return;
      } else {
        try {
          // Send a status message for large videos
          if (response.buffer.length > 50 * 1024 * 1024) {
            // 50MB
            await sock.sendMessage(jid, {
              text: "Mengirim video besar, mohon tunggu maksimal 5 menit.",
            });
          }

          await this.sendWithTimeout(sock, jid, {
            video: response.buffer,
            mimetype: "video/mp4",
            fileName: response.filename,
          });
        } catch (error) {
          log.error("Failed to send video:", error);
          if (error instanceof Error && error.message.includes("timeout")) {
            await sock.sendMessage(jid, {
              text: "Timeout saat mengirim video. File mungkin terlalu besar.",
            });
          } else {
            await sock.sendMessage(jid, {
              text: "Gagal mengirim video. File mungkin terlalu besar atau terjadi kesalahan.",
            });
          }
        }
        return;
      }
    } catch (error) {
      log.error("Download failed:", error);
      await this.handleDownloadError(error, sock, jid);
      return;
    }
  }

  private async handleDownloadError(
    error: any,
    sock: WebSocketInfo,
    jid: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("timeout")) {
      await sock.sendMessage(jid, {
        text: "⏰ Timeout saat mengunduh. Coba lagi atau gunakan URL yang berbeda.",
      });
    } else if (errorMessage.includes("too long")) {
      await sock.sendMessage(jid, {
        text: `⏱️ ${errorMessage}`,
      });
    } else if (errorMessage.includes("Live streams")) {
      await sock.sendMessage(jid, {
        text: "📺 Live stream tidak didukung. Gunakan video yang sudah selesai.",
      });
    } else if (errorMessage.includes("Private video")) {
      await sock.sendMessage(jid, {
        text: "🔒 Video private tidak dapat diunduh.",
      });
    } else {
      await sock.sendMessage(jid, {
        text: "❌ Gagal mengunduh media. Periksa URL dan coba lagi.",
      });
    }
  }
}
