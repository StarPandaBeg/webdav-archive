import { Platform, requestUrl } from "obsidian";
import type { WebDavArchiveSettings } from "./settings";
import { t } from "./i18n";

export interface UploadedObject {
  relativePath: string;
  fileUrl: string;
}

export type TransferProgress = (transferredBytes: number, totalBytes: number | null) => void;

interface TransferResponse {
  status: number;
  arrayBuffer: ArrayBuffer;
}

export class WebDavClient {
  constructor(private readonly settings: WebDavArchiveSettings) {}

  validateConfiguration(requirePublicUrl = true): void {
    this.webDavBaseUrl();
    if (requirePublicUrl) {
      this.publicBaseUrl();
    }
  }

  async upload(data: ArrayBuffer, mimeType: string, onProgress?: TransferProgress): Promise<UploadedObject> {
    const relativePath = createUuid();
    const webDavUrl = this.webDavUrl(relativePath);
    const response = await transferRequest(
      "PUT",
      webDavUrl,
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
        url: webDavUrl,
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

    return {
      relativePath,
      fileUrl: this.publicUrl(relativePath),
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

  relativePathFromLegacyUrl(remoteUrl: string): string {
    const base = this.webDavBaseUrl();
    const remote = parseHttpUrl(remoteUrl, t("error.invalidLegacyUrl"));
    const basePath = normalizedBasePath(base);
    const prefix = basePath ? `${basePath}/` : "/";

    if (remote.origin !== base.origin || !remote.pathname.startsWith(prefix)) {
      throw new Error(t("error.untrustedLegacyUrl"));
    }

    const encodedPath = remote.pathname.slice(prefix.length);
    return validateRelativePath(
      encodedPath
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/"),
    );
  }

  private webDavUrl(relativePath: string): string {
    return appendRelativePath(this.webDavBaseUrl(), relativePath);
  }

  private publicUrl(relativePath: string): string {
    return appendRelativePath(this.publicBaseUrl(), relativePath);
  }

  private webDavBaseUrl(): URL {
    if (!this.settings.webDavUrl.trim()) {
      throw new Error(t("error.configureWebDavUrl"));
    }

    const url = parseHttpUrl(this.settings.webDavUrl.trim(), t("error.invalidWebDavUrl"));
    if (url.username || url.password) {
      throw new Error(t("error.credentialsInUrl"));
    }
    return url;
  }

  private publicBaseUrl(): URL {
    if (!this.settings.publicUrl.trim()) {
      throw new Error(t("error.configurePublicUrl"));
    }
    const url = parseHttpUrl(this.settings.publicUrl.trim(), t("error.invalidPublicUrl"));
    if (url.username || url.password) {
      throw new Error(t("error.publicCredentials"));
    }
    return url;
  }

  private authorizationHeaders(): Record<string, string> {
    if (!this.settings.username && !this.settings.password) {
      return {};
    }
    return { Authorization: `Basic ${utf8Base64(`${this.settings.username}:${this.settings.password}`)}` };
  }
}

async function transferRequest(
  method: "GET" | "PUT",
  url: string,
  headers: Record<string, string>,
  body?: ArrayBuffer,
  onUploadProgress?: TransferProgress,
  onDownloadProgress?: TransferProgress,
): Promise<TransferResponse> {
  return Platform.isDesktopApp
    ? nodeTransferRequest(method, url, headers, body, onUploadProgress, onDownloadProgress)
    : xhrTransferRequest(method, url, headers, body, onUploadProgress, onDownloadProgress);
}

function nodeTransferRequest(
  method: "GET" | "PUT",
  urlValue: string,
  headers: Record<string, string>,
  body?: ArrayBuffer,
  onUploadProgress?: TransferProgress,
  onDownloadProgress?: TransferProgress,
): Promise<TransferResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    // Loaded lazily because Node built-ins are unavailable in Obsidian Mobile.
    const transport = url.protocol === "https:"
      ? require("node:https") as typeof import("node:https")
      : require("node:http") as typeof import("node:http");
    const request = transport.request(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      const totalBytes = parseContentLength(response.headers["content-length"]);

      response.on("data", (chunk: Buffer | Uint8Array) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        receivedBytes += buffer.byteLength;
        onDownloadProgress?.(receivedBytes, totalBytes);
      });
      response.on("end", () => {
        const result = Buffer.concat(chunks);
        onDownloadProgress?.(receivedBytes, totalBytes);
        resolve({
          status: response.statusCode ?? 0,
          arrayBuffer: result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength),
        });
      });
      response.on("error", reject);
    });

    request.on("error", reject);
    if (!body) {
      request.end();
      return;
    }

    const totalBytes = body.byteLength;
    const chunkSize = 256 * 1024;
    let sentBytes = 0;
    onUploadProgress?.(0, totalBytes);

    const writeNextChunk = (): void => {
      if (sentBytes >= totalBytes) {
        request.end();
        return;
      }
      const nextOffset = Math.min(sentBytes + chunkSize, totalBytes);
      const chunk = Buffer.from(body, sentBytes, nextOffset - sentBytes);
      request.write(chunk, () => {
        sentBytes = nextOffset;
        onUploadProgress?.(sentBytes, totalBytes);
        writeNextChunk();
      });
    };

    if (totalBytes === 0) {
      onUploadProgress?.(0, 0);
      request.end();
    } else {
      writeNextChunk();
    }
  });
}

function xhrTransferRequest(
  method: "GET" | "PUT",
  url: string,
  headers: Record<string, string>,
  body?: ArrayBuffer,
  onUploadProgress?: TransferProgress,
  onDownloadProgress?: TransferProgress,
): Promise<TransferResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = "arraybuffer";
    for (const [name, value] of Object.entries(headers)) {
      // Browsers calculate Content-Length themselves and do not allow setting it.
      if (name.toLowerCase() !== "content-length") xhr.setRequestHeader(name, value);
    }

    xhr.upload.addEventListener("progress", (event) => {
      onUploadProgress?.(event.loaded, body?.byteLength ?? (event.lengthComputable ? event.total : null));
    });
    xhr.addEventListener("progress", (event) => {
      const totalBytes = parseContentLength(xhr.getResponseHeader("Content-Length"))
        ?? (event.lengthComputable ? event.total : null);
      onDownloadProgress?.(event.loaded, totalBytes);
    });
    xhr.addEventListener("load", () => {
      const result = xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0);
      const totalBytes = parseContentLength(xhr.getResponseHeader("Content-Length"));
      onDownloadProgress?.(result.byteLength, totalBytes);
      if (body) onUploadProgress?.(body.byteLength, body.byteLength);
      resolve({ status: xhr.status, arrayBuffer: result });
    });
    xhr.addEventListener("error", () => reject(new Error(t("error.network"))));
    xhr.addEventListener("abort", () => reject(new Error(t("error.network"))));
    xhr.send(body ?? null);
  });
}

function parseContentLength(value: string | string[] | null | undefined): number | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === null || normalized === undefined || normalized.trim() === "") return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function appendRelativePath(base: URL, relativePath: string): string {
  const segments = validateRelativePath(relativePath).split("/").map(encodeURIComponent);
  base.pathname = `${normalizedBasePath(base)}/${segments.join("/")}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function normalizedBasePath(url: URL): string {
  return url.pathname.replace(/\/+$/, "");
}

function validateRelativePath(value: string): string {
  const segments = value.split("/");
  if (!value || value.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(t("error.invalidRemotePath"));
  }
  return value;
}

function parseHttpUrl(value: string, errorMessage: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorMessage);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(errorMessage);
  }
  return url;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function createUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
