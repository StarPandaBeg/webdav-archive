import { requestUrl } from "obsidian";
import { BaseWebDavStorageProvider } from "./base-webdav";
import type { StorageType } from "./types";
import {
  normalizedBasePath,
  parseHttpUrl,
  utf8Base64,
  validateRelativePath,
} from "./transfer";
import { t } from "../i18n";

export interface NextcloudConfig {
  nextcloudUrl: string;
  username: string;
  password: string;
}

interface CachedDirectUrl {
  url: string;
  expiresAt: number;
}

/** Cache direct URLs for 6 hours (Nextcloud direct download tokens typically last 8 hours). */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class NextcloudStorageProvider extends BaseWebDavStorageProvider {
  readonly storageType: StorageType = "nextcloud";
  private readonly directUrlCache = new Map<string, CachedDirectUrl>();

  constructor(private readonly config: NextcloudConfig) {
    super();
  }

  validateConfiguration(): void {
    this.nextcloudBaseUrl();
    if (!this.config.username.trim()) {
      throw new Error(t("error.configureNextcloudUser"));
    }
  }

  async getFileUrl(relativePath: string, forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.directUrlCache.get(relativePath);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.url;
      }
    }

    const fileId = await this.fetchFileId(relativePath);
    const directUrl = await this.requestDirectUrl(fileId);

    this.directUrlCache.set(relativePath, {
      url: directUrl,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return directUrl;
  }

  override async delete(relativePath: string): Promise<void> {
    await super.delete(relativePath);
    this.directUrlCache.delete(relativePath);
  }

  relativePathFromLegacyUrl(remoteUrl: string): string {
    const base = this.nextcloudBaseUrl();
    const cleanBase = normalizedBasePath(base);
    const username = encodeURIComponent(this.config.username.trim());
    const prefix = cleanBase
      ? `${cleanBase}/remote.php/dav/files/${username}/`
      : `/remote.php/dav/files/${username}/`;

    const remote = parseHttpUrl(remoteUrl, t("error.invalidLegacyUrl"));
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

  protected webDavUrl(relativePath: string): string {
    const base = this.nextcloudBaseUrl();
    const cleanBase = normalizedBasePath(base);
    const username = encodeURIComponent(this.config.username.trim());
    const segments = validateRelativePath(relativePath).split("/").map(encodeURIComponent);
    const pathPrefix = cleanBase
      ? `${cleanBase}/remote.php/dav/files/${username}`
      : `/remote.php/dav/files/${username}`;
    base.pathname = `${pathPrefix}/${segments.join("/")}`;
    base.search = "";
    base.hash = "";
    return base.toString();
  }

  protected authorizationHeaders(): Record<string, string> {
    if (!this.config.username && !this.config.password) {
      return {};
    }
    return { Authorization: `Basic ${utf8Base64(`${this.config.username}:${this.config.password}`)}` };
  }

  private async fetchFileId(relativePath: string): Promise<string> {
    const url = this.webDavUrl(relativePath);
    const response = await requestUrl({
      url,
      method: "PROPFIND",
      headers: {
        ...this.authorizationHeaders(),
        Depth: "0",
        "Content-Type": "application/xml",
      },
      body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:fileid />
  </d:prop>
</d:propfind>`,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(t("error.propfind", { status: response.status }));
    }

    const match = response.text.match(/<(?:\w+:)?fileid[^>]*>\s*(\d+)\s*<\/(?:\w+:)?fileid>/i);
    if (!match || !match[1]) {
      throw new Error(t("error.nextcloudFileIdNotFound"));
    }

    return match[1];
  }

  private async requestDirectUrl(fileId: string): Promise<string> {
    const base = this.nextcloudBaseUrl();
    const cleanBase = normalizedBasePath(base);
    const path = cleanBase
      ? `${cleanBase}/ocs/v2.php/apps/dav/api/v1/direct`
      : `/ocs/v2.php/apps/dav/api/v1/direct`;
    const directEndpoint = new URL(base.toString());
    directEndpoint.pathname = path;
    directEndpoint.search = "?format=json";
    directEndpoint.hash = "";

    const response = await requestUrl({
      url: directEndpoint.toString(),
      method: "POST",
      headers: {
        ...this.authorizationHeaders(),
        "OCS-APIRequest": "true",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `fileId=${encodeURIComponent(fileId)}`,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(t("error.nextcloudDirectUrlStatus", { status: response.status }));
    }

    let parsed: unknown;
    try {
      parsed = response.json ?? JSON.parse(response.text);
    } catch {
      throw new Error(t("error.nextcloudDirectUrl"));
    }

    const record = parsed as Record<string, any>;
    const directUrl = record?.ocs?.data?.url ?? record?.data?.url ?? record?.url;
    if (typeof directUrl !== "string" || !directUrl.trim()) {
      throw new Error(t("error.nextcloudDirectUrl"));
    }

    return new URL(directUrl.trim(), base).toString();
  }

  private nextcloudBaseUrl(): URL {
    if (!this.config.nextcloudUrl.trim()) {
      throw new Error(t("error.configureNextcloudUrl"));
    }
    const url = parseHttpUrl(this.config.nextcloudUrl.trim(), t("error.invalidNextcloudUrl"));
    if (url.username || url.password) {
      throw new Error(t("error.credentialsInUrl"));
    }
    return url;
  }
}
