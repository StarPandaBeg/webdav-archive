import { FileSystemAdapter, Platform, TFile } from "obsidian";
import type { App } from "obsidian";
import { t } from "./i18n";
import type { ProgressNotice } from "./progress-notice";

export async function convertVideoToMp4(app: App, file: TFile, progress: ProgressNotice): Promise<string> {
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
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  const path = require("node:path") as typeof import("node:path");
  const adapter = app.vault.adapter;
  const inputVaultPath = file.path;
  const inputPath = adapter.getFullPath(inputVaultPath);
  const token = randomToken();
  const temporaryPath = path.join(path.dirname(inputPath), `.${file.basename}.${token}.ffmpeg.mp4`);

  progress.indeterminate(t("convert.running"));
  try {
    await runFfmpeg(spawn, inputPath, temporaryPath);
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
  spawn: typeof import("node:child_process").spawn,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const args = [
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      reject(error.code === "ENOENT" ? new Error(t("convert.ffmpegMissing")) : error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const details = stderr.trim().split("\n").slice(-4).join(" ") || "FFmpeg error";
      reject(new Error(t("convert.failed", { code: code ?? "?", details })));
    });
  });
}

async function replaceWithBackup(
  fs: typeof import("node:fs/promises"),
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
