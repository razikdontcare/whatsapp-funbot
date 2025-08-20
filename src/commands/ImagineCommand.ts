import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import axios, { AxiosError } from "axios";

export class ImagineCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "imagine",
    description: "Generate an image based on a prompt.",
    category: "general",
    commandClass: ImagineCommand,
    aliases: ["img", "generate"],
    cooldown: 5,
    disabled: false,
    disabledReason: "",
    helpText: `*Cara pake:* 💫\n!imagine <prompt kamu>\n\n*Contoh:*\n!imagine sunset aesthetic vibes ungu gitu deh\n\n*Pro tip:* Lu bisa reply pesan buat jadiin prompt juga loh! ✨`,
  };

  private BASE_URL = "https://image.pollinations.ai/prompt";
  private width = 1080;
  private height = 1350;
  private nologo = true;
  private model = "flux";

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    try {
      let quotedText = "";
      let prompt = args.join(" ").trim();

      // Check for quoted message if no args provided
      if (
        msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage &&
        args.length === 0
      ) {
        const quoted =
          msg.message.extendedTextMessage.contextInfo.quotedMessage;
        if (quoted?.conversation) quotedText = quoted.conversation;
        else if (quoted?.extendedTextMessage?.text)
          quotedText = quoted.extendedTextMessage.text;
        else if (quoted?.imageMessage?.caption)
          quotedText = quoted.imageMessage.caption;

        prompt = quotedText.trim();
      }

      if (!prompt) {
        await sock.sendMessage(
          jid,
          {
            text: "bestie lu lupa kasih prompt 💀\n\nBilang aja mau bikin gambar apa! Contoh:\n!imagine kucing lucu pake kacamata hitam keren abis\n\nAtau reply pesan aja buat jadiin prompt ✨",
          },
          { quoted: msg }
        );
        return;
      }

      // Send initial processing message
      await sock.sendMessage(
        jid,
        { text: "lagi masak karya seni lu nih... bakal kece banget deh 🔥✨" },
        { quoted: msg }
      );

      const seed = Date.now();
      const imageUrl = `${this.BASE_URL}/${encodeURIComponent(prompt)}?width=${
        this.width
      }&height=${this.height}&seed=${seed}&nologo=${this.nologo}&model=${
        this.model
      }`;

      console.log(`[ImagineCommand] Generating image for prompt: "${prompt}"`);

      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 45000, // Increased timeout for better reliability
        maxRedirects: 5,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.data || response.data.byteLength === 0) {
        throw new Error("Empty response data");
      }

      const imageBuffer = Buffer.from(response.data);

      // Validate image buffer
      if (imageBuffer.length < 1000) {
        // Assuming valid images are at least 1KB
        throw new Error("Invalid image data received");
      }

      await sock.sendMessage(
        jid,
        {
          image: imageBuffer,
          caption: `visi lu udah jadi kenyataan bestie ✨\nprompt: "${prompt}"\n\nini mah juara banget, sukses total! 💅`,
        },
        { quoted: msg }
      );

      console.log(
        `[ImagineCommand] Successfully generated image for user: ${user}`
      );
    } catch (error) {
      console.error("[ImagineCommand] Error occurred:", error);

      let errorMessage =
        "duh ada yang error nih, gue ga mood sama situasi ini 😭";

      if (error instanceof AxiosError) {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
          errorMessage =
            "bestie AI nya lama banget respond... kayaknya inet lemot deh 📶💔\n\ncoba lagi bentar lagi ya!";
        } else if (error.response?.status === 429) {
          errorMessage =
            "woah santai dong bro! 🏃‍♀️💨\n\nAI nya lagi overwhelmed nih, tunggu 30 detik dulu deh";
        } else if (error.response?.status === 500) {
          errorMessage =
            "server AI nya lagi drama queen... emang suka lebay 💀\n\ncoba lagi nanti ya bestie";
        } else if (error.response?.status === 403) {
          errorMessage =
            "wah prompt lu kayaknya agak gimana gitu 👀\n\ncoba yang lebih family friendly dong bestie!";
        } else {
          errorMessage = `ada yang ga beres nih, error ${
            error.response?.status || "ga jelas"
          } vibes 😵‍💫\n\ncoba lagi nanti deh!`;
        }
      } else if (error instanceof Error) {
        if (
          error.message.includes("Empty response") ||
          error.message.includes("Invalid image")
        ) {
          errorMessage =
            "AI nya udah bikin tapi hasilnya rusak... energy file corrupt gitu 💾❌\n\ncoba prompt yang lain deh bestie!";
        }
      }

      await sock.sendMessage(
        jid,
        {
          text: errorMessage,
        },
        { quoted: msg }
      );
    }
  }
}
