import { App, Modal, Notice, Platform, Setting } from "obsidian";
import { spawn } from "child_process";
import { statSync } from "fs";

export interface KcworkLaunchRequest {
  absoluteWorkspacePath: string;
  fileReference: string;
}

class KcworkHandoffModal extends Modal {
  constructor(app: App, private readonly request: KcworkLaunchRequest) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "在 KCwork 中继续" });
    contentEl.createEl("p", {
      text: "工作目录已复制。请在 KCwork 新建会话，选择「在项目中工作」，粘贴目录路径并确认。然后返回这里复制文件引用，在 KCwork 中通过 @ 菜单选中对应文件。"
    });

    new Setting(contentEl)
      .setName("工作目录")
      .setDesc(this.request.absoluteWorkspacePath)
      .addButton((button) => button.setButtonText("复制目录").onClick(() => {
        void this.copy(this.request.absoluteWorkspacePath, "工作目录已复制");
      }));

    new Setting(contentEl)
      .setName("文件引用")
      .setDesc(`@${this.request.fileReference}`)
      .addButton((button) => button.setButtonText("复制引用").onClick(() => {
        void this.copy(`@${this.request.fileReference}`, "文件引用已复制");
      }));
  }

  private async copy(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      new Notice(successMessage);
    } catch (error) {
      new Notice("复制失败，请手动选择上方文字");
      console.error("AI Knowledge: Copy KCwork handoff failed", error);
    }
  }
}

export async function openKcworkForFile(app: App, request: KcworkLaunchRequest): Promise<void> {
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

  const modal = new KcworkHandoffModal(app, request);
  modal.open();

  try {
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
  } catch (error) {
    modal.close();
    throw error;
  }
}
