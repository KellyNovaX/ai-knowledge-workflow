import { Platform } from "obsidian";
import { spawn } from "child_process";
import { statSync } from "fs";

export interface KcworkLaunchRequest {
  absoluteWorkspacePath: string;
}

export async function openKcworkForFile(request: KcworkLaunchRequest): Promise<void> {
  if (!Platform.isMacOS) {
    throw new Error("KCwork opening is available only on macOS.");
  }

  try {
    if (!statSync(request.absoluteWorkspacePath).isDirectory()) {
      throw new Error("Workspace path is not a folder.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KCwork workspace is unavailable: ${message}`);
  }

  await navigator.clipboard.writeText(request.absoluteWorkspacePath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("open", ["-a", "KCwork"], { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `KCwork launch exited with code ${code ?? "unknown"}.`));
    });
  });
}
