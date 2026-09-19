import { requestUrl } from "obsidian";
import type {
  DownloadContext,
  StorageProvider,
  StorageType,
  TransferProgress,
  UploadedObject,
  UploadSource,
} from "./types";
import {
  createUuid,
  getHeader,
  isSuccess,
  transferRequest,
} from "./transfer";
import { t } from "../i18n";

export abstract class BaseWebDavStorageProvider implements StorageProvider {
  abstract readonly storageType: StorageType;

  abstract validateConfiguration(options?: { requirePublicUrl?: boolean }): void;
  abstract getFileUrl(relativePath: string, forceRefresh?: boolean): Promise<string>;
  protected abstract webDavUrl(relativePath: string): string;
  protected abstract authorizationHeaders(): Record<string, string>;

  async upload(
    source: ArrayBuffer | UploadSource,
    mimeTypeOrProgress?: string | TransferProgress,
    onProgress?: TransferProgress,
  ): Promise<UploadedObject> {
    let data: ArrayBuffer;
    let mimeType: string;
    let progressCallback: TransferProgress | undefined;

    if (source instanceof ArrayBuffer) {
      data = source;
      mimeType = typeof mimeTypeOrProgress === "string" ? mimeTypeOrProgress : "application/octet-stream";
      progressCallback = onProgress;
    } else {
      if (source.data) {
        data = source.data;
      } else if (source.localPath) {
        const fs = require("node:fs/promises");
        const buf = await fs.readFile(source.localPath);
        data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else {
        throw new Error("No data or localPath provided for upload");
      }
      mimeType = source.mimeType;
      progressCallback = typeof mimeTypeOrProgress === "function" ? mimeTypeOrProgress : onProgress;
    }

    const relativePath = createUuid();
    const url = this.webDavUrl(relativePath);
    const response = await transferRequest(
      "PUT",
      url,
      {
        ...this.authorizationHeaders(),
        "Content-Type": mimeType,
        "Content-Length": String(data.byteLength),
      },
      data,
      progressCallback,
    );

    if (!isSuccess(response.status)) {
      throw new Error(t("error.upload", { status: response.status }));
    }

    try {
      const verification = await requestUrl({
        url,
        method: "HEAD",
        headers: this.authorizationHeaders(),
        throw: false,
      });
      if (!isSuccess(verification.status)) {
        throw new Error(t("error.uploadVerification", { status: verification.status }));
      }

      const contentLength = getHeader(verification.headers, "content-length");
      if (contentLength !== undefined && Number(contentLength) !== data.byteLength) {
        throw new Error(t("error.uploadSize", { expected: data.byteLength, actual: contentLength }));
      }
    } catch (error) {
      await this.delete(relativePath).catch(() => undefined);
      throw error;
    }

    let fileUrl: string;
    try {
      fileUrl = await this.getFileUrl(relativePath);
    } catch (error) {
      await this.delete(relativePath).catch(() => undefined);
      throw error;
    }

    return {
      relativePath,
      fileUrl,
    };
  }

  async download(
    relativePath: string,
    onProgress?: TransferProgress,
    context?: DownloadContext,
  ): Promise<ArrayBuffer> {
    const response = await transferRequest(
      "GET",
      this.webDavUrl(relativePath),
      this.authorizationHeaders(),
      undefined,
      undefined,
      onProgress,
    );
    if (!isSuccess(response.status)) {
      throw new Error(t("error.download", { status: response.status }));
    }
    return response.arrayBuffer;
  }

  async delete(relativePath: string): Promise<void> {
    const response = await requestUrl({
      url: this.webDavUrl(relativePath),
      method: "DELETE",
      headers: this.authorizationHeaders(),
      throw: false,
    });
    if (!isSuccess(response.status) && response.status !== 404) {
      throw new Error(t("error.remoteCleanup", { status: response.status }));
    }
  }

  abstract relativePathFromLegacyUrl?(remoteUrl: string): string;
}
