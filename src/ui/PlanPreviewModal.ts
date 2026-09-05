import { App, Modal, Setting } from "obsidian";
import { PLAN_ACTION_LABELS } from "../constants";
import {
  PlanExecutionOperation,
  PlanExecutionPreview
} from "../plans/PlanExecutor";
import { WorkflowPlan } from "../types";

export enum PlanPreviewDecision {
  Back = "back",
  Confirm = "confirm",
  Cancel = "cancel"
}

export interface PlanPreviewOptions {
  canGoBack?: boolean;
}

export class PlanPreviewModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly plan: WorkflowPlan,
    private readonly preview: PlanExecutionPreview,
    private readonly resolveDecision: (decision: PlanPreviewDecision) => void,
    private readonly options: PlanPreviewOptions = {}
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Plan Preview" });

    contentEl.createEl("p", {
      text: `Action: ${this.plan.action ? PLAN_ACTION_LABELS[this.plan.action] : "(none)"}`
    });
    contentEl.createEl("p", { text: `Reason: ${this.plan.reason ?? "(none)"}` });

    this.renderOperations(contentEl, this.preview.operations);
    this.renderList(contentEl, "Warnings", this.preview.warnings);
    this.renderList(contentEl, "Blocking reasons", this.preview.blockers.map((blocker) => blocker.message));

    const footer = new Setting(contentEl);

    if (this.options.canGoBack) {
      footer.addButton((button) => {
        button
          .setButtonText("Back")
          .onClick(() => {
            this.finish(PlanPreviewDecision.Back);
          });
      });
    }

    footer
      .addButton((button) => {
        button
          .setButtonText("Cancel")
          .onClick(() => {
            this.finish(PlanPreviewDecision.Cancel);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Confirm Execute")
          .setCta()
          .setDisabled(!this.preview.canExecute)
          .onClick(() => {
            this.finish(PlanPreviewDecision.Confirm);
          });
      });
  }

  onClose(): void {
    if (!this.settled) {
      this.resolveDecision(PlanPreviewDecision.Cancel);
      this.settled = true;
    }

    this.contentEl.empty();
  }

  private renderOperations(container: HTMLElement, operations: PlanExecutionOperation[]): void {
    container.createEl("h3", { text: "Dry-run operations" });

    if (operations.length === 0) {
      container.createEl("p", { text: "(none)" });
      return;
    }

    const list = container.createEl("ul");
    for (const operation of operations) {
      list.createEl("li", {
        text: `${operation.kind}: ${operation.detail}`
      });
    }
  }

  private renderList(container: HTMLElement, title: string, items: string[]): void {
    container.createEl("h3", { text: title });

    if (items.length === 0) {
      container.createEl("p", { text: "(none)" });
      return;
    }

    const list = container.createEl("ul");
    for (const item of items) {
      list.createEl("li", { text: item });
    }
  }

  private finish(decision: PlanPreviewDecision): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveDecision(decision);
    this.close();
  }
}

export function showPlanPreview(
  app: App,
  plan: WorkflowPlan,
  preview: PlanExecutionPreview,
  options: PlanPreviewOptions = {}
): Promise<PlanPreviewDecision> {
  return new Promise((resolve) => {
    new PlanPreviewModal(app, plan, preview, resolve, options).open();
  });
}
