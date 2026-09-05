import { spawn } from "child_process";
import { BaseCliPlanProvider } from "./CustomCliProvider";
import { buildNonInteractiveCommand, resolveCliShellCommand } from "./CliShell";
import { ModelProviderType } from "../types";

export interface SkillCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export enum SkillCliExecutionErrorCode {
  CliPathMissing = "cli_path_missing",
  CliTimedOut = "cli_timed_out",
  CliExitFailed = "cli_exit_failed"
}

export class SkillCliExecutionError extends Error {
  constructor(
    readonly code: SkillCliExecutionErrorCode,
    message: string,
    readonly details?: string
  ) {
    super(message);
    this.name = "SkillCliExecutionError";
  }
}

export class CodexProvider extends BaseCliPlanProvider {
  protected readonly providerName = "Codex CLI";
  protected readonly providerType = ModelProviderType.Codex;
}

const SKILL_CLI_TIMEOUT_MS = 120_000;
const SKILL_OUTPUT_SUMMARY_LIMIT = 4000;

export function runSkillCliCommand(
  command: string,
  prompt: string,
  providerName: string,
  provider: ModelProviderType.Codex | ModelProviderType.CustomCli,
  workspacePath: string
): Promise<SkillCliExecutionResult> {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    throw new SkillCliExecutionError(
      SkillCliExecutionErrorCode.CliPathMissing,
      `${providerName} command is empty. Configure it in AI Knowledge Workflow settings.`
    );
  }

  return new Promise((resolve, reject) => {
    const shellCommand = resolveCliShellCommand(buildNonInteractiveCommand(trimmedCommand, provider));
    const child = spawn(shellCommand.executable, shellCommand.args, {
      cwd: workspacePath,
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
        new SkillCliExecutionError(
          SkillCliExecutionErrorCode.CliTimedOut,
          `${providerName} timed out after ${SKILL_CLI_TIMEOUT_MS / 1000} seconds.`
        )
      );
    }, SKILL_CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      reject(
        new SkillCliExecutionError(
          SkillCliExecutionErrorCode.CliPathMissing,
          `${providerName} could not be started: ${error.message}`,
          summarizeSkillOutput(stderr)
        )
      );
    });

    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new SkillCliExecutionError(
            SkillCliExecutionErrorCode.CliExitFailed,
            `${providerName} exited with code ${code ?? "unknown"}.`,
            summarizeSkillOutput([stderr, stdout].filter(Boolean).join("\n"))
          )
        );
        return;
      }

      resolve({ stdout, stderr, exitCode: code });
    });

    child.stdin.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      child.kill();
      reject(new SkillCliExecutionError(
        SkillCliExecutionErrorCode.CliExitFailed,
        `${providerName} could not receive the prompt: ${error.message}`,
        summarizeSkillOutput(stderr)
      ));
    });
    child.stdin.end(prompt);
  });
}

function summarizeSkillOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > SKILL_OUTPUT_SUMMARY_LIMIT
    ? `${trimmed.slice(0, SKILL_OUTPUT_SUMMARY_LIMIT)}...`
    : trimmed;
}
