import { WorkflowPlan } from "../types";

export enum ModelProviderErrorCode {
  CliPathMissing = "cli_path_missing",
  CliTimedOut = "cli_timed_out",
  CliExitFailed = "cli_exit_failed",
  CliOutputInvalid = "cli_output_invalid"
}

export class ModelProviderError extends Error {
  constructor(
    readonly code: ModelProviderErrorCode,
    message: string,
    readonly details?: string
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

export interface InboxFileContext {
  path: string;
  basename: string;
  extension: string;
  contentPreview: string;
}

export interface UserAnswer {
  field: string;
  question: string;
  answer: string;
}

export interface ModelProviderRequest {
  inboxFile: InboxFileContext;
  answers: UserAnswer[];
  previousPlan?: WorkflowPlan;
  projectPaths?: string[];
}

export interface ModelProvider {
  generatePlanJson(request: ModelProviderRequest): Promise<string | null>;
}
