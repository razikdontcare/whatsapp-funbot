# Codebase Structure Documentation

This document describes the improved structure of the WhatsApp FunBot codebase, designed for better maintainability, readability, and scalability.

## 📁 Directory Structure

```
src/
├── api/                    # REST API layer
│   ├── controllers/        # API controllers
│   │   ├── configController.ts     # Configuration management endpoints
│   │   ├── messageController.ts    # Message sending endpoints
│   │   ├── statsController.ts      # Statistics and leaderboard endpoints
│   │   └── index.ts               # Barrel export for controllers
│   ├── routes/            # API route definitions
│   │   ├── configRoutes.ts        # Configuration routes
│   │   ├── messageRoutes.ts       # Message routes
│   │   ├── statsRoutes.ts         # Statistics routes
│   │   └── index.ts               # Route aggregation
│   ├── middleware/        # API middleware (future expansion)
│   ├── server.ts          # API server setup and configuration
│   └── index.ts           # Barrel export for API layer
├── commands/              # Bot command implementations
│   ├── admin/             # Administrative commands
│   │   ├── ConfigCommand.ts       # Bot configuration management
│   │   └── RegisterGroupCommand.ts # Group registration
│   ├── games/             # Game commands
│   │   ├── HangmanGame.ts         # Hangman game implementation
│   │   └── RockPaperScissorsGame.ts # Rock Paper Scissors game
│   ├── media/             # Media-related commands
│   │   ├── DownloaderCommand.ts   # Generic file downloader
│   │   ├── LyricsFindCommand.ts   # Song lyrics finder
│   │   ├── YTDLCommand.ts         # YouTube downloader
│   │   └── YTSearchCommand.ts     # YouTube search
│   ├── social/            # Social platform integrations
│   │   ├── FufufafaComments.ts    # Fufufafa comment scraper
│   │   └── MPLIDInfo.ts           # MPL ID information
│   ├── utility/           # General utility commands
│   │   ├── AskAICommand.ts        # AI conversation interface
│   │   └── LeaderboardCommand.ts  # Game leaderboards
│   └── index.ts           # Barrel export for all commands
├── core/                  # Core bot functionality
│   ├── BotClient.ts       # Main WhatsApp client
│   ├── CommandHandler.ts  # Command processing and routing
│   ├── CommandInterface.ts # Command interface definition
│   ├── CooldownManager.ts # Command cooldown management
│   ├── auth.ts            # Authentication handling
│   ├── config.ts          # Configuration management
│   ├── mongo.ts           # MongoDB connection management
│   ├── scheduler.ts       # Scheduled tasks
│   ├── types.ts           # Type definitions
│   └── index.ts           # Barrel export for core functionality
├── services/              # Business logic services
│   ├── AIConversationService.ts   # AI conversation management
│   ├── AIResponseService.ts       # AI response processing
│   ├── BotConfigService.ts        # Bot configuration service
│   ├── CommandUsageService.ts     # Command usage tracking
│   ├── GameLeaderboardService.ts  # Game statistics
│   ├── GroupSettingService.ts     # Group settings management
│   ├── SessionService.ts          # Session management
│   ├── UserPreferenceService.ts   # User preferences
│   └── index.ts                   # Barrel export for services
├── utils/                 # Utility functions organized by category
│   ├── ai/                # AI-related utilities
│   │   └── ai_tools.ts    # AI integration tools
│   ├── common/            # Common utilities
│   │   └── logger.ts      # Logging functionality
│   ├── media/             # Media processing utilities
│   │   ├── compression.ts # File compression
│   │   ├── ffmpeg.ts      # Audio/video processing
│   │   └── ytdlp.ts       # YouTube download wrapper
│   ├── social/            # Social platform utilities
│   │   ├── getFufufafaComments.ts # Fufufafa scraper
│   │   └── mplid.ts       # MPL ID utilities
│   ├── text/              # Text processing utilities
│   │   ├── extractUrlsFromText.ts # URL extraction
│   │   └── randomKBBI.ts  # Indonesian dictionary integration
│   └── index.ts           # Barrel export for all utilities
└── index.ts               # Application entry point
```

## 🏗️ Architecture Principles

### 1. **Separation of Concerns**
- **API Layer**: Handles HTTP requests and responses
- **Commands**: Implement bot command logic
- **Core**: Manages bot lifecycle and infrastructure
- **Services**: Contains business logic and data operations
- **Utils**: Provides reusable utility functions

### 2. **Modular Organization**
- Commands are organized by functionality (admin, games, media, social, utility)
- Utils are categorized by domain (ai, media, text, common, social)
- API endpoints are grouped by resource type

### 3. **Consistent Naming Conventions**
- PascalCase for classes and files containing classes
- camelCase for functions and variables
- Descriptive, meaningful names throughout

### 4. **Barrel Exports**
- Each major directory has an `index.ts` file
- Enables clean, organized imports: `import { BotClient } from './core'`
- Reduces coupling between modules

## 📦 Import Patterns

### ✅ Good Import Examples
```typescript
// Using barrel exports
import { BotClient, CommandHandler } from '../core';
import { ConfigController, StatsController } from '../controllers';

// Specific utility imports
import { Logger } from '../utils/common/logger';
import { convertMp3ToOgg } from '../utils/media/ffmpeg';
```

### ❌ Avoid These Patterns
```typescript
// Avoid deep imports when barrel exports exist
import { BotClient } from '../core/BotClient';

// Avoid relative path chains
import { something } from '../../../some/deep/path';
```

## 🔧 Development Guidelines

### Adding New Commands
1. Choose the appropriate category directory (`admin/`, `games/`, `media/`, `social/`, `utility/`)
2. Create the command file following the naming convention
3. Update the `commands/index.ts` barrel export
4. Ensure proper imports using the new structure

### Adding New API Endpoints
1. Create or update the appropriate controller in `api/controllers/`
2. Define routes in the corresponding file in `api/routes/`
3. Update barrel exports as needed

### Adding New Utilities
1. Place the utility in the appropriate subdirectory (`ai/`, `media/`, `text/`, `common/`, `social/`)
2. Update the `utils/index.ts` barrel export
3. Use descriptive names that indicate the utility's purpose

## 🧪 Testing the Structure

### TypeScript Compilation
```bash
# Check for type errors
npx tsc --noEmit
```

### Import Validation
```bash
# Ensure all imports resolve correctly
npm run dev
```

## 🚀 Benefits of This Structure

1. **Improved Maintainability**: Clear separation makes it easier to locate and modify code
2. **Better Scalability**: New features can be added without disrupting existing code
3. **Enhanced Readability**: Logical organization makes the codebase self-documenting
4. **Reduced Coupling**: Barrel exports and clear boundaries between modules
5. **Easier Testing**: Modular structure facilitates unit and integration testing
6. **Team Collaboration**: Clear structure makes it easier for multiple developers to work together

## 📝 Migration Notes

### For Existing Code
- All import paths have been updated to work with the new structure
- Backward compatibility is maintained through the restructuring
- The API maintains the same endpoints for external consumers

### For Future Development
- Follow the established patterns when adding new features
- Use barrel exports for cleaner imports
- Place code in the most appropriate category directory
- Update documentation when adding new major components

This structure provides a solid foundation for the continued development and maintenance of the WhatsApp FunBot project.