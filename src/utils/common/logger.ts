import chalk from "chalk";
import { format } from "util";

type LogLevel = "error" | "warn" | "info" | "debug" | "verbose";
type LogMethod = (message: any, ...args: any[]) => void;

interface LoggerOptions {
  level?: LogLevel;
  displayTimestamp?: boolean;
  displayLevel?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

export class Logger {
  protected readonly level: LogLevel;
  protected readonly displayTimestamp: boolean;
  protected readonly displayLevel: boolean;

  private readonly colors = {
    error: chalk.red.bold,
    warn: chalk.yellow,
    info: chalk.blue,
    debug: chalk.magenta,
    verbose: chalk.cyan,
    timestamp: chalk.gray,
  };

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || "info";
    this.displayTimestamp = options.displayTimestamp ?? true;
    this.displayLevel = options.displayLevel ?? true;
  }

  protected shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  protected formatTimestamp(): string {
    return this.colors.timestamp(new Date().toISOString());
  }

  protected formatLevel(level: LogLevel): string {
    return this.colors[level](`[${level.toUpperCase()}]`.padEnd(7));
  }

  protected log(level: LogLevel, message: any, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const parts: string[] = [];

    if (this.displayTimestamp) {
      parts.push(this.formatTimestamp());
    }

    if (this.displayLevel) {
      parts.push(this.formatLevel(level));
    }

    const formattedMessage = format(message, ...args);
    parts.push(formattedMessage);

    const output = parts.join(" ");

    // Send errors to stderr, others to stdout
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(output + "\n");
  }

  public error: LogMethod = (message, ...args) =>
    this.log("error", message, ...args);
  public warn: LogMethod = (message, ...args) =>
    this.log("warn", message, ...args);
  public info: LogMethod = (message, ...args) =>
    this.log("info", message, ...args);
  public debug: LogMethod = (message, ...args) =>
    this.log("debug", message, ...args);
  public verbose: LogMethod = (message, ...args) =>
    this.log("verbose", message, ...args);

  public json(data: unknown, title?: string): void {
    if (!this.shouldLog("debug")) return;

    if (title) {
      this.debug(chalk.underline(title));
    }

    this.debug(JSON.stringify(data, null, 2));
  }

  public createChild(prefix: string): Logger {
    return new PrefixedLogger(prefix, {
      level: this.level,
      displayTimestamp: this.displayTimestamp,
      displayLevel: this.displayLevel,
    });
  }
}

class PrefixedLogger extends Logger {
  constructor(private readonly prefix: string, options: LoggerOptions) {
    super(options);
  }

  private formatPrefix(): string {
    return chalk.green(`[${this.prefix}]`);
  }

  public override log(level: LogLevel, message: any, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const parts: string[] = [];

    if (this.displayTimestamp) {
      parts.push(this.formatTimestamp());
    }

    parts.push(this.formatPrefix());

    if (this.displayLevel) {
      parts.push(this.formatLevel(level));
    }

    const formattedMessage = format(message, ...args);
    parts.push(formattedMessage);

    const output = parts.join(" ");

    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(output + "\n");
  }
}
