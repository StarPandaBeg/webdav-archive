import type { TFile } from "obsidian";

export interface WebDavArchiveApi {
  resolve(remoteFile: TFile): Promise<{ url: string }>;
  isPreviewEnabled(): boolean;
}
