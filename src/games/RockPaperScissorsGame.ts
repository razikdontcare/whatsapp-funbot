import { CommandInterface } from "../core/CommandInterface.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "../core/config.js";
import { WebSocketInfo, Session } from "../core/types.js";

type InputRPSChoice =
  | "rock"
  | "paper"
  | "scissors"
  | "batu"
  | "gunting"
  | "kertas";
type NormalizedRPSChoice = "rock" | "paper" | "scissors";
type RPSMode = "ai" | "multiplayer";

interface RPSSession {
  mode: RPSMode;
  player1: string;
  player1Choice?: NormalizedRPSChoice;
  player2?: string;
  player2Choice?: NormalizedRPSChoice;
  groupJid?: string;
}

// Session link structure stored in player's DM session to find the group game
interface RPSLinkSession {
  groupJid: string;
}

// Key for the main multiplayer game session within a group's sessions map
const MULTIPLAYER_SESSION_KEY = "rps_multiplayer_game";
// Key for the link session stored in a player's DM session map (using user JID as key)
const LINK_SESSION_KEY = "rps";

export class RockPaperScissorsGame implements CommandInterface {
  private readonly choices: InputRPSChoice[] = [
    "rock",
    "paper",
    "scissors",
    "batu",
    "gunting",
    "kertas",
  ];
  private readonly winConditions: Record<
    NormalizedRPSChoice,
    NormalizedRPSChoice
  > = {
    rock: "scissors",
    paper: "rock",
    scissors: "paper",
  };
  private readonly translations: Record<string, NormalizedRPSChoice> = {
    batu: "rock",
    gunting: "scissors",
    kertas: "paper",
    rock: "rock",
    paper: "paper",
    scissors: "scissors",
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ): Promise<void> {
    try {
      const isGroup = jid.endsWith("@g.us");
      const subCommand = args[0]?.toLowerCase();

      if (args.length === 0 || subCommand === "help") {
        await this.showHelp(jid, sock);
        return;
      }

      if (subCommand === "start") {
        const mode = (args[1]?.toLowerCase() as RPSMode) || "ai";
        await this.startGame(mode, jid, user, sock, sessionService, isGroup);
      } else if (subCommand === "join") {
        if (!isGroup) {
          await sock.sendMessage(jid, {
            text: "Perintah join hanya dapat digunakan di dalam grup.",
          });
          return;
        }
        await this.joinMultiplayerGame(jid, user, sock, sessionService);
      } else if (this.choices.includes(subCommand as InputRPSChoice)) {
        const normalizedChoice = this.translations[subCommand];
        if (!normalizedChoice) {
          await sock.sendMessage(jid, {
            text: "Pilihan tidak valid. Gunakan rock/paper/scissors atau batu/gunting/kertas.",
          });
          return;
        }
        await this.handlePlayerMove(
          normalizedChoice,
          jid,
          user,
          sock,
          sessionService,
          isGroup
        );
      } else if (subCommand === "stop") {
        await this.handleStopGame(jid, user, sock, sessionService, isGroup);
      } else {
        await sock.sendMessage(jid, {
          text: `Perintah tidak valid. Ketik ${BotConfig.prefix}rps help untuk bantuan.`,
        });
      }
    } catch (error) {
      console.error("Error in RPS game:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi error dalam game RPS. Silakan coba lagi.",
      });
    }
  }

  private async showHelp(jid: string, sock: WebSocketInfo) {
    const helpText = `🎮 *Cara Main Rock Paper Scissors*:

*Vs AI*:
${BotConfig.prefix}rps start ai - Mulai vs AI (di grup atau DM)
${BotConfig.prefix}rps [pilihan] - Kirim pilihanmu

*Multiplayer (Hanya di Grup)*:
${BotConfig.prefix}rps start multiplayer - Mulai game di grup
${BotConfig.prefix}rps join - Untuk bergabung sebagai player 2
Pemain mengirim pilihan (${BotConfig.prefix}rps [pilihan]) lewat *DM* ke bot

*Panduan Multiplayer*:
1. Player 1 mulai game di grup: ${BotConfig.prefix}rps start multiplayer
2. Player 2 ketik di grup: ${BotConfig.prefix}rps join
3. Kedua pemain kirim pilihan lewat DM ke bot: ${BotConfig.prefix}rps [batu/gunting/kertas]
4. Hasil akan diumumkan di grup

*Umum*:
${BotConfig.prefix}rps stop - Hentikan game yang sedang kamu mainkan (AI atau Multiplayer jika kamu host)`;

    await sock.sendMessage(jid, { text: helpText });
  }

  private async startGame(
    mode: RPSMode,
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    isGroup: boolean
  ) {
    if (mode === "multiplayer") {
      if (!isGroup) {
        await sock.sendMessage(jid, {
          text: "Mode multiplayer hanya bisa dimulai di grup.",
        });
        return;
      }

      const existingGame = sessionService.getSession<RPSSession>(
        jid,
        MULTIPLAYER_SESSION_KEY
      );
      if (existingGame && existingGame.game === "rps") {
        await sock.sendMessage(jid, {
          text: `Sudah ada game RPS multiplayer berjalan di grup ini (dimulai oleh ${this.formatUserMention(
            existingGame.data.player1
          )}).`,
        });
        return;
      }

      const existingLink = sessionService.getSession<RPSLinkSession>(
        user,
        user
      );
      if (existingLink && existingLink.game === LINK_SESSION_KEY) {
        await sock.sendMessage(jid, {
          text: `Kamu (${this.formatUserMention(
            user
          )}) sudah tergabung dalam game multiplayer lain (di grup ${
            existingLink.data.groupJid
          }). Selesaikan atau hentikan dulu (${BotConfig.prefix}rps stop).`,
        });
        return;
      }

      const sessionData: RPSSession = {
        mode: "multiplayer",
        player1: user,
        groupJid: jid,
      };

      if (
        !sessionService.setSession(
          jid,
          MULTIPLAYER_SESSION_KEY,
          "rps",
          sessionData
        )
      ) {
        await sock.sendMessage(jid, {
          text: "Gagal memulai game multiplayer (batas sesi grup?).",
        });
        return;
      }

      if (
        !sessionService.setSession(user, user, LINK_SESSION_KEY, {
          groupJid: jid,
        })
      ) {
        await sock.sendMessage(jid, {
          text: `Gagal menyimpan link sesi untuk ${this.formatUserMention(
            user
          )}. Pastikan bot bisa DM.`,
        });
        sessionService.clearSession(jid, MULTIPLAYER_SESSION_KEY);
        return;
      }

      await sock.sendMessage(jid, {
        text: `🎮 Game Rock Paper Scissors Multiplayer dimulai oleh ${this.formatUserMention(
          user
        )}!\n\nPemain lain, kirim pilihanmu (batu/gunting/kertas) lewat *DM* ke bot: ${
          BotConfig.prefix
        }rps [pilihan]`,
        mentions: [user],
      });
    } else {
      const existingAiSession = sessionService.getSession<RPSSession>(
        jid,
        user
      );
      if (existingAiSession && existingAiSession.game === "rps") {
        await sock.sendMessage(jid, {
          text: "Kamu sudah dalam game RPS vs AI. Kirim pilihanmu atau !rps stop.",
        });
        return;
      }

      const sessionData: RPSSession = {
        mode: "ai",
        player1: user,
      };
      if (!sessionService.setSession(jid, user, "rps", sessionData)) {
        await sock.sendMessage(jid, {
          text: "Gagal memulai game vs AI. Mungkin ada sesi game lain yang aktif?",
        });
        return;
      }
      await sock.sendMessage(jid, {
        text: `Game vs AI dimulai! Pilih gerakan:\n${BotConfig.prefix}rps rock/batu\n${BotConfig.prefix}rps paper/kertas\n${BotConfig.prefix}rps scissors/gunting`,
      });
    }
  }

  private async handlePlayerMove(
    normalizedChoice: NormalizedRPSChoice,
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    isGroup: boolean
  ) {
    if (isGroup) {
      const aiSession = sessionService.getSession<RPSSession>(jid, user);
      if (
        aiSession &&
        aiSession.game === "rps" &&
        aiSession.data.mode === "ai"
      ) {
        await this.processAiMove(
          normalizedChoice,
          jid,
          user,
          sock,
          sessionService,
          aiSession
        );
      } else {
        const mpSession = sessionService.getSession<RPSSession>(
          jid,
          MULTIPLAYER_SESSION_KEY
        );
        if (
          mpSession &&
          mpSession.game === "rps" &&
          mpSession.data.mode === "multiplayer"
        ) {
          await sock.sendMessage(jid, {
            text: `Untuk game multiplayer, kirim pilihanmu (${BotConfig.prefix}rps [pilihan]) lewat *DM* ke bot.`,
          });
        } else {
          await sock.sendMessage(jid, {
            text: `Tidak ada game RPS aktif untukmu di sini. Mulai dengan ${BotConfig.prefix}rps start`,
          });
        }
      }
    } else {
      const aiSession = sessionService.getSession<RPSSession>(user, user);
      if (
        aiSession &&
        aiSession.game === "rps" &&
        aiSession.data.mode === "ai"
      ) {
        await this.processAiMove(
          normalizedChoice,
          user,
          user,
          sock,
          sessionService,
          aiSession
        );
        return;
      }

      // Check for a multiplayer link session (key: user, user)
      const linkSession = sessionService.getSession<RPSLinkSession>(user, user);
      if (linkSession && linkSession.game === LINK_SESSION_KEY) {
        const groupJid = linkSession.data.groupJid;
        await this.processMultiplayerMove(
          normalizedChoice,
          groupJid,
          user,
          sock,
          sessionService
        );
      } else {
        await sock.sendMessage(jid, {
          text: `Tidak ada game RPS aktif untukmu. Mulai game vs AI (${BotConfig.prefix}rps start ai) atau mulai game multiplayer dari grup.`,
        });
      }
    }
  }

  private async processAiMove(
    playerChoice: NormalizedRPSChoice,
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    session: Session<RPSSession>
  ) {
    if (user !== session.data.player1) {
      await sock.sendMessage(jid, { text: "Ini bukan game AI milikmu." });
      return;
    }

    const aiChoice = this.getAIChoice();
    const result = this.determineWinner(playerChoice, aiChoice);

    let resultText = `Kamu: ${this.choiceToEmoji(playerChoice)}\n`;
    resultText += `AI: ${this.choiceToEmoji(aiChoice)}\n\n`;
    resultText += this.getResultText(result);

    sessionService.clearSession(jid, user);
    await sock.sendMessage(jid, { text: resultText });
  }

  private async processMultiplayerMove(
    playerChoice: NormalizedRPSChoice,
    groupJid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const gameSession = sessionService.getSession<RPSSession>(
      groupJid,
      MULTIPLAYER_SESSION_KEY
    );

    if (
      !gameSession ||
      gameSession.game !== "rps" ||
      gameSession.data.mode !== "multiplayer"
    ) {
      await sock.sendMessage(user, {
        text: "Game multiplayer yang terhubung tidak ditemukan atau sudah berakhir.",
      });
      sessionService.clearSession(user, user);
      return;
    }

    const rpsSession = gameSession.data;

    if (user === rpsSession.player1) {
      if (rpsSession.player1Choice) {
        await sock.sendMessage(user, {
          text: "Kamu sudah memilih. Menunggu player 2...",
        });
        return;
      }
      rpsSession.player1Choice = playerChoice;
      await sock.sendMessage(user, {
        text: `Kamu (P1) memilih ${this.choiceToEmoji(
          playerChoice
        )}. Menunggu player 2...`,
      });
    } else if (!rpsSession.player2 || user === rpsSession.player2) {
      if (!rpsSession.player2) {
        const existingLink = sessionService.getSession<RPSLinkSession>(
          user,
          user
        );
        if (existingLink && existingLink.game === LINK_SESSION_KEY) {
          if (existingLink.data.groupJid !== groupJid) {
            await sock.sendMessage(user, {
              text: `Kamu sudah tergabung dalam game multiplayer lain (di grup ${existingLink.data.groupJid}). Selesaikan atau hentikan dulu (${BotConfig.prefix}rps stop).`,
            });
            return;
          }
        } else {
          if (
            !sessionService.setSession(user, user, LINK_SESSION_KEY, {
              groupJid: groupJid,
            })
          ) {
            console.error(
              `Failed to set link session for potential Player 2: ${user} in group ${groupJid}`
            );
            await sock.sendMessage(user, {
              text: "Gagal menyimpan link sesi untuk game ini. Coba lagi.",
            });
            return;
          }
        }

        rpsSession.player2 = user;
      }

      if (rpsSession.player2Choice) {
        await sock.sendMessage(user, {
          text: "Kamu sudah memilih. Menunggu player 1...",
        });
        return;
      }

      rpsSession.player2Choice = playerChoice;
      await sock.sendMessage(user, {
        text: `Kamu (P2) memilih ${this.choiceToEmoji(
          playerChoice
        )}. Menunggu player 1...`,
      });
    } else {
      await sock.sendMessage(user, {
        text: "Game ini sudah penuh (2 pemain).",
      });
      return;
    }

    if (
      !sessionService.setSession(
        groupJid,
        MULTIPLAYER_SESSION_KEY,
        "rps",
        rpsSession
      )
    ) {
      console.error(`Failed to update main game session for group ${groupJid}`);
      await sock.sendMessage(user, {
        text: "Terjadi masalah saat menyimpan pilihanmu. Coba lagi.",
      });
      return;
    }

    if (
      rpsSession.player1Choice &&
      rpsSession.player2 &&
      rpsSession.player2Choice
    ) {
      await this.announceMultiplayerResult(rpsSession, sock, sessionService);
    }
  }

  private async announceMultiplayerResult(
    session: RPSSession,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    if (
      !session.groupJid ||
      !session.player1Choice ||
      !session.player2Choice ||
      !session.player1 ||
      !session.player2
    ) {
      console.error(
        "Incomplete session data for announcing multiplayer result:",
        session
      );
      if (session.groupJid)
        sessionService.clearSession(session.groupJid, MULTIPLAYER_SESSION_KEY);
      if (session.player1)
        sessionService.clearSession(session.player1, session.player1);
      if (session.player2)
        sessionService.clearSession(session.player2, session.player2);
      return;
    }

    const result = this.determineWinner(
      session.player1Choice,
      session.player2Choice
    );

    let resultText = `🎮 *Hasil Rock Paper Scissors di Grup Ini*:\n\n`;
    resultText += `${this.formatUserMention(
      session.player1
    )} (P1): ${this.choiceToEmoji(session.player1Choice)}\n`;
    resultText += `${this.formatUserMention(
      session.player2
    )} (P2): ${this.choiceToEmoji(session.player2Choice)}\n\n`;
    resultText += this.getResultText(result, session.player1, session.player2);

    await sock.sendMessage(session.groupJid, {
      text: resultText,
      mentions: [session.player1, session.player2],
    });

    sessionService.clearSession(session.groupJid, MULTIPLAYER_SESSION_KEY);
    sessionService.clearSession(session.player1, session.player1);
    sessionService.clearSession(session.player2, session.player2);
  }

  private async handleStopGame(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    isGroup: boolean
  ) {
    const aiSessionKey = isGroup ? jid : user;
    const aiSession = sessionService.getSession<RPSSession>(aiSessionKey, user);
    if (aiSession && aiSession.game === "rps" && aiSession.data.mode === "ai") {
      sessionService.clearSession(aiSessionKey, user);
      await sock.sendMessage(jid, { text: "Game RPS vs AI dihentikan." });
      return;
    }

    let groupJid: string | undefined;
    let gameSession: Session<RPSSession> | null = null;

    const linkSession = sessionService.getSession<RPSLinkSession>(user, user);
    if (linkSession && linkSession.game === LINK_SESSION_KEY) {
      groupJid = linkSession.data.groupJid;
      if (groupJid) {
        gameSession = sessionService.getSession<RPSSession>(
          groupJid,
          MULTIPLAYER_SESSION_KEY
        );
      }
    } else if (isGroup) {
      gameSession = sessionService.getSession<RPSSession>(
        jid,
        MULTIPLAYER_SESSION_KEY
      );
      if (
        gameSession &&
        gameSession.game === "rps" &&
        gameSession.data.mode === "multiplayer"
      ) {
        groupJid = jid;
      }
    }

    if (
      gameSession &&
      gameSession.game === "rps" &&
      gameSession.data.mode === "multiplayer" &&
      groupJid
    ) {
      const rpsSession = gameSession.data;
      if (user === rpsSession.player1) {
        const player1 = rpsSession.player1;
        const player2 = rpsSession.player2;

        sessionService.clearSession(groupJid, MULTIPLAYER_SESSION_KEY);
        sessionService.clearSession(player1, player1);
        if (player2) {
          sessionService.clearSession(player2, player2);
        }

        await sock.sendMessage(groupJid, {
          text: `🛑 Game RPS Multiplayer dihentikan oleh host (${this.formatUserMention(
            player1
          )}).`,
          mentions: [player1],
        });
        if (!isGroup) {
          await sock.sendMessage(user, {
            text: "Game multiplayer berhasil dihentikan.",
          });
        }
      } else {
        await sock.sendMessage(jid, {
          text: `Hanya host (${this.formatUserMention(
            rpsSession.player1
          )}) yang dapat menghentikan game multiplayer ini.`,
        });
      }
      return;
    }

    await sock.sendMessage(jid, {
      text: "Tidak ada game RPS yang aktif untuk dihentikan.",
    });
  }

  private getAIChoice(): NormalizedRPSChoice {
    const englishChoices: NormalizedRPSChoice[] = ["rock", "paper", "scissors"];
    const randomIndex = Math.floor(Math.random() * englishChoices.length);
    return englishChoices[randomIndex];
  }

  private determineWinner(
    choice1: NormalizedRPSChoice,
    choice2: NormalizedRPSChoice
  ): "win" | "lose" | "draw" {
    if (choice1 === choice2) return "draw";
    return this.winConditions[choice1] === choice2 ? "win" : "lose";
  }

  private getResultText(
    result: "win" | "lose" | "draw",
    player1?: string,
    player2?: string
  ): string {
    switch (result) {
      case "win":
        return player1 && player2
          ? `🏆 Pemenang: ${this.formatUserMention(player1)} (P1)!`
          : `🎉 Kamu menang!`;
      case "lose":
        return player1 && player2
          ? `🏆 Pemenang: ${this.formatUserMention(player2)} (P2)!`
          : `😢 Kamu kalah!`;
      case "draw":
        return `🤝 Seri!`;
    }
  }

  private choiceToEmoji(choice: NormalizedRPSChoice): string {
    const emojis: Record<NormalizedRPSChoice, string> = {
      rock: "✊ Batu",
      paper: "✋ Kertas",
      scissors: "✌️ Gunting",
    };
    const validChoice = choice in emojis ? choice : "rock";
    return emojis[validChoice];
  }

  private formatUserMention(jid: string): string {
    if (!jid || !jid.includes("@")) {
      return jid;
    }
    return `@${jid.split("@")[0]}`;
  }

  private async joinMultiplayerGame(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const mpSession = sessionService.getSession<RPSSession>(
      jid,
      MULTIPLAYER_SESSION_KEY
    );

    if (
      !mpSession ||
      mpSession.game !== "rps" ||
      mpSession.data.mode !== "multiplayer"
    ) {
      await sock.sendMessage(jid, {
        text: `Tidak ada game RPS multiplayer aktif di grup ini. Mulai dengan ${BotConfig.prefix}rps start multiplayer`,
      });
      return;
    }

    const rpsSession = mpSession.data;

    if (user === rpsSession.player1) {
      await sock.sendMessage(jid, {
        text: `Kamu adalah player 1 (host) dalam game ini. Tidak bisa menjadi player 2 juga.`,
      });
      return;
    }

    if (rpsSession.player2 && rpsSession.player2 !== user) {
      await sock.sendMessage(jid, {
        text: `Game ini sudah memiliki player 2 (${this.formatUserMention(
          rpsSession.player2
        )}). Tunggu game ini selesai atau mulai game baru.`,
        mentions: [rpsSession.player2],
      });
      return;
    }

    const existingLink = sessionService.getSession<RPSLinkSession>(user, user);
    if (existingLink && existingLink.game === LINK_SESSION_KEY) {
      if (existingLink.data.groupJid !== jid) {
        await sock.sendMessage(jid, {
          text: `Kamu sudah tergabung dalam game multiplayer lain (di grup ${existingLink.data.groupJid}). Selesaikan atau hentikan dulu (${BotConfig.prefix}rps stop).`,
        });
        return;
      }
      await sock.sendMessage(jid, {
        text: `Kamu sudah tergabung sebagai player 2 dalam game ini. Kirim pilihanmu lewat DM ke bot.`,
      });
      return;
    }

    if (
      !sessionService.setSession(user, user, LINK_SESSION_KEY, {
        groupJid: jid,
      })
    ) {
      await sock.sendMessage(jid, {
        text: `Gagal menyimpan link sesi untuk ${this.formatUserMention(
          user
        )}. Pastikan bot bisa DM.`,
        mentions: [user],
      });
      return;
    }

    rpsSession.player2 = user;

    if (
      !sessionService.setSession(
        jid,
        MULTIPLAYER_SESSION_KEY,
        "rps",
        rpsSession
      )
    ) {
      await sock.sendMessage(jid, {
        text: `Gagal memperbarui sesi game. Coba lagi.`,
      });
      sessionService.clearSession(user, user);
      return;
    }

    await sock.sendMessage(jid, {
      text: `🎮 ${this.formatUserMention(
        user
      )} berhasil bergabung sebagai player 2!\n\nKedua pemain, kirim pilihan kalian (batu/gunting/kertas) lewat *DM* ke bot: ${
        BotConfig.prefix
      }rps [pilihan]`,
      mentions: [user, rpsSession.player1],
    });
  }
}
