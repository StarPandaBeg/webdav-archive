import { FileSystemAdapter, Platform, TFile } from "obsidian";
import type { App } from "obsidian";
import { t } from "./i18n";
import type { ProgressNotice } from "./progress-notice";
import type { VideoEncoder } from "./settings";

type ExecFile = typeof import("node:child_process").execFile;
type FileSystem = typeof import("node:fs/promises");

interface ExecFileError extends Error {
  code?: string | number;
  stderr?: string;
}

export async function convertVideoToMp4(
  app: App,
  file: TFile,
  progress: ProgressNotice,
  configuredFfmpegPath: string,
  videoEncoder: VideoEncoder,
): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error(t("convert.desktopOnly"));
  }
  if (!(app.vault.adapter instanceof FileSystemAdapter)) {
    throw new Error(t("convert.fileSystemOnly"));
  }

  const outputVaultPath = mp4VaultPath(file);
  if (outputVaultPath !== file.path && app.vault.getAbstractFileByPath(outputVaultPath)) {
    throw new Error(t("convert.targetExists", { path: outputVaultPath }));
  }

  // Obsidian's desktop plugin runtime is CommonJS. ESM import() of Node
  // built-ins fails in its renderer with "Failed to fetch dynamically imported
  // module", so load them lazily through the bundle's CommonJS require instead.
  // This code path is never reached on mobile.
  const { execFile } = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  const path = require("node:path") as typeof import("node:path");
  const os = require("node:os") as typeof import("node:os");
  const adapter = app.vault.adapter;
  const inputVaultPath = file.path;
  const inputPath = adapter.getFullPath(inputVaultPath);
  const token = randomToken();
  const temporaryPath = path.join(path.dirname(inputPath), `.${file.basename}.${token}.ffmpeg.mp4`);
  const ffmpegPath = await resolveFfmpegPath(execFile, fs, path, os, configuredFfmpegPath);
  const ffprobePath = siblingFfprobePath(ffmpegPath, path);
  const durationSeconds = await probeDuration(execFile, ffprobePath, inputPath);

  if (durationSeconds === null) {
    progress.indeterminate(t("convert.running"));
  } else {
    progress.update(5, t("convert.running"));
  }
  try {
    await runFfmpeg(execFile, ffmpegPath, inputPath, temporaryPath, videoEncoder, durationSeconds, (fraction) => {
      progress.update(5 + fraction * 80, t("convert.running"));
    });
    const result = await fs.stat(temporaryPath);
    if (!result.isFile() || result.size === 0) {
      throw new Error(t("convert.emptyOutput"));
    }
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  let renamedToMp4 = false;
  try {
    if (outputVaultPath !== inputVaultPath) {
      progress.update(88, t("convert.renaming"));
      await app.fileManager.renameFile(file, outputVaultPath);
      renamedToMp4 = true;
    }

    progress.update(94, t("convert.replacing"));
    const finalPath = adapter.getFullPath(file.path);
    const backupPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${token}.backup`);
    await replaceWithBackup(fs, finalPath, temporaryPath, backupPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    if (renamedToMp4 && file.path === outputVaultPath) {
      await app.fileManager.renameFile(file, inputVaultPath).catch(() => undefined);
    }
    throw error;
  }

  return t("convert.complete", { name: file.name });
}

async function runFfmpeg(
  execFile: ExecFile,
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  videoEncoder: VideoEncoder,
  durationSeconds: number | null,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const args = [
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", videoEncoder,
    ...videoEncoderArguments(videoEncoder),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    outputPath,
  ];

  try {
    await executeFfmpeg(execFile, ffmpegPath, args, durationSeconds, onProgress);
  } catch (error) {
    const failure = error as ExecFileError;
    if (failure.code === "ENOENT") {
      throw new Error(t("convert.ffmpegMissing"));
    }
    const details = (failure.stderr ?? failure.message)
      .trim()
      .split("\n")
      .slice(-4)
      .join(" ") || "FFmpeg error";
    throw new Error(t("convert.failed", { code: failure.code ?? "?", details }));
  }
}

function videoEncoderArguments(encoder: VideoEncoder): string[] {
  switch (encoder) {
    case "libx264":
      return ["-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p"];
    case "h264_videotoolbox":
      return ["-q:v", "65", "-pix_fmt", "yuv420p"];
    case "h264_nvenc":
      return ["-preset", "p4", "-cq", "23", "-b:v", "0", "-pix_fmt", "yuv420p"];
    case "h264_qsv":
      return ["-preset", "medium", "-global_quality", "23", "-pix_fmt", "yuv420p"];
    case "h264_amf":
      return [
        "-quality", "balanced",
        "-rc", "cqp",
        "-qp_i", "23",
        "-qp_p", "23",
        "-pix_fmt", "yuv420p",
      ];
    case "h264_vaapi":
      return ["-vf", "format=nv12,hwupload", "-global_quality", "23"];
  }
}

async function probeDuration(execFile: ExecFile, ffprobePath: string, inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execute(execFile, ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ], 2 * 1024 * 1024);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

function executeFfmpeg(
  execFile: ExecFile,
  executable: string,
  args: string[],
  durationSeconds: number | null,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const failure = error as ExecFileError;
          failure.stderr = String(stderr ?? "");
          reject(failure);
          return;
        }
        onProgress(1);
        resolve();
      },
    );

    if (durationSeconds === null) {
      return;
    }

    let buffered = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator === -1) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        if (key === "out_time_us") {
          const elapsedSeconds = Number(value) / 1_000_000;
          if (Number.isFinite(elapsedSeconds)) {
            onProgress(Math.max(0, Math.min(1, elapsedSeconds / durationSeconds)));
          }
        } else if (key === "progress" && value === "end") {
          onProgress(1);
        }
      }
    });
  });
}

async function resolveFfmpegPath(
  execFile: ExecFile,
  fs: FileSystem,
  path: typeof import("node:path"),
  os: typeof import("node:os"),
  configuredPath: string,
): Promise<string> {
  if (configuredPath.trim()) {
    const candidate = expandHome(configuredPath.trim(), path, os.homedir());
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      throw new Error(t("convert.ffmpegInvalidPath", { path: candidate }));
    }
  }

  // First try the environment inherited by Obsidian.
  try {
    await execute(execFile, "ffmpeg", ["-version"], 2 * 1024 * 1024);
    return "ffmpeg";
  } catch {
    // GUI applications often do not inherit the user's shell PATH.
  }

  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const pathCandidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
  const commonCandidates = process.platform === "darwin"
    ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
    : process.platform === "win32"
      ? ["C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe"]
      : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"];

  for (const candidate of [...pathCandidates, ...commonCandidates]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next location.
    }
  }

  if (process.platform !== "win32") {
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
    try {
      const { stdout } = await execute(execFile, shell, ["-lc", "command -v ffmpeg"], 1024 * 1024);
      const candidate = stdout.trim().split("\n")[0];
      if (candidate) {
        await fs.access(candidate);
        return candidate;
      }
    } catch {
      // The explicit setting below is the final fallback.
    }
  }

  throw new Error(t("convert.ffmpegMissing"));
}

function execute(
  execFile: ExecFile,
  executable: string,
  args: string[],
  maxBuffer = 16 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: "utf8", maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as ExecFileError;
        failure.stderr = String(stderr ?? "");
        reject(failure);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function expandHome(value: string, path: typeof import("node:path"), homeDirectory: string): string {
  return value === "~"
    ? homeDirectory
    : value.startsWith(`~${path.sep}`)
      ? path.join(homeDirectory, value.slice(2))
      : value;
}

function siblingFfprobePath(ffmpegPath: string, path: typeof import("node:path")): string {
  if (ffmpegPath === "ffmpeg") {
    return "ffprobe";
  }
  return path.join(path.dirname(ffmpegPath), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

async function replaceWithBackup(
  fs: FileSystem,
  originalPath: string,
  replacementPath: string,
  backupPath: string,
): Promise<void> {
  await fs.rename(originalPath, backupPath);
  try {
    await fs.rename(replacementPath, originalPath);
  } catch (error) {
    await fs.rename(backupPath, originalPath);
    throw error;
  }

  // Replacement is complete at this point. Failure to remove the hidden backup
  // must not roll back a valid converted file.
  await fs.unlink(backupPath).catch((error) => {
    console.warn("WebDAV Archive: could not remove FFmpeg backup", backupPath, error);
  });
}

function mp4VaultPath(file: TFile): string {
  if (file.extension.toLowerCase() === "mp4") {
    return file.path;
  }
  const parentPath = file.parent?.path;
  return parentPath && parentPath !== "/"
    ? `${parentPath}/${file.basename}.mp4`
    : `${file.basename}.mp4`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
