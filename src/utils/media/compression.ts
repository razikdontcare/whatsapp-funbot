import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

interface CompressionOptions {
  maxSizeMB?: number;
  quality?: "low" | "medium" | "high";
  timeout?: number;
}

export class VideoCompressor {
  private readonly DEFAULT_TIMEOUT = 180000; // 3 minutes

  async compressVideo(
    inputBuffer: Buffer,
    options: CompressionOptions = {}
  ): Promise<Buffer> {
    const {
      maxSizeMB = 50,
      quality = "medium",
      timeout = this.DEFAULT_TIMEOUT,
    } = options;

    const tempId = randomUUID();
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input_${tempId}.mp4`);
    const outputPath = join(tempDir, `output_${tempId}.mp4`);

    try {
      // Write input buffer to temp file
      await fs.writeFile(inputPath, inputBuffer);

      // Determine compression settings
      const crf = quality === "low" ? 28 : quality === "medium" ? 23 : 20;
      const preset =
        quality === "low"
          ? "ultrafast"
          : quality === "medium"
          ? "fast"
          : "medium";

      const args = [
        "ffmpeg",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-crf",
        crf.toString(),
        "-preset",
        preset,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-y", // overwrite output
        outputPath,
      ];

      await this.executeCommand(args, timeout);

      // Check if output file exists and is smaller
      const outputBuffer = await fs.readFile(outputPath);
      const outputSizeMB = outputBuffer.length / (1024 * 1024);

      if (outputSizeMB > maxSizeMB) {
        throw new Error(
          `Compressed file still too large: ${outputSizeMB.toFixed(1)}MB`
        );
      }

      return outputBuffer;
    } finally {
      // Cleanup
      await Promise.all([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {}),
      ]);
    }
  }

  private executeCommand(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(args[0], args.slice(1));
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          process.kill("SIGTERM");
          reject(new Error("Compression timeout"));
        }
      }, timeoutMs);

      process.on("close", (code) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);

          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
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
}
