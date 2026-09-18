export interface RemoteFile {
  version: 2;
  storage: "webdav";
  relativePath: string;
  publicUrl: string;
  originalName: string;
  originalPath: string;
  mimeType: string;
  size: number;
  sha256: string;
  archivedAt: string;
}

export function serializeRemoteFile(file: RemoteFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseRemoteFile(value: string): RemoteFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The .remote file does not contain valid JSON");
  }

  if (!isRemoteFile(parsed)) {
    throw new Error("The .remote file has an unsupported or invalid format");
  }
  return parsed;
}

function isRemoteFile(value: unknown): value is RemoteFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Record<string, unknown>;
  return (
    file.version === 2 &&
    file.storage === "webdav" &&
    typeof file.relativePath === "string" &&
    typeof file.publicUrl === "string" &&
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
