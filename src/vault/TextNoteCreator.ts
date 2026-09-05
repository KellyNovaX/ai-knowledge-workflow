import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { join } from "path";

const TXT_EXTENSION = ".txt";

export interface TextNoteCreateRequest {
  target: TAbstractFile;
  fileName: string;
}

export interface TextNoteCreateResult {
  vaultPath: string;
  absolutePath: string;
  openError?: string;
}

export class TextNoteCreator {
  constructor(private readonly app: App) {}

  async createAndOpen(request: TextNoteCreateRequest): Promise<TextNoteCreateResult> {
    const fileName = normalizeTxtFileName(request.fileName);
    const folderPath = resolveTargetFolderPath(request.target);
    const vaultPath = normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);

    if (await this.app.vault.adapter.exists(vaultPath)) {
      throw new Error(`File already exists: ${vaultPath}`);
    }

    const absolutePath = this.resolveAbsolutePath(vaultPath);
    const file = await this.app.vault.create(vaultPath, "");
    let openError: string | undefined;

    try {
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      openError = error instanceof Error ? error.message : String(error);
    }

    return {
      vaultPath,
      absolutePath,
      openError
    };
  }

  private resolveAbsolutePath(vaultPath: string): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("Vault root path is unavailable.");
    }

    return join(basePath, vaultPath);
  }
}

export function normalizeTxtFileName(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("File name is required.");
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("File name cannot contain path separators.");
  }

  if (trimmed === "." || trimmed === "..") {
    throw new Error("File name is invalid.");
  }

  return trimmed.toLowerCase().endsWith(TXT_EXTENSION) ? trimmed : `${trimmed}${TXT_EXTENSION}`;
}

function resolveTargetFolderPath(target: TAbstractFile): string {
  if (target instanceof TFolder) {
    return target.path;
  }

  if (target instanceof TFile) {
    return parentPath(target.path);
  }

  return "";
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
