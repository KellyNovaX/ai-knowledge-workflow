import { TFile } from "obsidian";

export const INBOX_ROOT_PATH = "80-inbox/";

const INBOX_RULE_FILE_PATHS = new Set(["80-inbox/AGENTS.md"]);

export function isProcessableInboxPath(path: string): boolean {
  return path.startsWith(INBOX_ROOT_PATH) && !INBOX_RULE_FILE_PATHS.has(path);
}

export function isProcessableInboxFile(file: TFile): boolean {
  return isProcessableInboxPath(file.path);
}
