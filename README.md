# WhatsApp Fun Bot

Bot WhatsApp multifungsi dengan berbagai game dan utilitas, dilengkapi sistem konfigurasi dinamis terintegrasi MongoDB.

## ✨ Fitur Utama

- 🤖 **AI Conversation**: Chat multi-turn dengan AI menggunakan Groq, dilengkapi session management per user
- 🎮 **Game Interaktif**: Hangman, Rock Paper Scissors, dan game lainnya
- ⚙️ **Konfigurasi Dinamis**: Kelola pengaturan bot via command atau API tanpa restart
- 👥 **Sistem Role**: Admin, Moderator, dan VIP dengan permission berbeda
- 📊 **Command Usage Stats**: Tracking penggunaan command
- 🔄 **Session Management**: Kelola session game dan AI conversation dengan MongoDB
- 🌐 **REST API**: Endpoint untuk monitoring dan management
- 📝 **Command Usage Tracking**: Analytics penggunaan bot

## 🚀 Quick Start

### Prerequisites

- Node.js atau Bun
- MongoDB (local atau cloud)
- WhatsApp account untuk bot

### Installation

```bash
# Clone repository
git clone <repository-url>
cd whatsapp-funbot

# Install dependencies
bun install

# Setup environment variables
cp .env.example .env
# Edit .env dengan konfigurasi Anda
```

### Environment Variables

```env
# MongoDB Connection
MONGO_URI=mongodb://localhost:27017/whatsapp-bot

# API Keys
GROQ_API_KEY=your_groq_api_key_here

# Environment
NODE_ENV=development
```

### Running the Bot

```bash
# Development
bun run src/index.ts

# Production
NODE_ENV=production bun run src/index.ts
```

## 📖 Documentation

- [Configuration Management](./CONFIG_MANAGEMENT.md) - Panduan lengkap sistem konfigurasi dinamis
- [API Documentation](./API.md) - REST API endpoints
- [Game Development Guide](./GAMES.md) - Cara membuat game baru

## 🎮 Available Commands

### Core Commands

- `!ai <pertanyaan>` - Chat dengan AI (mendukung percakapan multi-turn)
- `!ai status` - Lihat status sesi percakapan AI
- `!ai end` - Akhiri sesi percakapan AI
- `!games` - Lihat daftar game tersedia
- `!help [command]` - Bantuan command
- `!stop` - Hentikan game yang sedang berjalan
- `!stats` - Statistik penggunaan command

### Games

- `!hangman start` - Mulai game hangman
- `!rps start` - Mulai game rock paper scissors

### Admin Commands (Admin Only)

- `!config get` - Lihat konfigurasi bot
- `!config set <param> <value>` - Ubah konfigurasi
- `!config add-admin <jid>` - Tambah admin
- `!register` - Registrasi grup

## ⚙️ Dynamic Configuration

Bot mendukung konfigurasi dinamis yang tersimpan di MongoDB:

```bash
# Ubah prefix bot
!config set prefix #

# Ubah nama bot
!config set name "My Bot"

# Tambah admin baru
!config add-admin 6281234567890@s.whatsapp.net

# Reset ke default
!config reset
```

Lihat [CONFIG_MANAGEMENT.md](./CONFIG_MANAGEMENT.md) untuk panduan lengkap.

## 🌐 REST API

Bot menyediakan REST API untuk monitoring dan management:

```bash
# Get bot status
GET http://localhost:3000/api/config

# Update configuration
POST http://localhost:3000/api/config

# Get command usage stats
GET http://localhost:3000/api/command-usage

# Get game leaderboards
GET http://localhost:3000/api/leaderboard?game=hangman
```

## 🏗️ Architecture

The codebase has been restructured for better maintainability and readability:

```
src/
├── api/              # REST API layer (controllers, routes, middleware)
├── commands/         # Bot commands organized by category
│   ├── admin/        # Administrative commands
│   ├── games/        # Game implementations
│   ├── media/        # Media-related commands
│   ├── social/       # Social platform integrations
│   └── utility/      # General utility commands
├── core/             # Core bot functionality
├── services/         # Business logic services
└── utils/            # Utility functions organized by domain
    ├── ai/           # AI-related utilities
    ├── common/       # Common utilities
    ├── media/        # Media processing
    ├── social/       # Social platform utilities
    └── text/         # Text processing
```

For detailed information about the codebase structure and development guidelines, see [STRUCTURE.md](./STRUCTURE.md).

## 🔒 Security Features

- **Environment Variables**: Data sensitif (API keys) tetap di env vars
- **Role-based Access**: Command terbatas berdasarkan role user
- **MongoDB Integration**: Konfigurasi tersimpan aman di database
- **Audit Logging**: Semua perubahan konfigurasi di-log

## 🤝 Contributing

1. Fork repository ini
2. Buat feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [MongoDB](https://www.mongodb.com/) - Database
- [Bun](https://bun.sh/) - JavaScript runtime

---

Built with ❤️ using TypeScript and MongoDB
