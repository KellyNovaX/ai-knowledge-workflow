import { App, FuzzySuggestModal, Notice, TFile, TFolder } from "obsidian";
import { parsePlanJson } from "../plans/PlanValidator";
import {
  PlanExecutionConfirmation,
  PlanExecutor
} from "../plans/PlanExecutor";
import { CodexProvider } from "../providers/CodexProvider";
import { CustomCliProvider } from "../providers/CustomCliProvider";
import { ManualProvider } from "../providers/ManualProvider";
import {
  InboxFileContext,
  ModelProviderError,
  ModelProvider,
  UserAnswer
} from "../providers/ModelProvider";
import { askPlanQuestions, QuestionModalResultKind } from "../ui/QuestionModal";
import { PlanPreviewDecision, showPlanPreview } from "../ui/PlanPreviewModal";
import {
  PlanConfidence,
  PlanValidationResult,
  WorkflowPlan
} from "../types";
import { AiKnowledgeWorkflowSettings, ModelProviderType } from "../types";
import { isProcessableInboxFile } from "./InboxRules";

const PROJECT_ROOT_PATH = "30-projects/";
const TEXT_PREVIEW_LIMIT = 4000;

export enum InboxProcessingState {
  SelectingInboxItem = "selecting_inbox_item",
  CollectingPlan = "collecting_plan",
  AskingQuestions = "asking_questions",
  PreviewingPlan = "previewing_plan",
  ExecutingPlan = "executing_plan",
  Complete = "complete",
  Cancelled = "cancelled",
  Blocked = "blocked"
}

export enum InboxProcessingIntent {
  ProcessInboxItem = "process_inbox_item",
  CreateWorkflow = "create_workflow",
  AddTask = "add_task"
}

export class InboxProcessor {
  private readonly provider: ModelProvider;
  private readonly executor: PlanExecutor;
  private state = InboxProcessingState.SelectingInboxItem;

  constructor(
    private readonly app: App,
    private readonly settings: AiKnowledgeWorkflowSettings
  ) {
    this.provider = createProvider(app, settings);
    this.executor = new PlanExecutor(app, { vaultRoot: settings.vaultRoot });
  }

  async processInboxItem(
    intent: InboxProcessingIntent = InboxProcessingIntent.ProcessInboxItem
  ): Promise<void> {
    const inboxFile = await this.selectInboxFile();

    if (!inboxFile) {
      this.state = InboxProcessingState.Cancelled;
      return;
    }

    await this.processFile(inboxFile, intent);
  }

  async processFile(
    inboxFile: TFile,
    intent: InboxProcessingIntent = InboxProcessingIntent.ProcessInboxItem
  ): Promise<void> {
    const context = await this.buildInboxContext(inboxFile);
    const answers: UserAnswer[] = this.buildIntentAnswers(intent);
    let previousPlan: WorkflowPlan | undefined;

    for (;;) {
      this.state = InboxProcessingState.CollectingPlan;
      let rawPlan: string | null;

      try {
        rawPlan = await this.provider.generatePlanJson({
          inboxFile: context,
          answers,
          previousPlan,
          projectPaths: this.listProjectPaths()
        });
      } catch (error) {
        this.state = InboxProcessingState.Blocked;
        this.showProviderFailure(error);
        return;
      }

      if (rawPlan === null) {
        this.state = InboxProcessingState.Cancelled;
        new Notice("Inbox processing cancelled.");
        return;
      }

      const validation = parsePlanJson(rawPlan);

      if (!validation.plan) {
        this.state = InboxProcessingState.Blocked;
        this.showValidationFailure(validation);
        return;
      }

      previousPlan = validation.plan;

      if (this.mustAskUser(validation.plan)) {
        this.state = InboxProcessingState.AskingQuestions;
        const result = await askPlanQuestions(this.app, validation.plan.questions);

        if (result.kind !== QuestionModalResultKind.Submitted) {
          this.state = InboxProcessingState.Cancelled;
          new Notice("Inbox processing cancelled before execution.");
          return;
        }

        answers.push(...result.answers);
        continue;
      }

      if (!validation.valid) {
        this.state = InboxProcessingState.Blocked;
        this.showValidationFailure(validation);
        return;
      }

      await this.previewAndMaybeExecute(validation.plan);
      return;
    }
  }

