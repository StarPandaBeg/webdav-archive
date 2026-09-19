export type StorageType = "webdav" | "nextcloud";

export interface UploadedObject {
  relativePath: string;
  fileUrl: string;
}

export type TransferProgress = (transferredBytes: number, totalBytes: number | null) => void;

export interface StorageProvider {
  readonly storageType: StorageType;
  validateConfiguration(options?: { requirePublicUrl?: boolean }): void;
  upload(data: ArrayBuffer, mimeType: string, onProgress?: TransferProgress): Promise<UploadedObject>;
  download(relativePath: string, onProgress?: TransferProgress): Promise<ArrayBuffer>;
  delete(relativePath: string): Promise<void>;
  getFileUrl(relativePath: string): Promise<string>;
  relativePathFromLegacyUrl?(remoteUrl: string): string;
}
