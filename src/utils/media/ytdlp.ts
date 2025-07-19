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
  private readonly DOWNLOAD_TIMEOUT = 300000; // 5 minutes timeout
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit
  private readonly MAX_DURATION = 600; // 10 minutes limit

  constructor(cookiesFile: string = "cookies.txt") {
    this.cookiesFile = cookiesFile;
  }

  async getVideoInfo(url: string): Promise<any> {
    const args = [
      "yt-dlp",
      "--dump-json",
      "--no-download",
      "--cookies",
      this.cookiesFile,
      url,
    ];

    try {
      const { stdout } = await this.executeCommandWithTimeout(args, 30000); // 30s timeout for info
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Failed to get video info: ${error}`);
    }
  }

  async downloadToBuffer(
    url: string,
    options: YtDlpOptions = {}
  ): Promise<YtDlpResult> {
    // Check video info first
    const videoInfo = await this.getVideoInfo(url);

    // Check duration limit
    if (videoInfo.duration && videoInfo.duration > this.MAX_DURATION) {
      throw new Error(
        `Video too long: ${Math.round(videoInfo.duration / 60)} minutes (max: ${
          this.MAX_DURATION / 60
        } minutes)`
      );
    }

    // Check if it's a live stream
    if (videoInfo.is_live) {
      throw new Error("Live streams are not supported");
    }

    // Generate temporary filename
    const tempId = randomUUID();
    const tempDir = tmpdir();
    const outputTemplate = join(tempDir, `ytdlp_${tempId}.%(ext)s`);

    // Build command arguments
    const args = this.buildArgs(url, outputTemplate, options);

    try {
      // Execute yt-dlp command with timeout
      const { stdout, stderr } = await this.executeCommandWithTimeout(
        args,
        this.DOWNLOAD_TIMEOUT
      );

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
      // Clean up any partial downloads
      await this.cleanupTempFiles(tempDir, tempId);
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

    // Enhanced format selection
    if (options.format) {
      args.push("-f", options.format);
    } else if (options.audioOnly) {
      // Priority: m4a > mp3 > any audio
      args.push("-f", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best");
    } else {
      // Enhanced video format selection with WhatsApp compatibility
      const videoFormats = [
        "best[height<=1080][ext=mp4]",
        "best[height<=720][ext=mp4]",
        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]",
        "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]",
        "best[height<=1080]",
        "best[height<=720]",
        "worst",
      ];
      args.push("-f", videoFormats.join("/"));
    }

    // Audio processing for video downloads
    if (!options.audioOnly) {
      args.push("--merge-output-format", "mp4");
    }

    // Audio only option
    if (options.audioOnly) {
      args.push("-x");
      args.push("--audio-format", "mp3");
    }

    // Add URL
    args.push(url);

    return args;
  }

  private executeCommandWithTimeout(
    args: string[],
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(args[0], args.slice(1), {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let isResolved = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          process.kill("SIGTERM");

          // Force kill if SIGTERM doesn't work
          setTimeout(() => {
            if (!process.killed) {
              process.kill("SIGKILL");
            }
          }, 5000);

          reject(new Error(`Download timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      process.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);

          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Process exited with code ${code}: ${stderr}`));
          }
        }
      });

      process.on("error", (error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private async cleanupTempFiles(
    tempDir: string,
    tempId: string
  ): Promise<void> {
    try {
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter((file) =>
        file.includes(`ytdlp_${tempId}`)
      );

      await Promise.all(
        tempFiles.map((file) => fs.unlink(join(tempDir, file)).catch(() => {}))
      );
    } catch (error) {
      // Ignore cleanup errors
    }
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
      format:
        "best[height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/worst",
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
