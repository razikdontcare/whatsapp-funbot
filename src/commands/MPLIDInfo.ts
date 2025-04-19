import { CommandInterface } from "../core/CommandInterface.js";
import { BotConfig, log } from "../core/config.js";
import { WebSocketInfo } from "../core/types.js";
import { SessionService } from "../services/SessionService.js";
import { proto } from "baileys";
import {
  getAllTeams,
  getSchedules,
  getStandings,
  getTeamById,
} from "../utils/mplid.js";

export class MPLIDInfo implements CommandInterface {
  static commandInfo = {
    name: "mplid",
    description: "Informasi tentang MPL Indonesia (MPLID)",
    helpText: `*Penggunaan:*
• !mplid teams — Menampilkan semua tim MPLID
• !mplid schedule — Menampilkan jadwal MPLID
• !mplid standings — Menampilkan klasemen MPLID
• !mplid team <team_id> — Menampilkan info tim berdasarkan ID

*Contoh:*
!mplid teams
!mplid team ae

ID Tim adalah singkatan nama tiap tim, contoh: "alter ego esports" memiliki ID "ae".`,
    category: "general",
    commandClass: MPLIDInfo,
    cooldown: 5000,
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
      const subCommand = args[0]?.toLowerCase();
      const helpMessage = `Perintah MPLID Info:
- ${BotConfig.prefix}mplid teams: Menampilkan semua tim MPLID
- ${BotConfig.prefix}mplid schedule: Menampilkan jadwal MPLID
- ${BotConfig.prefix}mplid standings: Menampilkan klasemen MPLID
- ${BotConfig.prefix}mplid team <team_id>: Menampilkan informasi tim berdasarkan ID
`;

      if (subCommand === "help") {
        await sock.sendMessage(jid, {
          text: helpMessage,
        });
        return;
      } else if (subCommand === "teams") {
        const teams = await getAllTeams();
        const teamList = teams.data
          .map((team, i) => `${i + 1}: ${team.name}`)
          .join("\n");
        await sock.sendMessage(jid, {
          text: `Daftar Tim MPLID:\n${teamList}`,
        });
        return;
      } else if (subCommand === "schedule") {
        const schedules = await getSchedules(true);
        // const scheduleData = schedules.data[0];
        // const currentWeek = scheduleData.week;
        // const scheduleList = scheduleData.schedules;
        // const scheduleText = scheduleList
        //   .map((schedule) => {
        //     const matches = schedule.matches
        //       .map(
        //         (match, j) =>
        //           `${j + 1}. ${match.homeTeam.name} vs ${
        //             match.awayTeam.name
        //           }\n${new Date(match.schedule).toLocaleString()}\nStatus: ${
        //             match.status
        //           }`
        //       )
        //       .join("\n\n");
        //     return `Hari ${schedule.day} (${new Date(
        //       schedule.date
        //     ).toLocaleDateString()}):\n\n${matches}`;
        //   })
        //   .join("\n\n");

        // await sock.sendMessage(jid, {
        //   text: `Jadwal MPLID Week ${currentWeek}:\n${scheduleText}`,
        // });
        await sock.sendMessage(jid, {
          image: Buffer.from(schedules),
        });
        return;
      } else if (subCommand === "standings") {
        const standings = await getStandings(true);
        // const standingsList = standings.data.map(
        //   (team) =>
        //     `${team.position}. ${team.team.name}\nMatch Point: ${team.match.points}\nMatch W-L: ${team.match.win} - ${team.match.lose}\nNet Game Win: ${team.game.net}\nGame W-L: ${team.game.win} - ${team.game.lose}`
        // );
        // await sock.sendMessage(jid, {
        //   text: `Klasemen MPLID:\n${standingsList.join("\n\n")}`,
        // });
        await sock.sendMessage(jid, {
          image: Buffer.from(standings),
        });
        return;
      } else if (subCommand === "team") {
        const teamId = args[1];
        if (!teamId) {
          await sock.sendMessage(jid, {
            text: "Silakan masukkan ID tim yang valid.",
          });
          return;
        }
        // const team = (await getTeamById(teamId)).data;
        const team = await getTeamById(teamId, true);
        if (team) {
          // const playerList =
          //   team.players
          //     ?.map((player, i) => `${i + 1}. ${player.name} - ${player.role}`)
          //     .join("\n") || "Tidak ada pemain.";
          // const teamInfo = `ID: ${team.id.toUpperCase()}\nNama: ${
          //   team.name
          // }\n\nPemain:\n${playerList}`;
          // if (!team.logo) {
          //   await sock.sendMessage(jid, {
          //     text: `Informasi Tim:\n${teamInfo}`,
          //   });
          //   return;
          // }
          // await sock.sendMessage(jid, {
          //   image: { url: team.logo },
          //   caption: `Informasi Tim:\n${teamInfo}`,
          // });
          await sock.sendMessage(jid, {
            image: Buffer.from(team),
          });
        } else {
          await sock.sendMessage(jid, {
            text: "Tim tidak ditemukan.",
          });
        }
      } else {
        await sock.sendMessage(jid, {
          text: "Perintah tidak dikenali. \n\n" + helpMessage,
        });
        return;
      }
    } catch (error) {
      log.error("Error handling MPLID command:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat memproses perintah. Silakan coba lagi.",
      });
      return;
    }
  }
}
