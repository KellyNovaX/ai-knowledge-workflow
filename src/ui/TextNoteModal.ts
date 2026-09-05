import { App, Modal, Setting } from "obsidian";

export enum TextNoteModalResultKind {
  Cancelled = "cancelled",
  Submitted = "submitted"
}

export interface TextNoteModalResult {
  kind: TextNoteModalResultKind;
  fileName: string;
}

export class TextNoteNameModal extends Modal {
  private fileName = "";
  private resolved = false;

  constructor(
    app: App,
    private readonly resolveResult: (result: TextNoteModalResult) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "新建 txt 笔记" });

    new Setting(contentEl)
      .setName("文件名称")
      .setDesc("输入文件名；不需要后缀时会自动补全 .txt。")
      .addText((text) => {
        text
          .setPlaceholder("note.txt")
          .setValue(this.fileName)
          .onChange((value) => {
            this.fileName = value;
          });

        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("取消")
          .onClick(() => {
            this.finish(TextNoteModalResultKind.Cancelled);
          })
      )
      .addButton((button) =>
        button
          .setButtonText("创建")
          .setCta()
          .onClick(() => {
            this.finish(TextNoteModalResultKind.Submitted);
          })
      );
  }

  onClose(): void {
    this.finish(TextNoteModalResultKind.Cancelled, false);
  }

  private finish(kind: TextNoteModalResultKind, closeModal = true): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    const fileName = kind === TextNoteModalResultKind.Submitted ? this.fileName : "";
    this.resolveResult({ kind, fileName });

    if (closeModal) {
      this.close();
    }
  }
}

export function askTextNoteName(app: App): Promise<TextNoteModalResult> {
  return new Promise((resolve) => {
    new TextNoteNameModal(app, resolve).open();
  });
}
