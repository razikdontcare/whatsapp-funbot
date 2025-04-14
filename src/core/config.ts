export const BotConfig = {
  // Pengaturan Prefix
  prefix: "!",
  alternativePrefixes: ["/", "."],
  allowMentionPrefix: true, // Aktifkan untuk mengizinkan prefix mention (@bot command)

  // Pengaturan Umum
  name: "MeoW",
  maxSessions: 5, // Maksimal session per user
  sessionTimeout: 3600000, // Waktu timeout session dalam milidetik (1 jam)
  sessionName: "meowbot",

  // Pengaturan Game
  defaultGameHelp: "Ketikan {prefix}games untuk melihat daftar game.",
  unknownCommandResponse:
    "Perintah tidak dikenali. Ketik {prefix}games untuk bantuan.",
};
