# SYSTEM_MAP.md

## Metadata
- **map_version**: 1.0.0
- **last_updated**: 2026-07-09
- **last_updated_by**: agent/fd7a9281-1924-4aa3-b324-a8752de33779

## Project Overview
WhatsApp bot with AI integration and modular command system. Built with TypeScript/Bun, using Baileys for WhatsApp connectivity and Hono for the API dashboard.

## Tech Stack
- **Language**: TypeScript
- **Runtime**: Bun
- **Package Manager**: Bun
- **Main Libraries**:
  - `baileys`: WhatsApp Web API
  - `hono`: Web framework for API and dashboard
  - `mongodb`: Persistence (auth, sessions, config, stats)
  - `ai`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/deepseek`: AI integration
  - `sharp`, `jimp`: Image processing
  - `node-cron`: Task scheduling
  - `zod`: Schema validation

## Environment Variables
| Variable | Description |
| :--- | :--- |
| `MONGO_URI` | MongoDB connection string |
| `GROQ_API_KEY` | API key for Groq AI |
| `GOOGLE_GENERATIVE_AI_API_KEY` | API key for Google Generative AI |
| `TAVILY_API_KEY` | API key for Tavily search |
| `EXA_API_KEY` | API key for Exa search and extract (primary) |
| `API_USERNAME` | Username for Hono API basic auth |
| `API_PASSWORD` | Password for Hono API basic auth |
| `AI_PROVIDER` | AI provider routing (google, groq, openrouter, deepseek, auto) |
| `DASHBOARD_PORT` | Port for the Hono dashboard (default: 5000) |
| `DEEPSEEK_API_KEY` | API key for DeepSeek AI (VIP-only provider) |

## Entry Points
| Type | File | Description |
| :--- | :--- | :--- |
| Bot | `src/index.ts` | Main entry point for starting the WhatsApp bot |
| API | `src/api.ts` | Entry point for the Hono HTTP server |

## Core Architecture
- **Application Layer (`src/app`)**: Bot client management, message routing, and command handling.
- **Domain Layer (`src/domain`)**: Business logic and services (AI, Sessions, VIP, Games).
- **Infrastructure Layer (`src/infrastructure`)**: External integrations (DB, Web server, Config).
- **Shared Layer (`src/shared`)**: Utilities, logger, and common types.

## File Registry

### Application Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/client/BotClient.ts` | Manages WA connection and event routing | `BotClient` | #app | #bot |
| `src/app/handlers/CommandHandler.ts` | Loads and executes bot commands | `CommandHandler` | #app | #bot |
| `src/app/handlers/CommandInterface.ts` | Command structure definitions | `CommandInterface`, `CommandInfo` | #app | #bot |
| `src/app/handlers/CooldownManager.ts` | Manages command rate limits | `CooldownManager` | #app | #bot |

### Domain Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/domain/services/AIConversationService.ts` | Manages AI chat history and context | `AIConversationService` | #domain | #ai |
| `src/domain/services/AIKnowledgeVectorService.ts` | Vector search integration for AI knowledge | `AIKnowledgeVectorService` | #domain | #ai |
| `src/domain/services/AIProviderRouterService.ts` | Routes requests to different AI providers | `AIProviderRouterService` | #domain | #ai |
| `src/domain/services/AIResponseService.ts` | Generates AI responses | `AIResponseService` | #domain | #ai |
| `src/domain/services/BotConfigService.ts` | Manages dynamic bot configuration in DB | `BotConfigService` | #domain | #config |
| `src/domain/services/CommandUsageService.ts` | Tracks command usage statistics | `CommandUsageService` | #domain | #stats |
| `src/domain/services/FreeGamesService.ts` | Checks and notifies about free games | `FreeGamesService` | #domain | #games |
| `src/domain/services/GameLeaderboardService.ts` | Manages game leaderboards | `GameLeaderboardService` | #domain | #games |
| `src/domain/services/GroupSettingService.ts` | Manages group-specific settings | `GroupSettingService` | #domain | #bot |
| `src/domain/services/HangmanGameService.ts` | Logic for Hangman game | `HangmanGameService` | #domain | #games |
| `src/domain/services/IGRSService.ts` | Integration with IGRS (game ratings) | `IGRSService` | #domain | #games |
| `src/domain/services/ReminderService.ts` | Manages user reminders | `ReminderService` | #domain | #utils |
| `src/domain/services/SessionService.ts` | Manages user/group game sessions | `SessionService` | #domain | #bot |
| `src/domain/services/UserPreferenceService.ts` | Manages user-specific preferences and structured memory graph | `UserPreferenceService`, `UserPreference` | #domain | #bot |
| `src/domain/services/VIPService.ts` | Manages VIP status and benefits | `VIPService` | #domain | #bot |

