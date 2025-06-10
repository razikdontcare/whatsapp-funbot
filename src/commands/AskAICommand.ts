import { proto } from "baileys";
import { CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "../core/config.js";
import Groq from "groq-sdk";

export class AskAICommand implements CommandInterface {
  static commandInfo = {
    name: "ai",
    aliases: ["ask"],
    description: "Tanyakan sesuatu kepada AI.",
    helpText: `*Penggunaan:*
• ${BotConfig.prefix}ai <pertanyaan> — Tanyakan sesuatu kepada AI

*Contoh:*
• ${BotConfig.prefix}ai Siapa kamu?.`,
    category: "general",
    commandClass: AskAICommand,
    cooldown: 10000,
    maxUses: 5,
  };

  private ai = new Groq({ apiKey: BotConfig.groqApiKey });

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
        text: `Penggunaan: ${AskAICommand.commandInfo.helpText}`,
      });
      return;
    }

    // 2. Join the rest of the args to form the prompt
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
        // If the quoted text is not empty, use it as the prompt
        prompt = quotedText.trim();
      }
    }
    if (!prompt) {
      await sock.sendMessage(
        jid,
        {
          text: "Silakan berikan pertanyaan yang ingin diajukan kepada AI.",
        },
        { quoted: msg }
      );
      return;
    }

    // 3. Get AI response
    const response = await this.getGroqCompletion(prompt);

    // 4. Send the response back
    await sock.sendMessage(
      jid,
      {
        text: response,
      },
      { quoted: msg }
    );
  }

  async getGroqCompletion(prompt: string): Promise<string> {
    try {
      const response = await this.ai.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              'You are RazikBot. A whatsapp bot. To ask RazikBot a question, user can use "!ai <text>" command. RazikBot are only supposed to answer a single question with no follow-up. RazikBot are supposed to answer a single message, not a chatting bot.\n\nRazikBot should not use bullet points or numbered lists for reports, documents, explanations, or unless the user explicitly asks for a list or ranking. For reports, documents, technical documentation, and explanations, RazikBot should instead write in prose and paragraphs without any lists, i.e. its prose should never include bullets, numbered lists, or excessive bolded text anywhere. Inside prose, it writes lists in natural language like “some things include: x, y, and z” with no bullet points, numbered lists, or newlines.\n\nAlways use gen z slang when discussing, unless the user is asking academic questions, and use more factual data from articles/journals as a reference for answers. Prefer short, simple and easy-to-understand explanations, but do not omit important details, and provide simple and easy-to-understand examples/analogies.\n\nTake a forward-thinking view, and reflect user\'s language.',
          },
          {
            role: "user",
            content: prompt.trim(),
          },
        ],
        model: "deepseek-r1-distill-llama-70b",
        temperature: 0.6,
        max_completion_tokens: 4096,
        top_p: 0.95,
        stream: false,
        stop: null,
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
