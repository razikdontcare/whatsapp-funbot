import axios from "axios";
import { CommandInterface } from "../core/CommandInterface.js";
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

export class FufufafaComments implements CommandInterface {
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

      const imageBuffer = await axios.get(fufufafaComments.image_url, {
        responseType: "arraybuffer",
        timeout: 5000,
        family: 4,
      });

      const image = await sharp(imageBuffer.data)
        .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
        .toBuffer();

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
              image: Buffer.from(image),
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
              image: Buffer.from(image),
              caption,
            },
            { quoted }
          );
        }
      } else {
        if (args.length > 0 && args.includes("imgonly")) {
          await sock.sendMessage(jid, {
            image: Buffer.from(image),
          });
          return;
        } else if (args.length > 0 && args.includes("textonly")) {
          await sock.sendMessage(jid, {
            text: fufufafaComments.content,
          });
          return;
        } else {
          await sock.sendMessage(jid, {
            image: Buffer.from(image),
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
