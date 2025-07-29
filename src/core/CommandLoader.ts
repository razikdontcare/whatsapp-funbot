import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CommandInfo } from "./CommandInterface.js";
import { log } from "./config.js";

/**
 * Utility for loading command metadata from command files.
 * Recursively scans a directory for command modules and extracts their CommandInfo.
 * @module CommandLoader
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively collect all files with the given extension in a directory and its subdirectories.
 * @param dir Directory to search
 * @param extension File extension to match (e.g. ".ts" or ".js")
 * @returns Array of absolute file paths
 */
function getAllCommandFiles(dir: string, extension: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllCommandFiles(filePath, extension));
    } else if (file.endsWith(extension)) {
      results.push(filePath);
    }
  }
  return results;
}

/**
 * Loads all CommandInfo objects from command files in the given directory.
 * @param commandsDir Absolute path to the commands directory
 * @returns Array of CommandInfo objects
 */
export async function loadCommandInfos(
  commandsDir: string
): Promise<CommandInfo[]> {
  const isDev = process.env.NODE_ENV !== "production";
  const fileExtension = isDev ? ".ts" : ".js";

  let files: string[] = getAllCommandFiles(commandsDir, fileExtension);
  if (files.length === 0) {
    // Try the alternate extension if none found
    const altExtension = isDev ? ".js" : ".ts";
    files = getAllCommandFiles(commandsDir, altExtension);
  }

  log.info(
    `Loading ${files.length} command files from ${commandsDir} (recursive)`
  );

  const commandInfos: CommandInfo[] = [];
  for (const file of files) {
    try {
      const commandModule = await import(file);
      // Prefer default export, fallback to first named export
      const CommandClass =
        commandModule.default || Object.values(commandModule)[0];
      if (!CommandClass || !CommandClass.commandInfo) {
        log.warn(`Command file ${file} does not export a valid command class`);
        continue;
      }
      commandInfos.push(CommandClass.commandInfo);
      log.debug(`Loaded command: ${CommandClass.commandInfo.name}`);
    } catch (error) {
      log.error(`Failed to load command from ${file}:`, error);
    }
  }
  return commandInfos;
}
