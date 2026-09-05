import { App } from "obsidian";

export interface LocalMarkdownLink {
  rawTarget: string;
  target: string;
  line: number;
  wiki: boolean;
}

export function resolveLocalLinkTarget(rawTarget: string, sourcePath: string, wiki = false): string | null {
  let target = rawTarget.trim().replace(/^<|>$/g, "");
  if (!target) return null;
  target = target.split("#", 1)[0];
  if (!target) return sourcePath;
  try { target = decodeURIComponent(target); } catch { /* Keep literal malformed escapes. */ }
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/") || /[<>{}]/.test(target)) return null;
  target = target.replace(/\\([ ()])/g, "$1");
  const parts = wiki && !target.startsWith(".") ? [] : sourcePath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function extractLocalMarkdownLinks(content: string, sourcePath: string): LocalMarkdownLink[] {
  let fence: string | null = null;
  const lines = content.split(/\r?\n/).map((line) => {
    const marker = line.match(/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") fence = null;
      return "";
    }
    return fence ? "" : line.replace(/(`+)([^`]|(?!\1)`)*\1/g, "");
  });
  const definitions = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/);
    if (match) definitions.set(match[1].toLowerCase(), match[2]);
  }
  const links: LocalMarkdownLink[] = [];
  const append = (rawTarget: string, line: number, wiki: boolean) => {
    const target = resolveLocalLinkTarget(rawTarget, sourcePath, wiki);
    if (target) links.push({ rawTarget, target, line, wiki });
  };
  lines.forEach((line, index) => {
    if (/^\s*\[[^\]]+\]:/.test(line)) return;
    for (const match of line.matchAll(/\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g)) append(match[1], index + 1, true);
    const markdown = line.replace(/\[\[[\s\S]*?\]\]/g, "");
    for (const match of markdown.matchAll(/\[([^\]]+)\](?:\((<[^>]+>|(?:\\.|[^()\s]|\([^()]*\))+)(?:\s+["'][^"']*["'])?\)|\[([^\]]*)\])/g)) {
      const target = match[2] ?? definitions.get((match[3] || match[1]).toLowerCase());
      if (target) append(target, index + 1, false);
    }
  });
  return links;
}

export async function findLocalLinkTarget(app: App, link: LocalMarkdownLink, sourcePath: string): Promise<string | null> {
  if (await app.vault.adapter.exists(link.target)) return link.target;
  if (!/\.[^/]+$/.test(link.target) && await app.vault.adapter.exists(`${link.target}.md`)) return `${link.target}.md`;
  if (link.wiki) {
    const resolved = app.metadataCache.getFirstLinkpathDest(link.rawTarget.split("#", 1)[0], sourcePath);
    if (resolved) return resolved.path;
  }
  return null;
}
