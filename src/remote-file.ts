interface RemoteFileMetadata {
  storage: "webdav";
  originalName: string;
  originalPath: string;
  mimeType: string;
  size: number;
  sha256: string;
  archivedAt: string;
}

export interface RemoteFile extends RemoteFileMetadata {
  version: 2;
  relativePath: string;
  /** Kept for compatibility with existing version 2 readers. */
  publicUrl: string;
  /** Canonical full public URL for viewers and integrations. */
  fileUrl: string;
}

export interface LegacyRemoteFile extends RemoteFileMetadata {
  version: 1;
  /** Full private WebDAV URL used by the original marker format. */
  url: string;
}

export type ParsedRemoteFile = RemoteFile | LegacyRemoteFile;

export function serializeRemoteFile(file: RemoteFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseRemoteFile(value: string): ParsedRemoteFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The .remote file does not contain valid JSON");
  }

  if (isVersionTwoRemoteFile(parsed)) {
    const publicUrl = typeof parsed.publicUrl === "string" ? parsed.publicUrl : parsed.fileUrl;
    if (!publicUrl) {
      throw new Error("The .remote file is missing its public URL");
    }
    const fileUrl = typeof parsed.fileUrl === "string" ? parsed.fileUrl : publicUrl;
    return { ...parsed, publicUrl, fileUrl };
  }

  if (isLegacyRemoteFile(parsed)) {
    return parsed;
  }

  throw new Error("The .remote file has an unsupported or invalid format");
}

function isVersionTwoRemoteFile(value: unknown): value is Omit<RemoteFile, "publicUrl" | "fileUrl"> & {
  publicUrl?: string;
  fileUrl?: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  const publicUrl = typeof file.publicUrl === "string" ? file.publicUrl : file.fileUrl;
  return (
    file.version === 2 &&
    file.storage === "webdav" &&
    typeof file.relativePath === "string" &&
    typeof publicUrl === "string" &&
    isHttpUrl(publicUrl) &&
    hasCommonFields(file)
  );
}

function isLegacyRemoteFile(value: unknown): value is LegacyRemoteFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  return (
    file.version === 1 &&
    file.storage === "webdav" &&
    typeof file.url === "string" &&
    isHttpUrl(file.url) &&
    hasCommonFields(file)
  );
}

function hasCommonFields(file: Record<string, unknown>): boolean {
  return (
    typeof file.originalName === "string" &&
    typeof file.originalPath === "string" &&
    typeof file.mimeType === "string" &&
    typeof file.size === "number" &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(file.sha256) &&
    typeof file.archivedAt === "string"
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
