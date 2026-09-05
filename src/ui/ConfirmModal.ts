import { App, Modal, Setting } from "obsidian";

export enum ConfirmDecision {
  Confirm = "confirm",
  Cancel = "cancel"
}

export function confirmAction(
  app: App,
  title: string,
  message: string,
  confirmLabel = "确认"
): Promise<ConfirmDecision> {
  return new Promise((resolve) => {
    new ConfirmModal(app, title, message, confirmLabel, resolve).open();
  });
}

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly resolveDecision: (decision: ConfirmDecision) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.title });
    this.contentEl.createEl("p", { text: this.message });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("取消")
          .onClick(() => this.finish(ConfirmDecision.Cancel))
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmLabel)
          .setWarning()
          .onClick(() => this.finish(ConfirmDecision.Confirm))
      );
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveDecision(ConfirmDecision.Cancel);
    }

    this.contentEl.empty();
  }

  private finish(decision: ConfirmDecision): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveDecision(decision);
    this.close();
  }
}
