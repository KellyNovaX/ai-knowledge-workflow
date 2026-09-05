import { openExternalUri } from "./ExternalAppOpener";
import { existsSync } from "fs";

export interface CodexAppLaunchRequest {
  absoluteWorkspacePath: string;
  fileReference: string;
}

export async function openCodexAppForTask(request: CodexAppLaunchRequest): Promise<void> {
  assertWorkspaceExists(request.absoluteWorkspacePath);
  await openCodexNewThread({
    absoluteWorkspacePath: request.absoluteWorkspacePath,
    prompt: `@${request.fileReference} `
  });
}

export async function openCodexAppWithPrompt(request: {
  absoluteWorkspacePath: string;
  prompt: string;
}): Promise<void> {
  assertWorkspaceExists(request.absoluteWorkspacePath);
  await openCodexNewThread({
    absoluteWorkspacePath: request.absoluteWorkspacePath,
    prompt: request.prompt
  });
}

export async function openCodexAppForProject(
  request: Pick<CodexAppLaunchRequest, "absoluteWorkspacePath">
): Promise<void> {
  assertWorkspaceExists(request.absoluteWorkspacePath);
  await openCodexNewThread({
    absoluteWorkspacePath: request.absoluteWorkspacePath
  });
}

function openCodexNewThread(request: {
  absoluteWorkspacePath: string;
  prompt?: string;
}): Promise<void> {
  return openExternalUri(buildCodexNewThreadUrl(request));
}

function assertWorkspaceExists(absoluteWorkspacePath: string): void {
  if (!existsSync(absoluteWorkspacePath)) {
    throw new Error(`Codex App workspace folder does not exist: ${absoluteWorkspacePath}`);
  }
}

function buildCodexNewThreadUrl(request: {
  absoluteWorkspacePath: string;
  prompt?: string;
}): string {
  const params = new URLSearchParams();
  params.set("path", request.absoluteWorkspacePath);

  if (request.prompt) {
    params.set("prompt", request.prompt);
  }

  return `codex://new?${params.toString()}`;
}
