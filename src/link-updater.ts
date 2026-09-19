import { App, TFile } from "obsidian";

const WIKILINK_REGEX = /(!?\[\[)([^\]|#\r\n]+)(#[^\]|\r\n]*)?(\|[^\]\r\n]*)?(\]\])/g;
const MARKDOWN_LINK_REGEX = /(!?\[([^\]\r\n]*)\]\()([^\)\s#]+)(#[^\)\s]*)?(\s+[^\)]+)?(\))/g;

/**
 * Finds all internal links pointing to the target file and updates them from
 * `[[originalFile]]` to `[[originalFile.remote]]`.
 */
export async function updateLinksForArchive(app: App, targetFile: TFile): Promise<void> {
  const targetPath = targetFile.path;
  const targetName = targetFile.name;
  const referringFiles = getReferringFiles(app, targetPath, targetName);

  for (const file of referringFiles) {
    await updateLinksInFile(
      app,
      file,
      (linkpath) => isTargetMatch(app, linkpath, file.path, targetPath, targetName),
      (linkpath) => `${linkpath}.remote`,
    );
  }
}

/**
 * Finds all internal links pointing to the remote marker file and updates them from
 * `[[originalFile.remote]]` back to `[[originalFile]]`.
 */
export async function updateLinksForRestore(
  app: App,
  markerFile: TFile,
  _originalPath: string,
): Promise<void> {
  const targetPath = markerFile.path;
  const targetName = markerFile.name;
  const referringFiles = getReferringFiles(app, targetPath, targetName);

  for (const file of referringFiles) {
    await updateLinksInFile(
      app,
      file,
      (linkpath) => isTargetMatch(app, linkpath, file.path, targetPath, targetName),
      (linkpath) => (linkpath.endsWith(".remote") ? linkpath.slice(0, -".remote".length) : linkpath),
    );
  }
}

/**
 * Retrieves markdown files that link to targetPath using Obsidian's resolvedLinks and unresolvedLinks caches.
 */
export function getReferringFiles(app: App, targetPath: string, targetName: string): TFile[] {
  const filesMap = new Map<string, TFile>();

  const resolved = app.metadataCache.resolvedLinks;
  if (resolved) {
    for (const [sourcePath, links] of Object.entries(resolved)) {
      if (links && links[targetPath] && links[targetPath] > 0) {
        const file = app.vault.getAbstractFileByPath(sourcePath);
        if (file instanceof TFile && file.extension === "md") {
          filesMap.set(file.path, file);
        }
      }
    }
  }

  const unresolved = app.metadataCache.unresolvedLinks;
  if (unresolved) {
    for (const [sourcePath, links] of Object.entries(unresolved)) {
      if (links && (links[targetPath] || links[targetName])) {
        const file = app.vault.getAbstractFileByPath(sourcePath);
        if (file instanceof TFile && file.extension === "md") {
          filesMap.set(file.path, file);
        }
      }
    }
  }

  return Array.from(filesMap.values());
}

/**
 * Updates links in a single file: frontmatter via `app.fileManager.processFrontMatter`
 * and document body via `app.vault.process`.
 */
export async function updateLinksInFile(
  app: App,
  file: TFile,
  shouldReplace: (linkpath: string) => boolean,
  getReplacement: (linkpath: string) => string,
): Promise<void> {
  const cache = app.metadataCache.getFileCache(file);
  const hasFrontmatter = Boolean(cache?.frontmatter);

  if (hasFrontmatter) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      updateLinksInFrontmatter(frontmatter, shouldReplace, getReplacement);
    });
  }

  await app.vault.process(file, (content) => {
    const bodyOffset = getBodyOffset(content);
    const frontmatterPart = content.slice(0, bodyOffset);
    const bodyPart = content.slice(bodyOffset);

    const { content: newBodyPart, changed } = replaceLinksInMarkdown(bodyPart, shouldReplace, getReplacement);
    if (!changed) {
      return content;
    }
    return frontmatterPart + newBodyPart;
  });
}

/**
 * Recursively updates links in the YAML frontmatter object.
 */
export function updateLinksInFrontmatter(
  obj: unknown,
  shouldReplace: (linkpath: string) => boolean,
  getReplacement: (linkpath: string) => string,
): boolean {
  let changed = false;
  if (!obj || typeof obj !== "object") return false;

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === "string") {
      const cleanVal = val.trim();
      // Check if it's a raw matching link or contains wikilinks/markdown links
      if (shouldReplace(cleanVal)) {
        record[key] = getReplacement(cleanVal);
        changed = true;
      } else {
        const { content: updated, changed: strChanged } = replaceLinksInMarkdown(val, shouldReplace, getReplacement);
        if (strChanged) {
          record[key] = updated;
          changed = true;
        }
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (typeof item === "string") {
          const cleanItem = item.trim();
          if (shouldReplace(cleanItem)) {
            val[i] = getReplacement(cleanItem);
            changed = true;
          } else {
            const { content: updated, changed: itemChanged } = replaceLinksInMarkdown(item, shouldReplace, getReplacement);
            if (itemChanged) {
              val[i] = updated;
              changed = true;
            }
          }
        } else if (item && typeof item === "object") {
          if (updateLinksInFrontmatter(item, shouldReplace, getReplacement)) {
            changed = true;
          }
        }
      }
    } else if (typeof val === "object") {
      if (updateLinksInFrontmatter(val, shouldReplace, getReplacement)) {
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Replaces wikilinks and markdown links in a markdown text chunk.
 */
export function replaceLinksInMarkdown(
  text: string,
  shouldReplace: (linkpath: string) => boolean,
  getReplacement: (linkpath: string) => string,
): { content: string; changed: boolean } {
  let changed = false;

  // 1. Replace Wikilinks: !?[[path#subpath|alias]]
  let result = text.replace(WIKILINK_REGEX, (fullMatch, prefix, linkpath, subpath, alias, suffix) => {
    const cleanLinkpath = String(linkpath).trim();
    if (shouldReplace(cleanLinkpath)) {
      changed = true;
      const newLinkpath = getReplacement(cleanLinkpath);
      return `${prefix}${newLinkpath}${subpath || ""}${alias || ""}${suffix}`;
    }
    return fullMatch;
  });

  // 2. Replace Markdown links: !?[text](path#subpath "title")
  result = result.replace(MARKDOWN_LINK_REGEX, (fullMatch, prefix, textPart, linkpath, subpath, titlePart, suffix) => {
    const rawLinkpath = String(linkpath).trim();
    let decoded = rawLinkpath;
    try {
      decoded = decodeURI(rawLinkpath);
    } catch {
      // ignore decode error
    }

    if (shouldReplace(decoded)) {
      changed = true;
      const newLinkpath = getReplacement(decoded);
      const encoded = rawLinkpath !== decoded ? encodeURI(newLinkpath) : newLinkpath;
      return `${prefix}${encoded}${subpath || ""}${titlePart || ""}${suffix}`;
    }
    return fullMatch;
  });

  return { content: result, changed };
}

/**
 * Checks if a link text resolves or matches the target file path/name.
 */
export function isTargetMatch(
  app: App,
  linkpath: string,
  sourcePath: string,
  targetPath: string,
  targetName: string,
): boolean {
  const cleanLinkpath = linkpath.trim();
  if (!cleanLinkpath) return false;

  // Direct exact match by path or filename
  if (cleanLinkpath === targetPath || cleanLinkpath === targetName) {
    return true;
  }

  // Normalized path match
  if (cleanLinkpath.endsWith("/" + targetName)) {
    const norm = cleanLinkpath.replace(/\\/g, "/");
    if (norm === targetPath || targetPath.endsWith("/" + norm)) {
      return true;
    }
  }

  // Check using Obsidian's getFirstLinkpathDest
  try {
    const dest = app.metadataCache.getFirstLinkpathDest(cleanLinkpath, sourcePath);
    if (dest && dest.path === targetPath) {
      return true;
    }
  } catch {
    // getFirstLinkpathDest may fail if link is malformed
  }

  return false;
}

/**
 * Calculates character offset where the frontmatter ends and document body begins.
 */
export function getBodyOffset(content: string): number {
  if (!content.startsWith("---")) return 0;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n)?/);
  return match ? match[0].length : 0;
}