  private buildIntentAnswers(intent: InboxProcessingIntent): UserAnswer[] {
    if (intent === InboxProcessingIntent.ProcessInboxItem) {
      return [];
    }

    return [
      {
        field: "requested_action",
        question: "User selected an Obsidian entry action.",
        answer:
          intent === InboxProcessingIntent.CreateWorkflow
            ? "create_workflow"
            : "create_task"
      }
    ];
  }

  private async previewAndMaybeExecute(plan: WorkflowPlan): Promise<void> {
    this.state = InboxProcessingState.PreviewingPlan;
    const preview = await this.executor.previewPlanExecution(plan);
    const decision = await showPlanPreview(this.app, plan, preview);

    if (decision !== PlanPreviewDecision.Confirm) {
      this.state = InboxProcessingState.Cancelled;
      new Notice("Plan execution cancelled.");
      return;
    }

    if (!preview.canExecute) {
      this.state = InboxProcessingState.Blocked;
      new Notice("Plan has blocking dry-run issues and was not executed.");
      return;
    }

    this.state = InboxProcessingState.ExecutingPlan;
    const result = await this.executor.executePlan(plan, PlanExecutionConfirmation.Confirmed);

    if (!result.executed) {
      this.state = InboxProcessingState.Blocked;
      new Notice(result.error ?? "Plan execution blocked.");
      console.error("AI Knowledge: Plan execution blocked", {
        state: this.state,
        blockers: result.preview.blockers,
        validationIssues: result.validationIssues
      });
      return;
    }

    this.state = InboxProcessingState.Complete;
    new Notice(`Plan executed. Validation issues: ${result.validationIssues.length}.`);
  }

  private mustAskUser(plan: WorkflowPlan): boolean {
    return plan.questions.length > 0 || plan.confidence !== PlanConfidence.High;
  }

  private showValidationFailure(validation: PlanValidationResult): void {
    const messages = [...validation.errors, ...validation.blockingReasons];
    new Notice(messages[0] ?? "Plan validation failed.");
    console.error("AI Knowledge: Plan validation failed", {
      state: this.state,
      errors: validation.errors,
      warnings: validation.warnings,
      blockingReasons: validation.blockingReasons
    });
  }

  private showProviderFailure(error: unknown): void {
    if (error instanceof ModelProviderError) {
      new Notice(error.message);
      console.error("AI Knowledge: Provider failure", {
        state: this.state,
        code: error.code,
        message: error.message,
        details: error.details ?? ""
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    new Notice(`Plan provider failed: ${message}`);
    console.error("AI Knowledge: Provider Failure", error);
  }

  private selectInboxFile(): Promise<TFile | null> {
    const files = this.app.vault
      .getFiles()
      .filter(isProcessableInboxFile);

    if (files.length === 0) {
      new Notice("No inbox files found.");
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      new InboxFileSuggestModal(this.app, files, resolve).open();
    });
  }

  private async buildInboxContext(file: TFile): Promise<InboxFileContext> {
    return {
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      contentPreview: await this.readContentPreview(file)
    };
  }

  private async readContentPreview(file: TFile): Promise<string> {
    if (!isTextLike(file.extension)) {
      return "";
    }

    const content = await this.app.vault.read(file);
    return content.length > TEXT_PREVIEW_LIMIT ? `${content.slice(0, TEXT_PREVIEW_LIMIT)}...` : content;
  }

  private listProjectPaths(): string[] {
    const projectRoot = this.app.vault.getAbstractFileByPath(PROJECT_ROOT_PATH);

    if (!(projectRoot instanceof TFolder)) {
      return [];
    }

    return projectRoot.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .map((child) => child.path)
      .sort();
  }
}

function createProvider(app: App, settings: AiKnowledgeWorkflowSettings): ModelProvider {
  switch (settings.provider) {
    case ModelProviderType.Codex:
      return new CodexProvider(settings.codexCliPath);
    case ModelProviderType.CustomCli:
      return new CustomCliProvider(settings.customCliPath);
    case ModelProviderType.Manual:
      return new ManualProvider(app);
  }
}

class InboxFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly resolveFile: (file: TFile | null) => void
  ) {
    super(app);
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.resolveFile(file);
  }

  onClose(): void {
    this.resolveFile(null);
  }
}

function isTextLike(extension: string): boolean {
  return ["", "md", "txt", "json", "csv", "tsv", "yaml", "yml"].includes(extension.toLowerCase());
}
