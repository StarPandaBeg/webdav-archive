import { requestUrl } from "obsidian";
import type { StorageProvider, StorageType, TransferProgress, UploadedObject } from "./types";
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
  abstract getFileUrl(relativePath: string): Promise<string>;
  protected abstract webDavUrl(relativePath: string): string;
  protected abstract authorizationHeaders(): Record<string, string>;

  async upload(data: ArrayBuffer, mimeType: string, onProgress?: TransferProgress): Promise<UploadedObject> {
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
      onProgress,
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

  async download(relativePath: string, onProgress?: TransferProgress): Promise<ArrayBuffer> {
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
