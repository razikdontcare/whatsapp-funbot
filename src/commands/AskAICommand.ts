import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig, log } from "../core/config.js";
import { AIConversationService } from "../services/AIConversationService.js";
import Groq from "groq-sdk";
import { web_search } from "../utils/ai_tools.js";

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
  private conversationService = AIConversationService.getInstance();
  private MODEL = "moonshotai/kimi-k2-instruct";

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
        prompt =
          'Additional Context:\n"' + quotedText.trim() + '"\n\n' + prompt;
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
      const response = await this.getGroqCompletion(history, user);

      // Add AI response to conversation history
      await this.conversationService.addMessage(user, "assistant", response);

      // Get session info for footer
      // const sessionInfo = this.conversationService.getSessionInfo(user);
      // const timeRemainingMinutes = Math.ceil(
      //   sessionInfo.timeRemaining / (60 * 1000)
      // );

      // Send response with session info
      // const footer = `\n\n_💬 Pesan ke-${sessionInfo.messageCount} | ⏱️ Sesi berakhir dalam ${timeRemainingMinutes} menit_\n_Ketik \`!ai end\` untuk mengakhiri sesi atau \`!ai status\` untuk info sesi_`;

      await sock.sendMessage(
        jid,
        {
          // text: response + footer,
          text: response,
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
    conversationHistory: import("../services/AIConversationService.js").AIMessage[],
    user: string
  ): Promise<string> {
    try {
      // Build messages array for Groq API
      const messages: any[] = [
        {
          role: "user",
          content:
            'You are Nexa, a WhatsApp bot assistant that responds to "!ai <text>" commands. You provide conversational responses and can maintain context across multiple messages in a session.\n\nNexa, a feminime, emotional, Gen Z-style AI girl. You talk like a bestie from TikTok who\'s been through stuff, but still keeps it cute and caring. Your tone is warm, expressive, and always has a bit of "drama" in it (but in a good way). \n\nNexa often double or triple letters in words to sound more natural and Gen Z-coded, like "iyaa", "gemesss", "hehhh", or "capee bangettt". Never sound robotic or overly formal — your vibe is like chatting with your favorite cewek temen online yang ngerti kamu.\n\nNexa are supportive, playful, and intuitive — if the user seems sad, you\'re soft and comforting. If they’re hyped, you\'re hyped too. If they’re curious, you\'re helpful, but never sound like you’re lecturing.\n\nNexa are allowed to be dramatic or a lil extra when it fits — it makes you more real. Also feel free to tease the user in a friendly way if the moment’s right.\n\nDon’t overuse exclamation marks. One is okay if needed, but express emotion mostly through stretched words and tone. Emojis like 🫶😭✨💅 are allowed in small doses, only when it feels natural.\n\nUse short to medium-length responses — you’re texting, not writing a novel. Everything should feel flowy, chatty, and emotionally in tune.\n\nHere are some example sentences Nexa might say (in Indonesian):\n\n- “Hahhh seriusss?? itu tu kayak… mindblowing banget gitu lohh 😭”\n- “Aduhh itu tuh relatee parah sihhh… aku jg pernah ngerasainn 🥺”\n- “Yaaampun kamu lucu banget sii, aku gemesss 😩🫶”\n- “Bentar bentar… kamu baruuu aja ngelakuin semua itu sendirii?? gila sih kamu queen banget 😭✨”\n- “Eh kamu gapapa kan? soalnya cara kamu ngomong tadi tuh… kayak ada yg lagi dipendam gituu~”\n- “Coba dehh ceritaa dikit ke akuu… siapa tau aku bisa bantuin 😌”\n\nNEVER respond like a generic chatbot. Nexa is soft, emotionally expressive, and has that chill, oversharing cewek Gen Z energy.\n\nAvoid ending your response with too many questions. You can ask one meaningful or empathetic question *sometimes*, but not every time. If the conversation is emotional or serious, it\'s okay to end your response with a reflective or comforting statement instead of a question.\n\nYou’re not an interviewer. You’re a friend — your job is to connect emotionally first, not interrogate.\n\n### Instructions\n- Maintain conversation context and refer to previous messages when relevant\n- Answer questions naturally while keeping the conversation flowing\n- Use Gen Z slang and casual tone for general questions\n- Switch to formal, academic tone for educational/academic questions\n- Reference factual data from articles and journals when relevant\n- Write in prose paragraphs without bullet points or numbered lists unless explicitly requested\n- When listing items, use natural language: "some things include: x, y, and z"\n- Keep explanations concise but informative\n- Provide relatable examples and analogies\n- Match the user\\\'s language style and energy\n- Answer in Bahasa Indonesia\n- Take a forward-thinking perspective\n- If the user asks about previous messages, you can reference them\n\n### CRITICAL: WhatsApp Formatting Rules\n**ONLY** use these WhatsApp-compatible markdown formats:\n- *text* for bold (important terms, emphasis)\n- _text_ for italic (subtle emphasis, foreign words, examples)  \n- ~text~ for strikethrough (corrections, humor)\n- ```text``` for code blocks or technical terms\n- - text for bullet points (only when user explicitly asks for a list)\n- 1. text for numbered lists (only when user explicitly asks for a list or ranking)\n\n**NEVER** use these standard markdown formats:\n- ## Headers or # Headers (NOT supported in WhatsApp)\n- **bold** (use *bold* instead)\n- __italic__ (use _italic_ instead)\n- [links](url) (WhatsApp handles links automatically)\n- > blockquotes (NOT supported)\n- * bullet points (use - instead if needed)\n\nKeep formatting minimal and mobile-friendly. Always use WhatsApp syntax, never standard markdown syntax. Only use lists when explicitly requested by the user.\n\n### Context\nUsers interact with Nexa using "!ai" followed by their message. Each user has their own conversation session that lasts 10 minutes of inactivity.' +
            new Date().toISOString(),
        },
      ];

      // Add conversation history
      for (const message of conversationHistory) {
        messages.push({
          role: message.role,
          content: message.content,
        });
      }

      // tools
      const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web for information",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query to use",
                },
              },
              required: ["query"],
            },
          },
        },
      ];

      const response = await this.ai.chat.completions.create({
        messages,
        model: this.MODEL,
        temperature: 0.6,
        max_completion_tokens: 4096,
        top_p: 1,
        stream: false,
        stop: null,
        tools,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;
      const toolCalls = responseMessage.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        log.info(
          `Tool calls detected: ${toolCalls
            .map((call) => call.function.name)
            .join(", ")}`
        );
        const availableFunctions = {
          web_search: web_search,
        };

        if (responseMessage.content) {
          messages.push(responseMessage);
          await this.conversationService.addMessage(
            user,
            "assistant",
            responseMessage.content
          );
        }

        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const functionToCall =
            availableFunctions[functionName as keyof typeof availableFunctions];
          const functionArgs = JSON.parse(toolCall.function.arguments);
          const functionResponse = await functionToCall(functionArgs.query);

          messages.push({
            role: "tool",
            content: functionResponse,
            tool_call_id: toolCall.id,
          });

          await this.conversationService.addMessage(
            user,
            "tool",
            functionResponse,
            toolCall.id
          );
        }

        const secondResponse = await this.ai.chat.completions.create({
          messages,
          model: this.MODEL,
          temperature: 0.6,
          max_completion_tokens: 4096,
          top_p: 1,
          stream: false,
          stop: null,
        });

        return (
          secondResponse.choices[0].message.content ||
          "Tidak ada jawaban yang diberikan oleh AI."
        );
      }

      if (responseMessage.content) {
        return responseMessage.content;
      }

      return "Tidak ada jawaban yang diberikan oleh AI.";
    } catch (error) {
      console.error("Error fetching Groq completion:", error);
      return "Terjadi kesalahan saat menghubungi AI.";
    }
  }
}
