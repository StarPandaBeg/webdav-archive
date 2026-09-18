import { Plugin } from "obsidian";

export default class WebDavArchivePlugin extends Plugin {
  async onload(): Promise<void> {
    // Plugin features will be added here.
  }

  onunload(): void {
    // Resources registered through the Obsidian API are disposed automatically.
  }
}

