import { CommandCategory } from "../../types/command-category.js";
import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../../core/CommandInterface.js";
import { BotConfig } from "../../core/config.js";
import { WebSocketInfo } from "../../types/session.js";
import { SessionService } from "../../services/SessionService.js";
import axios, { AxiosResponse } from "axios";

type LyricsResponse = {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
};

export class LyricsFindCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "lyrics",
    aliases: ["findlyrics", "lyric", "lirik"],
    description: "Cari lirik lagu.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}lyrics <judul lagu> — Cari lirik lagu berdasarkan judul
    
*Contoh:*
• ${BotConfig.prefix}lyrics Cinta Luar Biasa`,
    category: CommandCategory.General,
    commandClass: LyricsFindCommand,
    cooldown: 10000,
    maxUses: 5,
  };

  private baseUrl = "https://lrclib.net/api";
  private client = axios.create({
    baseURL: this.baseUrl,
    family: 4, // Use IPv4
    timeout: 5000, // Set a timeout of 5 seconds
  });

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    // 1. Handle help subcommand first
    if (args.length > 0 && args[0] === "help") {
      await sock.sendMessage(jid, {
        text: `Penggunaan: ${LyricsFindCommand.commandInfo.helpText}`,
      });
      return;
    }

    // 2. Join the rest of the args to form the query
    let query = args.join(" ").trim();
    if (!query) {
      await sock.sendMessage(jid, {
        text: "Mohon berikan judul lagu yang ingin dicari liriknya.",
      });
      return;
    }

    // 3. Fetch lyrics using the findLyrics method
    const lyricsResponse = await this.findLyrics(query);
    if (lyricsResponse) {
      const responseText = `Lirik untuk "${lyricsResponse.trackName}" oleh ${lyricsResponse.artistName}:\n\n${lyricsResponse.plainLyrics}`;
      await sock.sendMessage(jid, { text: responseText });
    } else {
      await sock.sendMessage(jid, {
        text: "Lirik tidak ditemukan.",
      });
    }
  }

  async findLyrics(query: string): Promise<LyricsResponse | null> {
    try {
      const response = (await this.client.get("/search", {
        params: { q: query },
      })) as AxiosResponse<LyricsResponse[]>;
      if (response.data && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error("Error fetching lyrics:", error);
      return null;
    }
  }
}
