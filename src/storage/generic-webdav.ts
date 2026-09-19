import { BaseWebDavStorageProvider } from "./base-webdav";
import type { StorageType } from "./types";
import {
  appendRelativePath,
  normalizedBasePath,
  parseHttpUrl,
  utf8Base64,
  validateRelativePath,
} from "./transfer";
import { t } from "../i18n";

export interface GenericWebDavConfig {
  webDavUrl: string;
  publicUrl: string;
  username: string;
  password: string;
}

export class GenericWebDavProvider extends BaseWebDavStorageProvider {
  readonly storageType: StorageType = "webdav";

  constructor(private readonly config: GenericWebDavConfig) {
    super();
  }

  validateConfiguration(options?: { requirePublicUrl?: boolean }): void {
    const requirePublicUrl = options?.requirePublicUrl ?? true;
    this.webDavBaseUrl();
    if (requirePublicUrl) {
      this.publicBaseUrl();
    }
  }

  async getFileUrl(relativePath: string, _forceRefresh?: boolean): Promise<string> {
    return this.publicUrl(relativePath);
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

  protected webDavUrl(relativePath: string): string {
    return appendRelativePath(this.webDavBaseUrl(), relativePath);
  }

  protected authorizationHeaders(): Record<string, string> {
    if (!this.config.username && !this.config.password) {
      return {};
    }
    return { Authorization: `Basic ${utf8Base64(`${this.config.username}:${this.config.password}`)}` };
  }

  private publicUrl(relativePath: string): string {
    return appendRelativePath(this.publicBaseUrl(), relativePath);
  }

  private webDavBaseUrl(): URL {
    if (!this.config.webDavUrl.trim()) {
      throw new Error(t("error.configureWebDavUrl"));
    }

    const url = parseHttpUrl(this.config.webDavUrl.trim(), t("error.invalidWebDavUrl"));
    if (url.username || url.password) {
      throw new Error(t("error.credentialsInUrl"));
    }
    return url;
  }

  private publicBaseUrl(): URL {
    if (!this.config.publicUrl.trim()) {
      throw new Error(t("error.configurePublicUrl"));
    }
    const url = parseHttpUrl(this.config.publicUrl.trim(), t("error.invalidPublicUrl"));
    if (url.username || url.password) {
      throw new Error(t("error.publicCredentials"));
    }
    return url;
  }
}