### Infrastructure Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/infrastructure/config/auth.ts` | MongoDB-backed auth state for Baileys | `useMongoDBAuthState` | #infra | #config |
| `src/infrastructure/config/config.ts` | Static and dynamic config initialization | `BotConfig`, `getCurrentConfig` | #infra | #config |
| `src/infrastructure/config/mongo.ts` | Atomic MongoDB client connection management | `getMongoClient`, `isMongoConnected`, `getActiveMongoClient` | #infra | #infra |
| `src/infrastructure/config/scheduler.ts` | Initializes cron jobs | `scheduleVIPCleanup`, etc. | #infra | #bot |
| `src/infrastructure/web/adminConsolePage.ts` | HTML rendering for admin dashboard | `renderAdminConsoleHtml` | #infra | #web |
| `src/infrastructure/web/adminConsoleBody.ts` | Admin console body markup | `ADMIN_CONSOLE_BODY` | #infra | #web |
| `src/infrastructure/web/adminConsoleStyles.ts` | Admin console stylesheet string | `ADMIN_CONSOLE_STYLES` | #infra | #web |
| `src/infrastructure/web/adminConsoleScript.ts` | Admin console client logic | `ADMIN_CONSOLE_SCRIPT` | #infra | #web |

### Shared Layer & Root
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/index.ts` | Bot entry point | None | #app | #bot |
| `src/api.ts` | API entry point and routes | `broadcastQRUpdate` | #infra | #web |
| `src/shared/logger/logger.ts` | Custom logging with buffer and redaction | `Logger`, `logBuffer` | #shared | #utils |
| `src/shared/types/types.ts` | Common TypeScript types | `Session`, `WebSocketInfo` | #shared | #types |
| `src/shared/utils/ai_tools.ts` | Consolidated helper and agent tools for AI interactions (filesystem, command exec, web search, web fetch, knowledge search, web extract) | `setCommandHandler`, `get_bot_commands`, `get_command_help`, `execute_bot_command`, `knowledge_search`, `upsert_knowledge`, `send_chat_message`, `reply_chat_message`, `send_chat_media`, `web_search`, `web_extract`, `list_files`, `read_file`, `write_file`, `delete_file`, `read_memory`, `update_memory`, `exec_command`, `web_fetch` | #shared | #ai |
| `src/shared/utils/ai_agent_tools.ts` | [DELETED 2026-06-16] Filesystem, execution and web tools for AI agents | N/A | #shared | #ai |
| `src/shared/utils/whatsapp_formatter.ts` | Formats standard Markdown to WhatsApp-compatible markup | `formatResponseForWhatsApp` | #shared | #utils |
| `src/shared/utils/ytdlp.ts` | YouTube download utility | `ytdlp` | #shared | #utils |

## API Surface
| Method | Path | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| GET | `/admin` | Admin Console Dashboard | Yes |
| GET | `/admin/styles.css` | Admin Console Stylesheet | Yes |
| GET | `/admin/app.js` | Admin Console Client Script | Yes |
| GET | `/api/logs` | Fetch recent bot logs | Yes |
| POST | `/api/logs/clear` | Clear log buffer | Yes |
| GET | `/api/logs/stream` | SSE stream for live logs | Yes |
| GET | `/api/command-usage` | Get command usage stats | Yes |
| GET | `/api/leaderboard` | Get game leaderboards | Yes |
| GET | `/api/ops` | Get runtime ops summary | Yes |
| POST | `/api/send-message` | Send a WhatsApp message via bot | Yes |
| GET | `/api/config` | Get bot configuration | Yes |
| POST | `/api/config` | Update bot configuration | Yes |
| GET | `/api/qr` | Get current QR code as PNG | Yes |
| GET | `/api/status` | Get bot connection status | Yes |

## Data Models
| Model | Fields | Description |
| :--- | :--- | :--- |
| `Session` | `game`, `data`, `timestamp` | Represents an active user session (e.g. game) |
| `LogEntry` | `id`, `timestamp`, `level`, `message` | In-memory log representation |
| `BotConfig` | `prefix`, `admins`, `aiProvider`, etc. | Core bot settings |
| `AuthDocument` | `_id`, `data` (Binary) | MongoDB document for auth credentials |

## Conventions
- **Naming**: `PascalCase` for files/classes, `camelCase` for variables/methods.
- **Imports**: Relative with `.js` extension (ESM compatibility).
- **Error Handling**: Standard `try-catch` with custom `Logger`.
- **Global State**: `globalThis.__botClient` used to share bot instance with API.
- **Gotcha**: `getMongoClient` uses a promise-based lock to prevent `MongoNotConnectedError` during concurrent initialization.
- **Gotcha**: To prevent `MongoNotConnectedError` when the database client is recreated, avoid caching `db` or `collection` objects in asynchronous closures; fetch them dynamically from the active client on each request.
- **Convention**: VIP-only providers (e.g. `deepseek`) are gated in `AskAICommand.handleProviderCommand` — the router itself is provider-agnostic.

## Data Flow: "!help" Command
1.  **Ingestion**: `BotClient` receives message via `baileys` socket event.
2.  **Routing**: `CommandHandler` identifies the command and prefix.
3.  **Validation**: Permission and maintenance checks performed.
4.  **Execution**: `CommandHandler.handleHelpCommand` generates list of commands.
5.  **Response**: `sock.sendMessage` dispatches response back to WhatsApp.

## Changelog
- **2026-04-28**: Initial map generated from full codebase scan (agent/initial-scan).
- **2026-04-28**: Added AI agent tools (filesystem, persistent memory) and integrated into AskAICommand.
- **2026-04-28**: Expanded agent tools with `exec_command` and `web_fetch` for full autonomy.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Modified yt-dlp module and downloader command to parse and use -t mp4 preset option.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Reversed TikTok user-agent behavior to default to yt-dlp native/default UA, and added --curl-ua flag for explicit curl UA.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Added fallback mechanism to TTDL API with X-API-Key header from TTDL_API_KEY env for TikTok downloads.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added DeepSeek provider (deepseek-v4-flash) as VIP-only option in AI provider routing.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Merged `ai_agent_tools.ts` into `ai_tools.ts` for improved maintainability.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added `web_extract` tool utilizing Tavily's Extract API for clean page content extraction.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Optimized agent execution capability, step counts (30/60), context turns (40), Auto-RAG database search, status cleanup, and research keyword expansion.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added WhatsApp Formatting Critic, User Profile Memory Graph (MongoDB traits), and Specialized Multi-Agent Delegation (`delegate_task`).
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed WhatsApp formatter regex replacement order for list bullets and images to prevent formatting collision bugs.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Resolved `any` types in `DownloaderCommand.ts` fallback TikTok API response parser.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed missing `deepseek` check in `UserPreferenceService.getAIProviderPreference` which caused fallback to openrouter.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Integrated Exa search and extract tools utilizing the exa-js SDK, with fallback mechanisms to Tavily API.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Made DeepSeek (deepseek-v4-flash) the default provider for all users and removed the VIP restriction.
- **2026-06-27** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed animated sticker transparent background glitch on WhatsApp Desktop/Web by changing pixel format to rgba.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added auxiliary vision model pipeline in AskAICommand to process image inputs on text-only models (like DeepSeek).
- **2026-06-27** [patch] (agent/b4048922-83ae-4e2f-a6d8-c4636831e00c): Fixed database collection caching reconnect disconnects, progressive reconnection logout loop, implemented recursive wrapper message extraction, and integrated MongoDB-backed message store in BotClient.
- **2026-07-05** [patch] (agent/b4048922-83ae-4e2f-a6d8-c4636831e00c): Fixed sticker creation image format error by using safe TypedArray constructor instead of raw Buffer.buffer references.
- **2026-07-09** [patch] (agent/fd7a9281-1924-4aa3-b324-a8752de33779): Fixed MongoDB disconnection issues during WhatsApp reconnection by removing cached database/collection instances in all service classes and using dynamic getters.


