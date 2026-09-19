import type { TFile } from "obsidian";

export type StorageType = "webdav" | "nextcloud" | "s3";

export interface UploadedObject {
  relativePath: string;
  fileUrl: string;
}

export type TransferProgress = (transferredBytes: number, totalBytes: number | null) => void;

export interface UploadSource {
  file?: TFile;
  data: ArrayBuffer;
  size: number;
  mimeType: string;
  checksum?: string;
}

export interface DownloadContext {
  expectedSize?: number;
  expectedSha256?: string;
}

export interface StorageProvider {
  readonly storageType: StorageType;
  validateConfiguration(options?: { requirePublicUrl?: boolean }): void;
  upload(
    source: ArrayBuffer | UploadSource,
    mimeTypeOrProgress?: string | TransferProgress,
    onProgress?: TransferProgress,
  ): Promise<UploadedObject>;
  download(
    relativePath: string,
    onProgress?: TransferProgress,
    context?: DownloadContext,
  ): Promise<ArrayBuffer>;
  exists(relativePath: string): Promise<boolean>;
  verify?(relativePath: string, expectedSize?: number): Promise<boolean>;
  delete(relativePath: string): Promise<void>;
  getFileUrl(relativePath: string, forceRefresh?: boolean): Promise<string>;
  relativePathFromLegacyUrl?(remoteUrl: string): string;
}
