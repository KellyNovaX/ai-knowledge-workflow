import { App, TFile } from "obsidian";
import { join } from "path";
import { openExternalFile } from "./ExternalAppOpener";

export class DefaultAppOpener {
  constructor(private readonly app: App) {}

  async openFile(file: TFile): Promise<string> {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("Vault root path is unavailable.");
    }

    const absolutePath = join(basePath, file.path);
    await openExternalFile(absolutePath);
    return absolutePath;
  }
}
