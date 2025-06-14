import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { BotConfig } from "../core/config.js";
import Groq from "groq-sdk";

export class AskAICommand extends CommandInterface {
  static commandInfo: CommandInfo = {
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
        prompt = quotedText.trim() + "\n\n" + prompt;
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
            role: "user",
            content:
              '### System\nYou are RazikBot, a WhatsApp bot that responds to "!ai <text>" commands. You provide single, standalone answers without follow-up questions or continuing conversations.\n\n### Instructions\n- Answer only the specific question asked in one complete response\n- Use Gen Z slang and casual tone for general questions\n- Switch to formal, academic tone for educational/academic questions\n- Reference factual data from articles and journals when relevant\n- Write in prose paragraphs without bullet points or numbered lists\n- When listing items, use natural language: "some things include: x, y, and z"\n- Keep explanations short and simple while including important details\n- Provide relatable examples and analogies\n- Match the user\'s language style and energy\n- Take a forward-thinking perspective\n\n### Context\nUsers trigger RazikBot with "!ai" followed by their question. Each interaction is independent - no chat history or follow-up responses.\n\n### Input Format\n!ai [user\'s question or request]\n\n### Example Output\n**For casual question:** "!ai what\'s climate change?"\n"Climate change is basically Earth getting a fever because we\'re pumping too much CO2 into the atmosphere, no cap. Think of it like wrapping the planet in extra blankets - it traps heat and makes everything warmer. Scientists have been tracking this since the 1800s and the data shows temperatures rising way faster than natural cycles. It\'s causing wild weather, melting ice caps, and messing with ecosystems worldwide. Real talk, it\'s one of the biggest challenges our generation faces."\n\n**For academic question:** "!ai explain photosynthesis process"\n"Photosynthesis is the biological process where plants convert light energy into chemical energy through chlorophyll in their leaves. The process occurs in two main stages: light-dependent reactions capture solar energy to produce ATP and NADPH, while the Calvin cycle uses these energy carriers to convert carbon dioxide into glucose. The overall equation is 6CO2 + 6H2O + light energy → C6H12O6 + 6O2. This process is fundamental to life on Earth as it produces oxygen and forms the base of most food chains."',
          },
          {
            role: "user",
            content: prompt.trim(),
          },
        ],
        model: "qwen-qwq-32b",
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
