import { spawn } from "child_process";
import {
  ModelProviderType,
  PlanAction,
  PlanConfidence,
  PlanDecision,
  TaskScope,
  TaskStatus,
  WorkflowType
} from "../types";
import { parsePlanJson } from "../plans/PlanValidator";
import {
  ModelProvider,
  ModelProviderError,
  ModelProviderErrorCode,
  ModelProviderRequest
} from "./ModelProvider";
import { buildNonInteractiveCommand, resolveCliShellCommand } from "./CliShell";

const CLI_TIMEOUT_MS = 60_000;
const OUTPUT_SUMMARY_LIMIT = 2000;

export abstract class BaseCliPlanProvider implements ModelProvider {
  protected abstract readonly providerName: string;
  protected abstract readonly providerType: ModelProviderType.Codex | ModelProviderType.CustomCli;

  constructor(private readonly cliPath: string) {}

  async generatePlanJson(request: ModelProviderRequest): Promise<string> {
    this.assertCliPath();

    const prompt = buildPlanPrompt(this.providerName, request);
    const command = buildNonInteractiveCommand(this.cliPath, this.providerType);
    const output = await runCli(command, prompt, this.providerName);
    const planJson = extractJsonObject(output.stdout);
    const validation = parsePlanJson(planJson);

    if (!validation.plan || !validation.valid) {
      const messages = [
        ...validation.errors,
        ...validation.blockingReasons,
        ...validation.warnings
      ];
      throw new ModelProviderError(
        ModelProviderErrorCode.CliOutputInvalid,
        `${this.providerName} returned plan JSON that did not pass validation.`,
        summarizeDetails([
          `Validation: ${messages.join("; ") || "Unknown validation failure."}`,
          output.stderr ? `stderr: ${output.stderr}` : "",
          `stdout: ${output.stdout}`
        ])
      );
    }

    return planJson;
  }

  private assertCliPath(): void {
    const trimmedPath = this.cliPath.trim();

    if (!trimmedPath) {
      throw new ModelProviderError(
        ModelProviderErrorCode.CliPathMissing,
        `${this.providerName} command is empty. Configure it in AI Knowledge Workflow settings.`
      );
    }
  }
}

export class CustomCliProvider extends BaseCliPlanProvider {
  protected readonly providerName = "Custom CLI";
  protected readonly providerType = ModelProviderType.CustomCli;
}

interface CliOutput {
  stdout: string;
  stderr: string;
}

