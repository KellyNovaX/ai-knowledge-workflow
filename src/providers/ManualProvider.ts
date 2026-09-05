import { App, Modal, Setting } from "obsidian";
import { ModelProvider, ModelProviderRequest } from "./ModelProvider";

export class ManualProvider implements ModelProvider {
  constructor(private readonly app: App) {}

  async generatePlanJson(request: ModelProviderRequest): Promise<string | null> {
    return new Promise((resolve) => {
      new ManualPlanModal(this.app, request, resolve).open();
    });
  }
}

class ManualPlanModal extends Modal {
  private planJson = "";
  private settled = false;

  constructor(
    app: App,
    private readonly request: ModelProviderRequest,
    private readonly resolvePlan: (planJson: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manual Plan" });

    const contextEl = contentEl.createDiv();
    contextEl.createEl("p", { text: `Inbox file: ${this.request.inboxFile.path}` });

    if (this.request.answers.length > 0) {
      contextEl.createEl("h3", { text: "User answers" });
      const list = contextEl.createEl("ul");
      for (const answer of this.request.answers) {
        list.createEl("li", {
          text: `${answer.field}: ${answer.answer}`
        });
      }
    }

    const previewEl = contentEl.createEl("details");
    previewEl.createEl("summary", { text: "Inbox preview" });
    previewEl.createEl("pre", { text: this.request.inboxFile.contentPreview || "(no text preview)" });

    new Setting(contentEl).setName("Plan JSON").setDesc("Paste a complete plan JSON. Manual mode does not call a model.");

    const textarea = contentEl.createEl("textarea");
    textarea.style.width = "100%";
    textarea.style.height = "320px";
    textarea.value = this.planJson;
    textarea.addEventListener("input", () => {
      this.planJson = textarea.value;
    });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Cancel")
          .onClick(() => {
            this.finish(null);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Use Plan")
          .setCta()
          .onClick(() => {
            this.finish(this.planJson);
          });
      });
  }

  onClose(): void {
    if (!this.settled) {
      this.resolvePlan(null);
      this.settled = true;
    }

    this.contentEl.empty();
  }

  private finish(planJson: string | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolvePlan(planJson);
    this.close();
  }
}
