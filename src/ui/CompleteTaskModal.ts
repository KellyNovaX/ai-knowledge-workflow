import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";
import {
  CompletableTask,
  TaskCompletionPreview
} from "../vault/TaskCompleter";

export enum CompleteTaskDecision {
  Confirm = "confirm",
  Cancel = "cancel"
}

export function selectCompletableTask(
  app: App,
  tasks: CompletableTask[]
): Promise<CompletableTask | null> {
  return new Promise((resolve) => {
    new CompleteTaskSuggestModal(app, tasks, resolve).open();
  });
}

export function confirmTaskCompletion(
  app: App,
  preview: TaskCompletionPreview
): Promise<CompleteTaskDecision> {
  return new Promise((resolve) => {
    new CompleteTaskConfirmModal(app, preview, resolve).open();
  });
}

class CompleteTaskSuggestModal extends FuzzySuggestModal<CompletableTask> {
  constructor(
    app: App,
    private readonly tasks: CompletableTask[],
    private readonly resolveTask: (task: CompletableTask | null) => void
  ) {
    super(app);
    this.setPlaceholder("Select a Doing/Todo/Pending Release task to complete");
  }

  getItems(): CompletableTask[] {
    return this.tasks;
  }

  getItemText(task: CompletableTask): string {
    return `${task.section} · line ${task.line} · ${task.text}`;
  }

  onChooseItem(task: CompletableTask): void {
    this.resolveTask(task);
  }

  onClose(): void {
    this.resolveTask(null);
  }
}

class CompleteTaskConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly preview: TaskCompletionPreview,
    private readonly resolveDecision: (decision: CompleteTaskDecision) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Complete Task" });
    this.contentEl.createEl("p", {
      text: `Archive from ${this.preview.fromSection} to 10-tasks/done.md.`
    });

    this.renderLine("Current", this.preview.originalLine);
    this.renderLine("After", this.preview.completedLine);

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.finish(CompleteTaskDecision.Cancel))
      )
      .addButton((button) =>
        button
          .setButtonText("Confirm Complete")
          .setCta()
          .onClick(() => this.finish(CompleteTaskDecision.Confirm))
      );
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveDecision(CompleteTaskDecision.Cancel);
    }
    this.contentEl.empty();
  }

  private renderLine(label: string, line: string): void {
    this.contentEl.createEl("h3", { text: label });
    this.contentEl.createEl("pre", {
      text: line,
      cls: "ai-knowledge-complete-task-line"
    });
  }

  private finish(decision: CompleteTaskDecision): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveDecision(decision);
    this.close();
  }
}
