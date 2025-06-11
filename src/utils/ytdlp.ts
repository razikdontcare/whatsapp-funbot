import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

interface YtDlpOptions {
  cookiesFile?: string;
  noMtime?: boolean;
  sortBy?: string;
  format?: string;
  audioOnly?: boolean;
  outputTemplate?: string;
}

interface YtDlpResult {
  buffer: Buffer;
  filename: string;
  metadata?: any;
}

export class YtDlpWrapper {
  private cookiesFile: string;

  constructor(cookiesFile: string = "cookies.txt") {
    this.cookiesFile = cookiesFile;
  }

  async downloadToBuffer(
    url: string,
    options: YtDlpOptions = {}
  ): Promise<YtDlpResult> {
    // Generate temporary filename
    const tempId = randomUUID();
    const tempDir = tmpdir();
    const outputTemplate = join(tempDir, `ytdlp_${tempId}.%(ext)s`);

    // Build command arguments
    const args = this.buildArgs(url, outputTemplate, options);

    try {
      // Execute yt-dlp command
      const { stdout, stderr } = await this.executeCommand(args);

      // Find the downloaded file
      const downloadedFile = await this.findDownloadedFile(tempDir, tempId);

      if (!downloadedFile) {
        throw new Error("Downloaded file not found");
      }

      // Read file into buffer
      const buffer = await fs.readFile(downloadedFile.path);

      // Clean up temporary file
      await fs.unlink(downloadedFile.path).catch(() => {});

      return {
        buffer,
        filename: downloadedFile.name,
        metadata: this.parseMetadata(stdout),
      };
    } catch (error) {
      throw new Error(`yt-dlp failed: ${error}`);
    }
  }

  private buildArgs(
    url: string,
    outputTemplate: string,
    options: YtDlpOptions
  ): string[] {
    const args = ["yt-dlp"];

    // Add no-mtime flag
    if (options.noMtime !== false) {
      args.push("--no-mtime");
    }

    // Add sort parameter
    if (options.sortBy) {
      args.push("-S", options.sortBy);
    } else {
      args.push("-S", "ext");
    }

    // Add cookies file
    const cookiesFile = options.cookiesFile || this.cookiesFile;
    args.push("--cookies", cookiesFile);

    // Add output template
    args.push("-o", outputTemplate);

    // Add format if specified
    if (options.format) {
      args.push("-f", options.format);
    }

    // Audio only option
    if (options.audioOnly) {
      args.push("-x");
      args.push("--audio-format", "mp3"); // Default to mp3 if not specified
    }

    // Add URL
    args.push(url);

    return args;
  }

  private executeCommand(
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(args[0], args.slice(1), {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      process.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(error);
      });
    });
  }

  private async findDownloadedFile(
    tempDir: string,
    tempId: string
  ): Promise<{ path: string; name: string } | null> {
    try {
      const files = await fs.readdir(tempDir);
      const downloadedFile = files.find((file) =>
        file.includes(`ytdlp_${tempId}`)
      );

      if (downloadedFile) {
        return {
          path: join(tempDir, downloadedFile),
          name: downloadedFile.replace(`ytdlp_${tempId}.`, ""),
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private parseMetadata(stdout: string): any {
    // Basic metadata parsing from stdout
    // You can enhance this based on yt-dlp's JSON output format
    try {
      const lines = stdout.split("\n");
      const metadata: any = {};

      lines.forEach((line) => {
        if (line.includes("[download]") && line.includes("Destination:")) {
          metadata.destination = line.split("Destination: ")[1];
        }
        if (line.includes("[download]") && line.includes("%")) {
          const match = line.match(/(\d+\.?\d*)%/);
          if (match) {
            metadata.progress = parseFloat(match[1]);
          }
        }
      });

      return metadata;
    } catch {
      return {};
    }
  }

  // Convenience method for your specific command
  async downloadVideo(url: string): Promise<YtDlpResult> {
    return this.downloadToBuffer(url, {
      noMtime: true,
      sortBy: "ext",
      cookiesFile: this.cookiesFile,
    });
  }

  // Convenience method for downloading audio only
  async downloadAudio(
    url: string,
    format: string = "mp3"
  ): Promise<YtDlpResult> {
    return this.downloadToBuffer(url, {
      noMtime: true,
      sortBy: "ext",
      cookiesFile: this.cookiesFile,
      audioOnly: true,
      format: `bestaudio[ext=${format}]/bestaudio/best`,
    });
  }
}

// Usage example
// export async function downloadYouTubeVideo(url: string): Promise<Buffer> {
//   const wrapper = new YtDlpWrapper('cookies.txt');
//   const result = await wrapper.downloadVideo(url);
//   return result.buffer;
// }

// Usage example for audio
// export async function downloadYouTubeAudio(url: string, format: string = 'mp3'): Promise<Buffer> {
//   const wrapper = new YtDlpWrapper('cookies.txt');
//   const result = await wrapper.downloadAudio(url, format);
//   return result.buffer;
// }
