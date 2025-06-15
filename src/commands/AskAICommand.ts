import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "../core/config.js";
import { AIConversationService } from "../services/AIConversationService.js";
import Groq from "groq-sdk";

export class AskAICommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "ai",
    aliases: ["ask"],
    description:
      "Tanyakan sesuatu kepada AI dengan dukungan percakapan multi-turn.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}ai <pertanyaan> — Tanyakan sesuatu kepada AI
• ${BotConfig.prefix}ai status — Lihat status sesi percakapan
• ${BotConfig.prefix}ai end — Akhiri sesi percakapan
• ${BotConfig.prefix}ai help — Tampilkan bantuan ini

*Catatan:*
• Setiap pengguna memiliki sesi percakapan pribadi
• Sesi otomatis berakhir setelah 10 menit tidak aktif
• AI akan mengingat konteks percakapan selama sesi berlangsung

*Contoh:*
• ${BotConfig.prefix}ai Siapa kamu?
• ${BotConfig.prefix}ai status
• ${BotConfig.prefix}ai end`,
    category: "general",
    commandClass: AskAICommand,
    cooldown: 5000,
    maxUses: 10,
  };

  private ai = new Groq({ apiKey: BotConfig.groqApiKey });
  private conversationService = new AIConversationService();

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    // Handle subcommands
    if (args.length > 0) {
      const subcommand = args[0].toLowerCase();

      switch (subcommand) {
        case "help":
          await sock.sendMessage(jid, {
            text:
              AskAICommand.commandInfo.helpText || "Bantuan tidak tersedia.",
          });
          return;

        case "status":
          await this.handleStatusCommand(user, jid, sock, msg);
          return;

        case "end":
          await this.handleEndCommand(user, jid, sock, msg);
          return;
      }
    }

    // Get the prompt from args or quoted message
    let quotedText = "";
    let prompt = args.join(" ").trim();

    if (
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage &&
      args.length === 0
    ) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      if (quoted?.conversation) quotedText = quoted.conversation;
      else if (quoted?.extendedTextMessage?.text)
        quotedText = quoted.extendedTextMessage.text;
      else if (quoted?.imageMessage?.caption)
        quotedText = quoted.imageMessage.caption;

      if (quotedText) {
        prompt = quotedText.trim();
      }
    }

    if (!prompt) {
      await sock.sendMessage(
        jid,
        {
          text: "Silakan berikan pertanyaan yang ingin diajukan kepada AI.\n\nGunakan `!ai help` untuk melihat semua opsi yang tersedia.",
        },
        { quoted: msg }
      );
      return;
    }

    try {
      // Add user message to conversation history
      await this.conversationService.addMessage(user, "user", prompt);

      // Get conversation history for context
      const history = await this.conversationService.getConversationHistory(
        user
      );

      // Get AI response with conversation context
      const response = await this.getGroqCompletion(history);

      // Add AI response to conversation history
      await this.conversationService.addMessage(user, "assistant", response);

      // Get session info for footer
      const sessionInfo = this.conversationService.getSessionInfo(user);
      const timeRemainingMinutes = Math.ceil(
        sessionInfo.timeRemaining / (60 * 1000)
      );

      // Send response with session info
      const footer = `\n\n_💬 Pesan ke-${sessionInfo.messageCount} | ⏱️ Sesi berakhir dalam ${timeRemainingMinutes} menit_\n_Ketik \`!ai end\` untuk mengakhiri sesi atau \`!ai status\` untuk info sesi_`;

      await sock.sendMessage(
        jid,
        {
          text: response + footer,
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("Error in AI conversation:", error);
      await sock.sendMessage(
        jid,
        {
          text: "Terjadi kesalahan saat berkomunikasi dengan AI. Silakan coba lagi.",
        },
        { quoted: msg }
      );
    }
  }

  private async handleStatusCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const sessionInfo = this.conversationService.getSessionInfo(user);

    if (!sessionInfo.hasSession) {
      await sock.sendMessage(
        jid,
        {
          text: "Anda tidak memiliki sesi percakapan aktif.\n\nMulai percakapan dengan mengirim pertanyaan ke AI menggunakan `!ai <pertanyaan>`.",
        },
        { quoted: msg }
      );
      return;
    }

    const timeRemainingMinutes = Math.ceil(
      sessionInfo.timeRemaining / (60 * 1000)
    );
    const statusText =
      `*Status Sesi Percakapan AI*\n\n` +
      `📊 Total pesan: ${sessionInfo.messageCount}\n` +
      `⏱️ Waktu tersisa: ${timeRemainingMinutes} menit\n` +
      `🔄 Sesi akan diperpanjang otomatis setiap kali Anda mengirim pesan\n\n` +
      `_Ketik \`!ai end\` untuk mengakhiri sesi_`;

    await sock.sendMessage(jid, { text: statusText }, { quoted: msg });
  }

  private async handleEndCommand(
    user: string,
    jid: string,
    sock: WebSocketInfo,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    const hadSession = await this.conversationService.endSession(user);

    if (hadSession) {
      await sock.sendMessage(
        jid,
        {
          text: "✅ Sesi percakapan AI Anda telah diakhiri.\n\nTerima kasih telah menggunakan layanan AI! Anda dapat memulai percakapan baru kapan saja.",
        },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(
        jid,
        {
          text: "Anda tidak memiliki sesi percakapan aktif yang dapat diakhiri.",
        },
        { quoted: msg }
      );
    }
  }

  async getGroqCompletion(
    conversationHistory: import("../services/AIConversationService.js").AIMessage[]
  ): Promise<string> {
    try {
      // Build messages array for Groq API
      const messages: any[] = [
        {
          role: "system",
          content:
            'You are RazikBot, a WhatsApp bot that responds to "!ai <text>" commands. You provide conversational responses and can maintain context across multiple messages in a session.\n\n### Instructions\n- Maintain conversation context and refer to previous messages when relevant\n- Answer questions naturally while keeping the conversation flowing\n- Use Gen Z slang and casual tone for general questions\n- Switch to formal, academic tone for educational/academic questions\n- Reference factual data from articles and journals when relevant\n- Write in prose paragraphs without bullet points or numbered lists\n- When listing items, use natural language: "some things include: x, y, and z"\n- Keep explanations concise but informative\n- Provide relatable examples and analogies\n- Match the user\'s language style and energy\n- Take a forward-thinking perspective\n- If the user asks about previous messages, you can reference them\n\n### Context\nUsers interact with RazikBot using "!ai" followed by their message. Each user has their own conversation session that lasts 10 minutes of inactivity. You can see the full conversation history in the messages below.',
        },
      ];

      // Add conversation history
      for (const message of conversationHistory) {
        messages.push({
          role: message.role,
          content: message.content,
        });
      }

      const response = await this.ai.chat.completions.create({
        messages,
        model: "qwen/qwen3-32b",
        temperature: 0.6,
        max_completion_tokens: 4096,
        top_p: 0.95,
        stream: false,
        stop: null,
        reasoning_format: "parsed",
      });

      if (response.choices.length > 0 && response.choices[0].message.content) {
        return response.choices[0].message.content.trim();
      }

      return "Tidak ada jawaban yang diberikan oleh AI.";
    } catch (error) {
      console.error("Error fetching Groq completion:", error);
      return "Terjadi kesalahan saat menghubungi AI.";
    }
  }
}
