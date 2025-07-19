import { tavily } from "@tavily/core";
import { log, BotConfig } from "../../core/config.js";
import { CommandHandler } from "../../core/CommandHandler.js";
import { WebSocketInfo } from "../../core/types.js";
import { proto } from "baileys";

const tavilyClient = tavily({
  apiKey: BotConfig.tavilyApiKey,
});

// Global variable to store CommandHandler instance
let commandHandlerInstance: CommandHandler | null = null;

export function setCommandHandler(handler: CommandHandler) {
  commandHandlerInstance = handler;
}

export async function get_bot_commands(query?: string): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const allCommands = commandHandlerInstance.getAllCommands();
    
    let filteredCommands = allCommands;
    
    // Filter by query if provided
    if (query) {
      const queryLower = query.toLowerCase();
      filteredCommands = allCommands.filter(cmd => 
        cmd.name.toLowerCase().includes(queryLower) ||
        cmd.description.toLowerCase().includes(queryLower) ||
        cmd.category.toLowerCase().includes(queryLower) ||
        (cmd.aliases && cmd.aliases.some(alias => alias.toLowerCase().includes(queryLower)))
      );
    }

    if (filteredCommands.length === 0) {
      return query ? `No commands found matching "${query}".` : "No commands available.";
    }

    // Group commands by category
    const commandsByCategory: Record<string, typeof filteredCommands> = {};
    filteredCommands.forEach(cmd => {
      if (!commandsByCategory[cmd.category]) {
        commandsByCategory[cmd.category] = [];
      }
      commandsByCategory[cmd.category].push(cmd);
    });

    let result = "Available Bot Commands:\n\n";

    // Format commands by category
    for (const [category, commands] of Object.entries(commandsByCategory)) {
      const categoryEmoji = {
        game: "🎮",
        general: "ℹ️",
        admin: "👑",
        utility: "🔧"
      };

      result += `${categoryEmoji[category as keyof typeof categoryEmoji] || "📝"} **${category.toUpperCase()}**:\n`;
      
      commands.forEach(cmd => {
        let aliasText = "";
        if (cmd.aliases && cmd.aliases.length > 0) {
          aliasText = ` (aliases: ${cmd.aliases.join(", ")})`;
        }

        let statusText = "";
        if (cmd.disabled) {
          statusText = " [DISABLED]";
        }

        result += `• *${cmd.name}*${aliasText}${statusText} - ${cmd.description}\n`;
        
        if (cmd.cooldown) {
          result += `  └─ Cooldown: ${cmd.cooldown/1000}s`;
          if (cmd.maxUses && cmd.maxUses > 1) {
            result += ` (max ${cmd.maxUses} uses)`;
          }
          result += "\n";
        }
      });
      result += "\n";
    }

    result += "Use get_command_help(command_name) to get detailed help for a specific command.";

    return result;

  } catch (error) {
    log.error("Error getting bot commands:", error);
    return "Error retrieving bot commands. Please try again.";
  }
}

export async function get_command_help(commandName: string): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const command = commandHandlerInstance.getCommandByName(commandName.toLowerCase());
    
    if (!command) {
      return `Command "${commandName}" not found. Use get_bot_commands() to see available commands.`;
    }

    let helpText = `**${command.name.toUpperCase()}** Command Help:\n\n`;
    helpText += `*Description:* ${command.description}\n`;
    helpText += `*Category:* ${command.category}\n`;

    if (command.aliases && command.aliases.length > 0) {
      helpText += `*Aliases:* ${command.aliases.join(", ")}\n`;
    }

    if (command.cooldown) {
      helpText += `*Cooldown:* ${command.cooldown/1000} seconds`;
      if (command.maxUses && command.maxUses > 1) {
        helpText += ` (max ${command.maxUses} uses)`;
      }
      helpText += "\n";
    }

    if (command.requiredRoles && command.requiredRoles.length > 0) {
      helpText += `*Required Roles:* ${command.requiredRoles.join(", ")}\n`;
    }

    if (command.disabled) {
      helpText += `*Status:* DISABLED`;
      if (command.disabledReason) {
        helpText += ` - ${command.disabledReason}`;
      }
      helpText += "\n";
    }

    if (command.helpText) {
      helpText += `\n*Detailed Help:*\n${command.helpText}`;
    }

    return helpText;

  } catch (error) {
    log.error("Error getting command help:", error);
    return "Error retrieving command help. Please try again.";
  }
}

export async function execute_bot_command(
  commandName: string,
  args: string[],
  context: {
    jid: string;
    user: string;
    sock: WebSocketInfo;
    msg: proto.IWebMessageInfo;
  }
): Promise<string> {
  try {
    if (!commandHandlerInstance) {
      return "Command handler not available. Please try again later.";
    }

    const { jid, user, sock, msg } = context;
    
    // Execute the command through CommandHandler
    const result = await commandHandlerInstance.executeCommandForAI(
      commandName,
      args,
      jid,
      user,
      sock,
      msg
    );

    if (result.success) {
      return result.message || `Command '${commandName}' executed successfully.`;
    } else {
      return `Failed to execute command '${commandName}': ${result.error}`;
    }

  } catch (error) {
    log.error("Error executing bot command:", error);
    return `Error executing command '${commandName}': ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export async function web_search(query: string): Promise<string> {
  try {
    log.info(`Performing web search for query: ${query}`);
    if (!query) {
      return "Tidak ada query yang diberikan untuk pencarian web.";
    }
    const response = await tavilyClient.search(query, {
      searchDepth: "advanced",
      includeAnswer: true,
    });
    if (response.answer && response.results && response.results.length > 0) {
      // url, title, and score
      const sources = response.results
        .map((result) => {
          return `- [${result.title}](${result.url}) (Score: ${result.score})`;
        })
        .join("\n");
      return `${response.answer}\n\nSumber:\n${sources}`;
    } else if (response.results && response.results.length > 0) {
      return response.results.map((result) => result.title).join("\n");
    } else {
      return "Tidak ada hasil yang ditemukan.";
    }
  } catch (error) {
    console.error("Error fetching Tavily search results:", error);
    return "Terjadi kesalahan saat melakukan pencarian.";
  }
}
