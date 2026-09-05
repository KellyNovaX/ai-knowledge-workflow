import { App, Modal, Notice, Setting } from "obsidian";
import { AiKnowledgeWorkflowSettings } from "../types";
import {
  runSkillCliCommand,
  SkillCliExecutionError
} from "../providers/CodexProvider";
import { getConfiguredAiAgent } from "../agents";

export enum SkillActionId {
  GenerateProjectKnowledge = "generate_project_knowledge",
  GenerateWeeklySummary = "generate_weekly_summary"
}

enum SkillParameterField {
  SourcePath = "source_path",
  OutputProjectPath = "output_project_path",
  PeriodStart = "period_start",
  PeriodEnd = "period_end",
  OutputPath = "output_path"
}

enum SkillResultFollowUp {
  Validate = "validate",
  Retry = "retry"
}

interface SkillParameterDefinition {
  field: SkillParameterField;
  label: string;
  description: string;
  placeholder: string;
  defaultValue?: (today: Date) => string;
}

interface SkillActionDefinition {
  id: SkillActionId;
  label: string;
  skillTrigger: string;
  confirmTitle: string;
  parameters: SkillParameterDefinition[];
  validateAfterSuccess: boolean;
}

interface SkillActionRequest {
  values: Record<SkillParameterField, string>;
}

interface SkillExecutionContext {
  settings: AiKnowledgeWorkflowSettings;
  validateVault(): Promise<void>;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultWeekStart(today: Date): string {
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return formatLocalDate(monday);
}

function getDefaultWeekEnd(today: Date): string {
  return formatLocalDate(today);
}

function getDefaultWeeklyOutputPath(today: Date): string {
  const isoThursday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  isoThursday.setUTCDate(isoThursday.getUTCDate() + 4 - (isoThursday.getUTCDay() || 7));
  const isoYear = isoThursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((isoThursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `60-其他/周报/${isoYear}-W${String(isoWeek).padStart(2, "0")}.md`;
}

const SKILL_ACTIONS: Record<SkillActionId, SkillActionDefinition> = {
  [SkillActionId.GenerateProjectKnowledge]: {
    id: SkillActionId.GenerateProjectKnowledge,
    label: "Generate Project Knowledge",
    skillTrigger: "$ai-knowledge-project-onboarding",
    confirmTitle: "Generate project knowledge",
    validateAfterSuccess: true,
    parameters: [
      {
        field: SkillParameterField.SourcePath,
        label: "Source project path",
        description: "Absolute source repository path. The plugin will not infer it.",
        placeholder: "/absolute/path/to/source-project"
      },
      {
        field: SkillParameterField.OutputProjectPath,
        label: "Output project path",
        description: "Vault project output path, for example 30-projects/<project>.",
        placeholder: "30-projects/<project>"
      }
    ]
  },
  [SkillActionId.GenerateWeeklySummary]: {
    id: SkillActionId.GenerateWeeklySummary,
    label: "Generate Weekly Summary",
    skillTrigger: "$ai-knowledge-weekly-summary",
    confirmTitle: "Generate weekly summary",
    validateAfterSuccess: true,
    parameters: [
      {
        field: SkillParameterField.PeriodStart,
        label: "Period start",
        description: "Start date of the weekly summary period.",
        placeholder: "2026-05-18",
        defaultValue: getDefaultWeekStart
      },
      {
        field: SkillParameterField.PeriodEnd,
        label: "Period end",
        description: "End date of the weekly summary period.",
        placeholder: "2026-05-22",
        defaultValue: getDefaultWeekEnd
      },
      {
        field: SkillParameterField.OutputPath,
        label: "Output path",
        description: "Requested output path or draft destination. Do not leave it implicit.",
        placeholder: "60-其他/周报/YYYY-WW.md",
        defaultValue: getDefaultWeeklyOutputPath
      }
    ]
  }
};

export class SkillActions {
  constructor(
    private readonly app: App,
    private readonly context: SkillExecutionContext
  ) {}

  async run(actionId: SkillActionId): Promise<void> {
    if (!getConfiguredAiAgent(this.context.settings)) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before running skills.");
      return;
    }

    const definition = SKILL_ACTIONS[actionId];
    const request = await new SkillParameterModal(
      this.app,
      definition
    ).openAndGetRequest();

    if (!request) {
      return;
    }

    const confirmed = await new SkillConfirmModal(
      this.app,
      definition,
      request
    ).openAndGetConfirmation();

    if (!confirmed) {
      new Notice("Skill execution cancelled.");
      return;
    }

    await this.execute(definition, request);
  }

  private async execute(
    definition: SkillActionDefinition,
    request: SkillActionRequest
  ): Promise<void> {
    const agent = getConfiguredAiAgent(this.context.settings);

    if (!agent) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before running skills.");
      return;
    }

    new Notice(`Running ${definition.label} with configured AI agent...`);

    try {
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const workspacePath = this.context.settings.vaultRoot.trim() || adapter.getBasePath?.();
      if (!workspacePath) {
        throw new Error("Vault root path is unavailable. Configure Vault root before running skills.");
      }
      const result = await runSkillCliCommand(
        agent.command,
        buildSkillPrompt(definition, request),
        agent.label,
        agent.provider,
        workspacePath
      );
      new SkillResultModal(
        this.app,
        definition,
        result.stdout,
        result.stderr,
        SkillResultFollowUp.Validate,
        async () => {
          await this.context.validateVault();
        }
      ).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = error instanceof SkillCliExecutionError ? error.details : undefined;
      new SkillResultModal(
        this.app,
        definition,
        "",
        details ?? message,
        SkillResultFollowUp.Retry,
        async () => {
          await this.run(definition.id);
        }
      ).open();
      new Notice(`${definition.label} failed: ${message}`);
    }
  }
}

class SkillParameterModal extends Modal {
  private readonly values = new Map<SkillParameterField, string>();
  private resolveRequest?: (request: SkillActionRequest | null) => void;
  private settled = false;

