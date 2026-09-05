import { App, Modal, Setting } from "obsidian";
import { PlanQuestion } from "../types";
import { UserAnswer } from "../providers/ModelProvider";

export enum QuestionModalResultKind {
  Submitted = "submitted",
  Cancelled = "cancelled"
}

export interface QuestionModalResult {
  kind: QuestionModalResultKind;
  answers: UserAnswer[];
}

export class QuestionModal extends Modal {
  private readonly answerByField = new Map<string, string>();
  private settled = false;

  constructor(
    app: App,
    private readonly questions: PlanQuestion[],
    private readonly resolveResult: (result: QuestionModalResult) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Plan questions" });

    for (const question of this.questions) {
      const setting = new Setting(contentEl).setName(question.question).setDesc(question.field);

      if (question.options && question.options.length > 0) {
        setting.addDropdown((dropdown) => {
          for (const option of question.options ?? []) {
            dropdown.addOption(option, option);
          }

          const initialValue = question.options?.[0] ?? "";
          this.answerByField.set(question.field, initialValue);
          dropdown.onChange((value) => {
            this.answerByField.set(question.field, value);
          });
        });
      } else {
        setting.addTextArea((text) => {
          text.inputEl.rows = 3;
          text.onChange((value) => {
            this.answerByField.set(question.field, value);
          });
        });
      }
    }

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Cancel")
          .onClick(() => {
            this.finish(QuestionModalResultKind.Cancelled);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Submit answers")
          .setCta()
          .onClick(() => {
            this.finish(QuestionModalResultKind.Submitted);
          });
      });
  }

  onClose(): void {
    if (!this.settled) {
      this.resolveResult({ kind: QuestionModalResultKind.Cancelled, answers: [] });
      this.settled = true;
    }

    this.contentEl.empty();
  }

  private finish(kind: QuestionModalResultKind): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveResult({
      kind,
      answers: kind === QuestionModalResultKind.Submitted ? this.buildAnswers() : []
    });
    this.close();
  }

  private buildAnswers(): UserAnswer[] {
    return this.questions.map((question) => ({
      field: question.field,
      question: question.question,
      answer: this.answerByField.get(question.field)?.trim() ?? ""
    }));
  }
}

export function askPlanQuestions(app: App, questions: PlanQuestion[]): Promise<QuestionModalResult> {
  return new Promise((resolve) => {
    new QuestionModal(app, questions, resolve).open();
  });
}
