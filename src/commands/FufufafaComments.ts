import axios from "axios";
import { CommandInfo, CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import {
  getRandomFufufafaComment,
  getFufufafaCommentById,
} from "../utils/getFufufafaComments.js";
import sharp from "sharp";
import { proto } from "baileys";

const IMAGE_QUALITY = 80;

export class FufufafaComments extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "fufufafa",
    description:
      "Komentar random dari akun Kaskus Fufufafa. (Total 699 komentar)",
    helpText: `*Penggunaan:*
• !fufufafa — Mendapatkan komentar random
• !fufufafa <id> — Mendapatkan komentar berdasarkan ID
• !fufufafa <id> imgonly — Hanya gambar
• !fufufafa <id> textonly — Hanya teks

*Contoh:*
!fufufafa
!fufufafa 123
!fufufafa 123 imgonly`,
    category: "general",
    commandClass: FufufafaComments,
    cooldown: 10000,
    maxUses: 3,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo
  ): Promise<void> {
    try {
      let fufufafaComments;

      if (args.length > 0 && args[0] !== "imgonly" && args[0] !== "textonly") {
        fufufafaComments = await getFufufafaCommentById(parseInt(args[0]));
      } else {
        fufufafaComments = await getRandomFufufafaComment();
      }

      const imageBuffer = !args.includes("textonly")
        ? await axios.get(fufufafaComments.image_url, {
            responseType: "arraybuffer",
            timeout: 5000,
            family: 4,
          })
        : null;

      const image = !args.includes("textonly")
        ? await sharp(imageBuffer?.data)
            .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
            .toBuffer()
        : null;

      const caption = `${fufufafaComments.content}\n\nPosted on ${new Date(
        Number(fufufafaComments.datetime)
      ).toLocaleString()}\nOriginal Post: ${fufufafaComments.doksli}\nID: ${
        fufufafaComments.id
      }\n\nKirim ${BotConfig.prefix}fufufafa ${
        fufufafaComments.id
      } untuk mendapatkan gambar ini kembali`;

      if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo;
        const botId = sock.authState.creds.me?.id.split(":")[0] || null;
        const quoted = {
          key: {
            remoteJid: jid,
            fromMe:
              quotedMessage.participant === `${botId}@s.whatsapp.net`
                ? true
                : false,
            id: quotedMessage.stanzaId,
            participant: quotedMessage.participant,
          },
          message: quotedMessage.quotedMessage,
        };

        if (args.length > 0 && args.includes("imgonly")) {
          await sock.sendMessage(
            jid,
            {
              image: Buffer.from(image!),
            },
            {
              quoted,
            }
          );

          return;
        } else if (args.length > 0 && args.includes("textonly")) {
          await sock.sendMessage(
            jid,
            {
              text: fufufafaComments.content,
            },
            {
              quoted,
            }
          );

          return;
        } else {
          await sock.sendMessage(
            jid,
            {
              image: Buffer.from(image!),
              caption,
            },
            { quoted }
          );
        }
      } else {
        if (args.length > 0 && args.includes("imgonly")) {
          await sock.sendMessage(jid, {
            image: Buffer.from(image!),
          });
          return;
        } else if (args.length > 0 && args.includes("textonly")) {
          await sock.sendMessage(jid, {
            text: fufufafaComments.content,
          });
          return;
        } else {
          await sock.sendMessage(jid, {
            image: Buffer.from(image!),
            caption,
          });
          return;
        }
      }
    } catch (error) {
      log.error("Error handling command:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat memproses perintah. Silakan coba lagi.",
      });

      return;
    }
  }
}
