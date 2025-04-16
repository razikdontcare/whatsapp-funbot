import { BotConfig, log } from "../core/config.js";
import { SessionService } from "../services/SessionService.js";
import { CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { getRandomKBBI } from "../utils/randomKBBI.js";
import { randomBytes } from "crypto";
import { proto } from "baileys";

const MAX_ATTEMPTS = 6;
const MASK_CHAR = "#";

interface HangmanSession {
  gameId: string;
  word: string;
  hint: string;
  guessedLetters: string[];
  attemptsLeft: number;
  maskedWord: string;
  players: string[];
  playerScores: Record<string, number>;
  hostUser: string;
}

// Key: gameId, Value: HangmanSession
const activeHangmanGames: Map<string, HangmanSession> = new Map();

function generateGameId(): string {
  return randomBytes(3).toString("hex");
}

export class HangmanGame implements CommandInterface {
  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const command = args[0]?.toLowerCase();
    const userSessionLink = sessionService.getSession<{ gameId: string }>(
      jid,
      user
    );

    // --- Command Routing ---

    if (command === "start") {
      // Check if user is already in another game type via SessionService
      if (userSessionLink && userSessionLink.game !== "hangman") {
        await sock.sendMessage(jid, {
          text: `Kamu sedang dalam game ${userSessionLink.game}. Gunakan ${BotConfig.prefix}stop untuk mengakhirinya.`,
        });
        return;
      }
      // User can start a new game even if already in another hangman game
      await this.startNewGame(jid, user, sock, sessionService);
    } else if (command === "join" && args[1]) {
      const gameIdToJoin = args[1];
      // Check if user is already in another game type via SessionService
      if (userSessionLink && userSessionLink.game !== "hangman") {
        await sock.sendMessage(jid, {
          text: `Kamu sedang dalam game ${userSessionLink.game}. Gunakan ${BotConfig.prefix}stop untuk mengakhirinya.`,
        });
        return;
      }
      // Check if user is already in a hangman game (they need to leave first)
      if (userSessionLink && userSessionLink.game === "hangman") {
        await sock.sendMessage(jid, {
          text: `Kamu sudah dalam game Hangman (${userSessionLink.data.gameId}). Gunakan ${BotConfig.prefix}hangman leave ${userSessionLink.data.gameId} untuk keluar.`,
        });
        return;
      }
      await this.joinGame(jid, user, gameIdToJoin, sock, sessionService);
    } else if (command === "stop" && args[1]) {
      const gameIdToStop = args[1];
      await this.stopGame(jid, user, gameIdToStop, sock, sessionService);
    } else if (command === "leave" && args[1]) {
      const gameIdToLeave = args[1];
      await this.leaveGame(jid, user, gameIdToLeave, sock, sessionService);
    } else if (command === "guess" && args[1] && args[2]) {
      // Explicit guess: !hangman guess <gameId> <letter>
      const gameIdToGuess = args[1];
      const letter = args[2];
      await this.processGameMove(
        letter,
        jid,
        user,
        gameIdToGuess,
        sock,
        sessionService
      );
    } else if (args.length === 1 && args[0].length === 1) {
      // Implicit guess: !hangman <letter>
      const letter = args[0];
      if (!userSessionLink || userSessionLink.game !== "hangman") {
        await sock.sendMessage(jid, {
          text: `Kamu tidak sedang dalam game Hangman. Gunakan ${BotConfig.prefix}hangman start atau ${BotConfig.prefix}hangman join <id>.`,
        });
        return;
      }
      const gameIdToGuess = userSessionLink.data.gameId;
      await this.processGameMove(
        letter,
        jid,
        user,
        gameIdToGuess,
        sock,
        sessionService
      );
    } else if (command === "status" && args[1]) {
      const gameIdToShow = args[1];
      await this.showStatus(jid, gameIdToShow, sock);
    } else if (
      userSessionLink &&
      userSessionLink.game === "hangman" &&
      !command
    ) {
      // User typed just "!hangman" while in a game
      await this.showStatus(jid, userSessionLink.data.gameId, sock);
    } else {
      // Default help/unknown command message
      await sock.sendMessage(jid, {
        text: `Perintah Hangman tidak dikenali.\n\nGunakan:\n• ${BotConfig.prefix}hangman start\n• ${BotConfig.prefix}hangman join <id>\n• ${BotConfig.prefix}hangman guess <id> [huruf]\n• ${BotConfig.prefix}hangman [huruf] (jika hanya join 1 game)\n• ${BotConfig.prefix}hangman leave <id>\n• ${BotConfig.prefix}hangman stop <id> (host only)\n• ${BotConfig.prefix}hangman status <id>`,
      });
    }
  }

  // --- Game Logic Methods ---

  private async startNewGame(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    let gameId = generateGameId();
    // Ensure ID is unique
    while (activeHangmanGames.has(gameId)) {
      gameId = generateGameId();
    }

    const { lemma: word, definition } = await getRandomKBBI();
    const newSessionData: HangmanSession = {
      gameId,
      word,
      hint: definition,
      guessedLetters: [],
      attemptsLeft: MAX_ATTEMPTS,
      maskedWord: MASK_CHAR.repeat(word.length),
      players: [user],
      playerScores: { [user]: 0 },
      hostUser: user,
    };

    // Store the master game state
    activeHangmanGames.set(gameId, newSessionData);

    // Link the user to this gameId in SessionService
    sessionService.setSession(jid, user, "hangman", { gameId });

    await sock.sendMessage(jid, {
      text: `🎮 Game Hangman Multiplayer Dimulai! (ID: *${gameId}*)\n\nKata (${
        newSessionData.word.length
      } huruf): ${newSessionData.maskedWord}\nKesempatan: ${"❤️".repeat(
        MAX_ATTEMPTS
      )}\nHint: ${definition}\n\nPemain: ${this.formatPlayerList(
        newSessionData
      )}\n\nTebak huruf dengan: ${
        BotConfig.prefix
      }hangman [huruf]\nBergabung dengan: ${
        BotConfig.prefix
      }hangman join ${gameId}`,
      mentions: [user],
    });
  }

  private async joinGame(
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const gameData = activeHangmanGames.get(gameId);

    if (!gameData) {
      await sock.sendMessage(jid, {
        text: `Game Hangman dengan ID *${gameId}* tidak ditemukan atau sudah berakhir.`,
      });
      return;
    }

    if (gameData.players.includes(user)) {
      await sock.sendMessage(jid, {
        text: `Kamu sudah bergabung dalam game Hangman *${gameId}*.`,
      });

      sessionService.setSession(jid, user, "hangman", { gameId });
      return;
    }

    gameData.players.push(user);
    gameData.playerScores[user] = 0;

    activeHangmanGames.set(gameId, gameData);

    // Link the user to this gameId in SessionService
    sessionService.setSession(jid, user, "hangman", { gameId });

    // Prepare mentions for the joining user and all current players
    const mentions = [user, ...gameData.players];

    await sock.sendMessage(jid, {
      text: `👋 ${this.formatUserMention(
        user
      )} bergabung ke game Hangman *${gameId}*!\n\nPemain:\n${this.formatPlayerList(
        gameData
      )}`,
      mentions: mentions,
    });

    await this.updateGameStatus(jid, gameId, sock);
  }

  private async leaveGame(
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const gameData = activeHangmanGames.get(gameId);
    const userSessionLink = sessionService.getSession<{ gameId: string }>(
      jid,
      user
    );

    // Check if user is actually in this specific game via session link
    if (
      !userSessionLink ||
      userSessionLink.game !== "hangman" ||
      userSessionLink.data.gameId !== gameId
    ) {
      await sock.sendMessage(jid, {
        text: `Kamu tidak sedang dalam game Hangman dengan ID *${gameId}*.`,
      });
      return;
    }

    if (!gameData) {
      await sock.sendMessage(jid, {
        text: `Game Hangman *${gameId}* sepertinya sudah berakhir.`,
      });
      sessionService.clearSession(jid, user);
      return;
    }

    const leavingUserMention = this.formatUserMention(user);
    const leavingUserJid = user;

    gameData.players = gameData.players.filter((p) => p !== user);
    delete gameData.playerScores[user];

    sessionService.clearSession(jid, user);

    await sock.sendMessage(jid, {
      text: `👋 ${leavingUserMention} meninggalkan game Hangman *${gameId}*.`,
      mentions: [leavingUserJid],
    });

    if (gameData.players.length === 0) {
      // If no players left, end the game
      activeHangmanGames.delete(gameId);
      await sock.sendMessage(jid, {
        text: `Game Hangman *${gameId}* berakhir karena semua pemain telah keluar.`,
      });
    } else {
      let hostChangeMentions: string[] = [];
      if (gameData.hostUser === user) {
        const oldHostJid = user;
        gameData.hostUser = gameData.players[0];
        const newHostJid = gameData.hostUser;
        hostChangeMentions = [oldHostJid, newHostJid];
        await sock.sendMessage(jid, {
          text: `Host ${this.formatUserMention(
            oldHostJid
          )} keluar. Host baru adalah ${this.formatUserMention(newHostJid)}.`,
          mentions: hostChangeMentions,
        });
      }

      activeHangmanGames.set(gameId, gameData);
      await this.updateGameStatus(jid, gameId, sock);
    }
  }

  private async stopGame(
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const gameData = activeHangmanGames.get(gameId);

    if (!gameData) {
      await sock.sendMessage(jid, {
        text: `Game Hangman *${gameId}* tidak ditemukan atau sudah berakhir.`,
      });
      return;
    }

    if (gameData.hostUser !== user) {
      await sock.sendMessage(jid, {
        text: `Hanya host (${gameData.hostUser}) yang dapat menghentikan game *${gameId}*. Gunakan 'leave' untuk keluar.`,
      });
      return;
    }

    const finalWord = gameData.word;
    const playersToClear = [...gameData.players];
    const hostJid = user;

    this.endGameCleanup(jid, gameId, playersToClear, sessionService);

    await sock.sendMessage(jid, {
      text: `🛑 Game Hangman *${gameId}* telah dihentikan oleh host (${this.formatUserMention(
        hostJid
      )}).\nKata yang benar: ${finalWord}`,
      mentions: [hostJid],
    });
  }

  private async processGameMove(
    guess: string,
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const gameData = activeHangmanGames.get(gameId);
    const userSessionLink = sessionService.getSession<{ gameId: string }>(
      jid,
      user
    );

    if (!gameData) {
      await sock.sendMessage(jid, {
        text: `Game Hangman *${gameId}* tidak ditemukan atau sudah berakhir.`,
      });
      if (userSessionLink?.data.gameId === gameId)
        sessionService.clearSession(jid, user);
      return;
    }

    if (!gameData.players.includes(user)) {
      await sock.sendMessage(jid, {
        text: `Kamu bukan bagian dari game Hangman *${gameId}*. Gunakan ${BotConfig.prefix}hangman join ${gameId}`,
      });
      return;
    }

    if (!userSessionLink || userSessionLink.data.gameId !== gameId) {
      sessionService.setSession(jid, user, "hangman", { gameId });
    }

    if (!guess || guess.length !== 1 || !/^[a-zA-Z]$/.test(guess)) {
      await sock.sendMessage(jid, {
        text: `Tebakan tidak valid (${guess}). Harap masukkan satu huruf (A-Z) untuk game *${gameId}*.`,
      });
      return;
    }

    const letter = guess.toLowerCase();

    if (gameData.guessedLetters.includes(letter)) {
      await sock.sendMessage(jid, {
        text: `Huruf "${letter}" sudah ditebak sebelumnya di game *${gameId}*.`,
      });
      return;
    }

    gameData.guessedLetters.push(letter);

    if (gameData.word.includes(letter)) {
      await this.handleCorrectGuess(
        jid,
        user,
        gameId,
        sock,
        gameData,
        sessionService
      );
    } else {
      await this.handleWrongGuess(
        jid,
        user,
        gameId,
        sock,
        gameData,
        sessionService
      );
    }

    // Update the master game state (important!)
    if (activeHangmanGames.has(gameId)) {
      activeHangmanGames.set(gameId, gameData);
    }
  }

  private async handleCorrectGuess(
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    gameData: HangmanSession,
    sessionService: SessionService
  ) {
    let newMasked = "";
    let correctCount = 0;
    const currentGuess =
      gameData.guessedLetters[gameData.guessedLetters.length - 1];
    const guesserJid = user;

    for (let i = 0; i < gameData.word.length; i++) {
      const char = gameData.word[i];
      if (
        char === currentGuess &&
        !gameData.maskedWord[i].includes(MASK_CHAR)
      ) {
        // Already revealed, don't count points again
      } else if (char === currentGuess) {
        correctCount++;
      }

      newMasked += gameData.guessedLetters.includes(char) ? char : MASK_CHAR;
    }

    gameData.playerScores[user] =
      (gameData.playerScores[user] || 0) + correctCount;
    gameData.maskedWord = newMasked;

    if (!newMasked.includes(MASK_CHAR)) {
      const playersByScore = Object.entries(gameData.playerScores).sort(
        (a, b) => b[1] - a[1]
      );
      const winnerJid = playersByScore[0][0];
      const scoreBoardText = this.formatScoreboard(gameData);
      const allPlayerJids = gameData.players;

      await sock.sendMessage(jid, {
        text: `🎉 Game *${gameId}* Selesai! Kata "${
          gameData.word
        }" berhasil ditebak oleh ${this.formatUserMention(
          guesserJid
        )}!\n\n📊 SKOR AKHIR:\n${scoreBoardText}\n\n🏆 Pemenang: ${this.formatUserMention(
          winnerJid
        )} dengan ${playersByScore[0][1]} poin!`,
        mentions: [guesserJid, winnerJid, ...allPlayerJids],
      });

      this.endGameCleanup(jid, gameId, gameData.players, sessionService);
      return;
    }

    await sock.sendMessage(jid, {
      text: `✅ ${this.formatUserMention(
        guesserJid
      )} menebak huruf "${currentGuess}" dengan benar di game *${gameId}*! (+${correctCount} poin)`,
      mentions: [guesserJid],
    });

    await this.updateGameStatus(jid, gameId, sock);
  }

  private async handleWrongGuess(
    jid: string,
    user: string,
    gameId: string,
    sock: WebSocketInfo,
    gameData: HangmanSession,
    sessionService: SessionService
  ) {
    gameData.attemptsLeft--;
    const currentGuess =
      gameData.guessedLetters[gameData.guessedLetters.length - 1];
    const guesserJid = user;

    if (gameData.attemptsLeft <= 0) {
      const scoreBoardText = this.formatScoreboard(gameData);
      const allPlayerJids = gameData.players;

      await sock.sendMessage(jid, {
        text: `😢 Game Over untuk game *${gameId}*! Kalian kehabisan kesempatan.\nKata yang benar: ${gameData.word}\n\n📊 SKOR AKHIR:\n${scoreBoardText}`,
        mentions: allPlayerJids,
      });

      this.endGameCleanup(jid, gameId, gameData.players, sessionService);
      return;
    }

    await sock.sendMessage(jid, {
      text: `❌ ${this.formatUserMention(
        guesserJid
      )} menebak huruf "${currentGuess}" (salah) di game *${gameId}*. Kesempatan tersisa: ${
        gameData.attemptsLeft
      }`,
      mentions: [guesserJid],
    });

    await this.updateGameStatus(jid, gameId, sock);
  }

  private async showStatus(jid: string, gameId: string, sock: WebSocketInfo) {
    const gameData = activeHangmanGames.get(gameId);
    if (!gameData) {
      await sock.sendMessage(jid, {
        text: `Tidak ada game Hangman aktif dengan ID *${gameId}*.`,
      });
      return;
    }
    await this.updateGameStatus(jid, gameId, sock);
  }

  private async updateGameStatus(
    jid: string,
    gameId: string,
    sock: WebSocketInfo
  ) {
    const gameData = activeHangmanGames.get(gameId);
    if (!gameData) {
      log.warn(`Attempted to update status for non-existent game: ${gameId}`);
      return;
    }

    const mentions = [gameData.hostUser, ...gameData.players];
    // Remove duplicates just in case host is also in players list
    const uniqueMentions = Array.from(new Set(mentions));

    await sock.sendMessage(jid, {
      text: [
        `🎮 HANGMAN MULTIPLAYER (ID: *${gameId}*)`,
        `\nKata: ${gameData.maskedWord}`,
        `Kesempatan tersisa: ${"❤️".repeat(gameData.attemptsLeft)} (${
          gameData.attemptsLeft
        })`,
        `Huruf ditebak: ${gameData.guessedLetters.join(", ")}`,
        `Hint: ${gameData.hint}`,
        `\n👥 PEMAIN & SKOR:`,
        this.formatScoreboard(gameData),
        `Host: ${this.formatUserMention(gameData.hostUser)}`,
        `\nTebak: ${BotConfig.prefix}hangman [huruf] atau ${BotConfig.prefix}hangman guess ${gameId} [huruf]`,
      ].join("\n"),
      mentions: uniqueMentions,
    });
  }

  private formatUserMention(jid: string): string {
    if (!jid || !jid.includes("@")) {
      return jid;
    }
    return `@${jid.split("@")[0]}`;
  }

  private formatPlayerList(gameData: HangmanSession): string {
    return gameData.players
      .map((player) => `👤 ${this.formatUserMention(player)}`)
      .join("\n");
  }

  private formatScoreboard(gameData: HangmanSession): string {
    if (Object.keys(gameData.playerScores).length === 0)
      return "_Belum ada skor_";
    return Object.entries(gameData.playerScores)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([player, score]) =>
          `• ${this.formatUserMention(player)}: ${score} poin`
      )
      .join("\n");
  }

  private endGameCleanup(
    jid: string,
    gameId: string,
    players: string[],
    sessionService: SessionService
  ): void {
    log.info(`Cleaning up Hangman game ${gameId} in chat ${jid}...`);

    const deleted = activeHangmanGames.delete(gameId);
    if (deleted) {
      log.info(`Removed game state for ${gameId}.`);
    } else {
      log.warn(
        `Attempted to cleanup game ${gameId}, but it was not found in activeHangmanGames.`
      );
    }

    for (const player of players) {
      try {
        const playerSession = sessionService.getSession<{ gameId: string }>(
          jid,
          player
        );

        // Important Check: Only clear if the session link belongs to the game being cleaned up
        if (
          playerSession &&
          playerSession.game === "hangman" &&
          playerSession.data.gameId === gameId
        ) {
          sessionService.clearSession(jid, player);
          log.info(
            `Cleared session link for player ${player} for game ${gameId}.`
          );
        } else if (playerSession) {
          log.info(
            `Player ${player} has a session link, but not for the ended game ${gameId} (link: ${playerSession.game}/${playerSession.data?.gameId}). Skipping cleanup for this player.`
          );
        } else {
          log.info(
            `Player ${player} had no active session link found. Skipping cleanup for this player.`
          );
        }
      } catch (error) {
        log.error(
          `Error cleaning up session link for player ${player} in game ${gameId}:`,
          error
        );
      }
    }
    log.info(`Cleanup finished for game ${gameId}.`);
  }
}