  constructor(
    app: App,
    private readonly definition: SkillActionDefinition
  ) {
    super(app);
  }

  openAndGetRequest(): Promise<SkillActionRequest | null> {
    return new Promise((resolve) => {
      this.resolveRequest = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.definition.label });

    const today = new Date();
    for (const parameter of this.definition.parameters) {
      const defaultValue = parameter.defaultValue?.(today);
      new Setting(contentEl)
        .setName(parameter.label)
        .setDesc(parameter.description)
        .addText((text) => {
          text.setPlaceholder(parameter.placeholder).onChange((value) => {
            this.values.set(parameter.field, value.trim());
          });
          if (defaultValue) {
            text.setValue(defaultValue);
            this.values.set(parameter.field, defaultValue);
          }
        });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const runButton = buttons.createEl("button", { text: "Review" });
    runButton.addClass("mod-cta");
    runButton.addEventListener("click", () => {
      const missing = this.definition.parameters.filter(
        (parameter) => !this.values.get(parameter.field)?.trim()
      );

      if (missing.length > 0) {
        new Notice(`Missing required parameter: ${missing[0].label}`);
        return;
      }

      this.settled = true;
      this.resolveRequest?.({
        values: Object.fromEntries(this.values.entries()) as Record<SkillParameterField, string>
      });
      this.close();
    });

    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.settled = true;
      this.resolveRequest?.(null);
      this.close();
    });
  }

  onClose(): void {
    if (!this.settled) {
      this.resolveRequest?.(null);
    }
    this.contentEl.empty();
  }
}

class SkillConfirmModal extends Modal {
  private resolveConfirmation?: (confirmed: boolean) => void;
  private settled = false;

  constructor(
    app: App,
    private readonly definition: SkillActionDefinition,
    private readonly request: SkillActionRequest
  ) {
    super(app);
  }

  openAndGetConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveConfirmation = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.definition.confirmTitle });
    contentEl.createEl("p", {
      text: "Confirm these parameters before starting the external skill flow."
    });

    const list = contentEl.createEl("ul");
    list.createEl("li", { text: `Skill: ${this.definition.skillTrigger}` });
    for (const parameter of this.definition.parameters) {
      list.createEl("li", {
        text: `${parameter.label}: ${this.request.values[parameter.field]}`
      });
    }

    contentEl.createEl("p", {
      text: "The plugin will only show the skill result or run vault validate; it will not write files directly from this result.",
      cls: "ai-knowledge-muted"
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const executeButton = buttons.createEl("button", { text: "Execute" });
    executeButton.addClass("mod-cta");
    executeButton.addEventListener("click", () => {
      this.settled = true;
      this.resolveConfirmation?.(true);
      this.close();
    });

    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.settled = true;
      this.resolveConfirmation?.(false);
      this.close();
    });
  }

  onClose(): void {
    if (!this.settled) {
      this.resolveConfirmation?.(false);
    }
    this.contentEl.empty();
  }
}

class SkillResultModal extends Modal {
  constructor(
    app: App,
    private readonly definition: SkillActionDefinition,
    private readonly stdout: string,
    private readonly stderr: string,
    private readonly followUpType: SkillResultFollowUp,
    private readonly followUp: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `${this.definition.label} Result` });

    const output = [this.stdout, this.stderr ? `stderr:\n${this.stderr}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    contentEl.createEl("pre", {
      text: output || "No output returned.",
      cls: "ai-knowledge-skill-output"
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    if (
      this.followUpType === SkillResultFollowUp.Validate &&
      this.definition.validateAfterSuccess
    ) {
      const validateButton = buttons.createEl("button", { text: "Run vault validate" });
      validateButton.addClass("mod-cta");
      validateButton.addEventListener("click", () => {
        void this.followUp();
        this.close();
      });
    } else if (this.followUpType === SkillResultFollowUp.Retry) {
      const retryButton = buttons.createEl("button", { text: "Retry" });
      retryButton.addEventListener("click", () => {
        void this.followUp();
        this.close();
      });
    }

    const closeButton = buttons.createEl("button", { text: "Close" });
    closeButton.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function buildSkillPrompt(
  definition: SkillActionDefinition,
  request: SkillActionRequest
): string {
  const parameters = definition.parameters
    .map((parameter) => `- ${parameter.label}: ${request.values[parameter.field]}`)
    .join("\n");

  return [
    `Run the ${definition.skillTrigger} skill workflow.`,
    "",
    "Boundaries:",
    "- Use the skill's own workflow, prompts, confirmations, and safety rules.",
    "- Do not copy or reimplement the skill's internal logic in this plugin flow.",
    "- If required parameters are still insufficient, ask the user instead of guessing.",
    "- Do not infer project ownership, target environment, log date ranges, weekly periods, or output paths.",
    "- Report results, errors, and next required user action in plain text.",
    "- Do not bypass any existing confirmation flow to write directly into the vault.",
    "",
    "Confirmed parameters:",
    parameters,
    "",
    "Start the skill workflow now."
  ].join("\n");
}