function runCli(command: string, prompt: string, providerName: string): Promise<CliOutput> {
  return new Promise((resolve, reject) => {
    const shellCommand = resolveCliShellCommand(command);
    const child = spawn(shellCommand.executable, shellCommand.args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb", PROMPT: "", PS1: "" }
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(
        new ModelProviderError(
          ModelProviderErrorCode.CliTimedOut,
          `${providerName} timed out after ${CLI_TIMEOUT_MS / 1000} seconds.`
        )
      );
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      reject(
        new ModelProviderError(
          ModelProviderErrorCode.CliPathMissing,
          `${providerName} could not be started: ${error.message}`,
          summarizeDetails([stderr])
        )
      );
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new ModelProviderError(
            ModelProviderErrorCode.CliExitFailed,
            `${providerName} exited with code ${code ?? "unknown"}.`,
            summarizeDetails([stderr, stdout])
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildPlanPrompt(providerName: string, request: ModelProviderRequest): string {
  const projectList = request.projectPaths?.length
    ? request.projectPaths.map((path) => `- ${path}`).join("\n")
    : "- Unknown; ask the user if project ownership is unclear.";
  const answerList = request.answers.length
    ? request.answers
        .map((answer) => `- ${answer.field}: ${answer.answer} (question: ${answer.question})`)
        .join("\n")
    : "- None";
  const previousPlan = request.previousPlan
    ? JSON.stringify(request.previousPlan, null, 2)
    : "None";

  return [
    `You are ${providerName} generating an AI Knowledge Workflow plan.`,
    "",
    "Hard boundary:",
    "- Output only one JSON object matching the plan schema.",
    "- Do not create, edit, move, delete, or write any vault files.",
    "- Do not run shell commands.",
    "- Do not include Markdown fences or explanation outside JSON.",
    "",
    "Plan schema enums:",
    `- decision: ${Object.values(PlanDecision).join(", ")}`,
    `- action: ${Object.values(PlanAction).join(", ")}`,
    `- task_scope: ${Object.values(TaskScope).join(", ")}`,
    `- confidence: ${Object.values(PlanConfidence).join(", ")}`,
    `- task_status: ${Object.values(TaskStatus).join(", ")}`,
    `- workflow_type: ${Object.values(WorkflowType).join(", ")}`,
    "- related_projects: optional array of all related project names when more than one project is involved.",
    "",
    "Vault rules summary:",
    "- AI only generates a plan; the plugin validates, previews, asks for confirmation, and writes files.",
    "- Use create_workflow when multiple projects/services are involved, work likely spans days, investigation must be recorded, code/log/database/API analysis is needed, design/risk/rollback/validation is involved, or AI must continue later.",
    "- For create_workflow, workflow_slug should be a short title slug without date or id; the plugin adds the workflow id when writing files.",
    "- For create_workflow, task links must point to 20-workflows/<workflow_slug>/AGENTS.md, not the workflow directory.",
    "- For create_workflow, include all related projects in related_projects and use project for the primary project.",
    "- Use create_task for small single-project follow-up work.",
    "- Use create_general_task with task_scope general for reminders, meetings, communication follow-ups, and personal coordination items unrelated to development projects.",
    "- For create_general_task, do not include project, related_projects, workflow metadata, or moves.",
    "- For create_general_task, task links must point to 10-tasks/items/YYYY/MM/<task-slug>.md.",
    "- Task board entries use explicit type tags: #task/general, #task/project, or #task/workflow.",
    "- For create_task, task links must point to 30-projects/<project>/inputs/YYYY/MM/<task-slug>/AGENTS.md.",
    "- For create_task, move inbox files into the task inputs folder: 30-projects/<project>/inputs/YYYY/MM/<task-slug>/inputs/<original-file>.",
    "- Use archive_project_input for project input material that needs a tracking entry.",
    "- Use need_user_input with questions for unclear project ownership, missing required fields, multi-project ambiguity, or low confidence.",
    "- A ready plan must use high confidence and must not contain questions.",
    "- All move and task paths must be relative vault paths.",
    "",
    "Known projects:",
    projectList,
    "",
    "Inbox file:",
    `- path: ${request.inboxFile.path}`,
    `- basename: ${request.inboxFile.basename}`,
    `- extension: ${request.inboxFile.extension || "(none)"}`,
    "",
    "Inbox content preview:",
    request.inboxFile.contentPreview || "(No text preview available.)",
    "",
    "User answers:",
    answerList,
    "",
    "Previous plan:",
    previousPlan,
    "",
    "Return only the plan JSON now."
  ].join("\n");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new ModelProviderError(
      ModelProviderErrorCode.CliOutputInvalid,
      "CLI returned no output."
    );
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new ModelProviderError(
        ModelProviderErrorCode.CliOutputInvalid,
        "CLI output did not contain a JSON object.",
        summarizeDetails([trimmed])
      );
    }

    const candidate = trimmed.slice(start, end + 1);

    try {
      JSON.parse(candidate);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelProviderError(
        ModelProviderErrorCode.CliOutputInvalid,
        `CLI output contained invalid JSON: ${message}`,
        summarizeDetails([trimmed])
      );
    }
  }
}

function summarizeDetails(parts: string[]): string {
  const details = parts.filter(Boolean).join("\n").trim();
  return details.length > OUTPUT_SUMMARY_LIMIT
    ? `${details.slice(0, OUTPUT_SUMMARY_LIMIT)}...`
    : details;
}
