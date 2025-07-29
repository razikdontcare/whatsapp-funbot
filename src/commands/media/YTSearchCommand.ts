import { CommandCategory } from "../../types/command-category.js";
import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../../core/CommandInterface.js";
import { WebSocketInfo } from "../../types/session.js";
import { SessionService } from "../../services/SessionService.js";
import { BotConfig } from "../../core/config.js";

export class YTSearchCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "ytsearch",
    aliases: ["yts"],
    description: "Cari video di YouTube dan tampilkan hasilnya.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}ytsearch <query> — Cari video di YouTube
• ${BotConfig.prefix}yts <query> — Alias untuk ytsearch
• ${BotConfig.prefix}ytsearch help — Tampilkan bantuan ini

*Contoh:*
• ${BotConfig.prefix}ytsearch Naykilla Kasih Aba Aba
`,
    category: CommandCategory.General,
    commandClass: YTSearchCommand,
    cooldown: 5000,
    maxUses: 10,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    // Jika tidak ada argumen atau help
    if (args.length === 0 || args[0].toLowerCase() === "help") {
      await sock.sendMessage(jid, {
        text: YTSearchCommand.commandInfo.helpText || "Bantuan tidak tersedia.",
      });
      return;
    }

    // Jika input berupa angka (atau angka + audio), artinya user ingin download dari hasil pencarian terakhir
    const nomor = parseInt(args[0], 10);
    if (!isNaN(nomor)) {
      // Cek session hasil pencarian
      const session = await sessionService.getSession<{ videos: any[] }>(
        jid,
        user
      );
      if (
        !session ||
        !session.data ||
        !session.data.videos ||
        session.data.videos.length < nomor ||
        nomor < 1
      ) {
        await sock.sendMessage(jid, {
          text: "Tidak ada hasil pencarian sebelumnya atau nomor tidak valid. Silakan cari dulu dengan ytsearch.",
        });
        return;
      }
      const video = session.data.videos[nomor - 1];
      if (!video) {
        await sock.sendMessage(jid, { text: "Nomor video tidak ditemukan." });
        return;
      }
      // Cek apakah user ingin audio saja
      const isAudio = args.length > 1 && args[1].toLowerCase() === "audio";
      await sock.sendMessage(jid, {
        text: `Mengunduh ${isAudio ? "audio" : "video"} dari: ${video.title}`,
      });
      try {
        const { YtDlpWrapper } = await import("../../utils/ytdlp.js");
        const ytdl = new YtDlpWrapper();
        const result = isAudio
          ? await ytdl.downloadAudio(video.url)
          : await ytdl.downloadVideo(video.url);
        const fileSizeMB = result.buffer.length / (1024 * 1024);
        if (fileSizeMB > 100) {
          await sock.sendMessage(jid, {
            text: `❌ File terlalu besar (${fileSizeMB.toFixed(
              1
            )}MB). Maksimal 100MB.`,
          });
          return;
        }
        if (isAudio) {
          await sock.sendMessage(jid, {
            audio: result.buffer,
            mimetype: "audio/mp4",
            fileName: result.filename,
          });
        } else {
          await sock.sendMessage(jid, {
            video: result.buffer,
            mimetype: "video/mp4",
            fileName: result.filename,
          });
        }
      } catch (error: any) {
        await sock.sendMessage(jid, {
          text: `Gagal mengunduh: ${error?.message || error}`,
        });
      }
      return;
    }

    // Jika bukan angka, lakukan pencarian seperti biasa
    const query = args.join(" ");
    try {
      const yts = (await import("yt-search")).default;
      const result = await yts(query);

      if (!result || !result.videos || result.videos.length === 0) {
        await sock.sendMessage(jid, {
          text: `Tidak ada hasil ditemukan untuk: ${query}`,
        });
        return;
      }

      const videos = result.videos
        .filter((v) => v.duration.seconds < 1800)
        .slice(0, 5);
      let text = `*Hasil Pencarian: ${query}*\n\n`;

      videos.forEach((video, index) => {
        text += `*${index + 1}.* ${video.title} oleh ${video.author.name}\n`;
        text += `URL: ${video.url}\n`;
        text += `Durasi: ${video.timestamp} | Views: ${video.views}\n\n`;
      });

      // Simpan hasil ke session agar bisa diakses user untuk download
      await sessionService.setSession(jid, user, "ytsearch", { videos });

      text += `Gunakan kembali perintah dengan nomor urutan (misal: 1 atau 2 audio) untuk download video/audio.`;

      await sock.sendMessage(jid, { text });
    } catch (error) {
      console.error("Error during YouTube search:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat mencari video di YouTube. Silakan coba lagi nanti.",
      });
    }
  }
}
