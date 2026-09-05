import { Platform } from "obsidian";

interface DesktopShell {
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
}

function getDesktopShell(): DesktopShell {
  if (!Platform.isDesktopApp) {
    throw new Error("External applications are available only in Obsidian desktop.");
  }

  return (require("electron") as { shell: DesktopShell }).shell;
}

export async function openExternalFile(absolutePath: string): Promise<void> {
  const error = await getDesktopShell().openPath(absolutePath);
  if (error) {
    throw new Error(error);
  }
}

export async function openExternalUri(uri: string): Promise<void> {
  await getDesktopShell().openExternal(uri);
}
