import { BotConfig } from "../core/config.js";
import { SessionService } from "../services/SessionService.js";
import { GameInterface } from "./GameInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { getRandomKBBI } from "../utils/randomKBBI.js";

const MAX_ATTEMPTS = 6;
const MASK_CHAR = "#";

interface HangmanSession {
  word: string;
  hint: string;
  guessedLetters: string[];
  attemptsLeft: number;
  maskedWord: string;
}

export class HangmanGame implements GameInterface {
  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ): Promise<void> {
    const session = sessionService.getSession<HangmanSession>(jid, user);

    if ((!session && args.length === 0) || args[0] === "start") {
      await this.startNewGame(jid, user, sock, sessionService);
    } else if (session && args.length === 0) {
      await sock.sendMessage(jid, {
        text: `Kamu sudah memulai permainan lain. Gunakan ${BotConfig.prefix}hangman stop untuk menghentikannya.`,
      });
    } else if (args[0] === "stop") {
      sessionService.clearSession(jid, user);
      await sock.sendMessage(jid, {
        text: `Game hangman telah dihentikan.`,
      });
    } else if (session && session.game === "hangman") {
      await this.processGameMove(
        args[0],
        jid,
        user,
        sock,
        sessionService,
        session.data
      );
    } else {
      await sock.sendMessage(jid, {
        text: `Perintah tidak dikenali. Gunakan ${BotConfig.prefix}hangman start untuk memulai permainan.`,
      });
    }
  }

  private async startNewGame(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService
  ) {
    const { lemma: word, definition } = await getRandomKBBI();
    const newSession: HangmanSession = {
      word,
      hint: definition,
      guessedLetters: [],
      attemptsLeft: MAX_ATTEMPTS,
      maskedWord: MASK_CHAR.repeat(word.length),
    };

    sessionService.setSession(jid, user, "hangman", newSession);

    await sock.sendMessage(jid, {
      text: `🎮 Game Hangman dimulai!\n\nKata (${
        newSession.word.length
      } kata): ${newSession.maskedWord}\nKesempatan: ${"❤️".repeat(
        MAX_ATTEMPTS
      )}\nHint: ${definition}\n\nTebak huruf dengan: ${
        BotConfig.prefix
      }hangman [huruf]`,
    });
  }

  private async processGameMove(
    guess: string,
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    sessionData: HangmanSession
  ) {
    if (!guess || guess.length !== 1) {
      await sock.sendMessage(jid, {
        text: `Tebakan tidak valid. Harap masukkan satu huruf.`,
      });
      return;
    }

    const letter = guess.toLowerCase();

    if (sessionData.guessedLetters.includes(letter)) {
      await sock.sendMessage(jid, {
        text: `Kamu sudah menebak huruf "${letter}" sebelumnya.`,
      });
      return;
    }

    sessionData.guessedLetters.push(letter);

    if (sessionData.word.includes(letter)) {
      await this.handleCorrectGuess(
        jid,
        user,
        sock,
        sessionService,
        sessionData
      );
    } else {
      await this.handleWrongGuess(jid, user, sock, sessionService, sessionData);
    }

    sessionService.setSession(jid, user, "hangman", sessionData);
  }

  private async handleCorrectGuess(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    sessionData: HangmanSession
  ) {
    let newMasked = "";
    for (let i = 0; i < sessionData.word.length; i++) {
      newMasked += sessionData.guessedLetters.includes(sessionData.word[i])
        ? sessionData.word[i]
        : MASK_CHAR;
    }
    sessionData.maskedWord = newMasked;

    if (!newMasked.includes(MASK_CHAR)) {
      await sock.sendMessage(jid, {
        text: `🎉 Selamat! Kamu menang!\nKata yang benar: ${sessionData.word}`,
      });
      sessionService.clearSession(jid, user);
      return;
    }

    await this.updateGameStatus(jid, user, sock, sessionService, sessionData);
  }

  private async handleWrongGuess(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    sessionData: HangmanSession
  ) {
    sessionData.attemptsLeft--;

    if (sessionData.attemptsLeft <= 0) {
      await sock.sendMessage(jid, {
        text: `😢 Game over! Kamu kalah.\nKata yang benar: ${sessionData.word}`,
      });
      sessionService.clearSession(jid, user);
      return;
    }

    await this.updateGameStatus(jid, user, sock, sessionService, sessionData);
  }

  private async updateGameStatus(
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    sessionData: HangmanSession
  ) {
    sessionService.setSession(jid, user, "hangman", sessionData);

    await sock.sendMessage(jid, {
      text: [
        `Kata: ${sessionData.maskedWord}`,
        `Kesempatan tersisa: ${sessionData.attemptsLeft}`,
        `Huruf yang sudah ditebak: ${sessionData.guessedLetters.join(", ")}`,
        `Hint: ${sessionData.hint}`,
        `\nTebak huruf berikutnya dengan: ${BotConfig.prefix}hangman [huruf]`,
      ].join("\n"),
    });
  }
}
