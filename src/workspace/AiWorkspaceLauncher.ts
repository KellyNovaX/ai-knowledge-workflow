import { App, Platform, TAbstractFile, TFile } from "obsidian";
import { spawn } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { TerminalApp } from "../types";

enum VaultDirectory {
  Projects = "30-projects",
  Workflows = "20-workflows",
  Inputs = "inputs"
}

enum WorkspaceViewType {
  Terminal = "terminal:terminal"
}

export interface AiWorkspaceLaunchRequest {
  file: TAbstractFile;
  command: string;
  terminalApp: TerminalApp;
  includeFileReference?: boolean;
  submitCommand?: boolean;
  vaultRootOverride?: string;
  workspacePathOverride?: string;
  fileReferenceOverride?: string;
  title?: string;
  sourceEntryPath?: string;
}

export interface AiWorkspaceLaunchResult {
  workspacePath: string;
  absoluteWorkspacePath: string;
  command: string;
}

export class AiWorkspaceLauncher {
  constructor(private readonly app: App) {}

  async openVaultInTerminal(
    command: string,
    terminalApp: TerminalApp,
    vaultRootOverride?: string,
    sourceEntryPath?: string
  ): Promise<AiWorkspaceLaunchResult> {
    assertTerminalPlatform(terminalApp);
    const vaultRoot = this.getVaultRoot(vaultRootOverride);
    const shellCommand = buildShellCommand(vaultRoot, command);

    if (terminalApp === TerminalApp.Obsidian) {
      await this.openInObsidianTerminal(vaultRoot, shellCommand, true, undefined, undefined, sourceEntryPath);
    } else {
      const aiCommand = buildAiCommand(command);
      const script = buildTerminalScript({
        terminalApp,
        absoluteWorkspacePath: vaultRoot,
        shellCommand,
        aiCommand,
        submitCommand: true
      });
      await runOsascript(script);
    }

    return {
      workspacePath: ".",
      absoluteWorkspacePath: vaultRoot,
      command: shellCommand
    };
  }

  async openAbsolutePathInTerminal(
    absoluteWorkspacePath: string,
    command: string,
    terminalApp: TerminalApp,
    title?: string,
    sourceEntryPath?: string
  ): Promise<AiWorkspaceLaunchResult> {
    assertTerminalPlatform(terminalApp);
    const normalizedWorkspacePath = absoluteWorkspacePath.replace(/\/+$/, "");
    const shellCommand = buildShellCommand(normalizedWorkspacePath, command);

    if (terminalApp === TerminalApp.Obsidian) {
      await this.openInObsidianTerminal(normalizedWorkspacePath, shellCommand, true, undefined, title, sourceEntryPath);
    } else {
      const aiCommand = buildAiCommand(command);
      const script = buildTerminalScript({
        terminalApp,
        absoluteWorkspacePath: normalizedWorkspacePath,
        shellCommand,
        aiCommand,
        submitCommand: true
      });
      await runOsascript(script);
    }

    return {
      workspacePath: normalizedWorkspacePath,
      absoluteWorkspacePath: normalizedWorkspacePath,
      command: shellCommand
    };
  }

  async openInTerminal(request: AiWorkspaceLaunchRequest): Promise<AiWorkspaceLaunchResult> {
    assertTerminalPlatform(request.terminalApp);
    const workspacePath = request.workspacePathOverride ?? resolveWorkspacePath(request.file);
    const vaultRoot = this.getVaultRoot(request.vaultRootOverride);
    const absoluteWorkspacePath = workspacePath ? `${vaultRoot}/${workspacePath}` : vaultRoot;
    const fileReference = request.includeFileReference && request.file instanceof TFile
      ? request.fileReferenceOverride ?? request.file.path
      : undefined;
    const submitCommand = request.submitCommand ?? true;
    const shellCommand = buildShellCommand(
      absoluteWorkspacePath,
      request.command,
      fileReference,
      submitCommand
    );

    if (request.terminalApp === TerminalApp.Obsidian) {
      await this.openInObsidianTerminal(
        absoluteWorkspacePath,
        shellCommand,
        submitCommand,
        submitCommand ? undefined : fileReference,
        request.title,
        request.sourceEntryPath ?? (request.file instanceof TFile ? request.file.path : undefined)
      );
    } else {
      const aiCommandIncludesFile = submitCommand || request.terminalApp === TerminalApp.Warp;
      const aiCommand = buildAiCommand(
        request.command,
        aiCommandIncludesFile ? fileReference : undefined
      );
      const script = buildTerminalScript({
        terminalApp: request.terminalApp,
        absoluteWorkspacePath,
        shellCommand,
        aiCommand,
        submitCommand,
        fileReference
      });
      await runOsascript(script);
    }

    return {
      workspacePath: workspacePath || ".",
      absoluteWorkspacePath,
      command: shellCommand
    };
  }

  private async openInObsidianTerminal(
    absoluteWorkspacePath: string,
    shellCommand: string,
    submitCommand: boolean,
    fileReference?: string,
    title?: string,
    sourceEntryPath?: string
  ): Promise<void> {
    const terminalPlugin = (this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins["terminal"];
    if (!terminalPlugin) {
      throw new Error("Install and enable the Terminal community plugin to open an integrated terminal, or use Copy to Agent and run your CLI manually. macOS users can also select iTerm or Warp in this plugin's settings.");
    }

    this.activateExistingTerminalTargetLeaf();
    const leavesBefore = this.app.workspace.getLeavesOfType(WorkspaceViewType.Terminal);
    (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById("terminal:open-terminal.integrated.root");

    const terminalLeaf = await this.waitForNewTerminalLeaf(leavesBefore.length);
    if (!terminalLeaf) {
      throw new Error("Timed out waiting for Obsidian Terminal to open.");
    }

    const view = terminalLeaf.view as unknown as ObsidianTerminalView;

    if (title || sourceEntryPath) {
      (view as unknown as Record<string, unknown>).state = {
        ...((view as unknown as Record<string, unknown>).state as Record<string, unknown>),
        ...(title ? { userTitle: title } : {}),
        ...(sourceEntryPath ? { aiKnowledgeEntryPath: sourceEntryPath } : {})
      };
      const leafInternal = terminalLeaf as unknown as Record<string, unknown>;
      const innerEl = leafInternal["tabHeaderInnerEl"] as HTMLElement | undefined;
      if (innerEl && title) innerEl.textContent = title;
    }

    await this.waitForTerminalEmulator(view);

    const terminal = view.emulator!.terminal;
    if (submitCommand) {
      terminal.paste(shellCommand + "\n");
    } else {
      terminal.paste(shellCommand + "\n");
      if (fileReference) {
        await sleep(500);
        terminal.paste(`@${fileReference} `);
      }
    }
  }

  private activateExistingTerminalTargetLeaf(): void {
    const existingTerminalLeaf = this.app.workspace.getLeavesOfType(WorkspaceViewType.Terminal)[0];

    if (existingTerminalLeaf) {
      this.app.workspace.setActiveLeaf(existingTerminalLeaf, { focus: true });
    }
  }

  private async waitForNewTerminalLeaf(previousCount: number): Promise<import("obsidian").WorkspaceLeaf | null> {
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const leaves = this.app.workspace.getLeavesOfType(WorkspaceViewType.Terminal);
      if (leaves.length > previousCount) {
        return leaves[leaves.length - 1];
      }
    }
    return null;
  }

  private async waitForTerminalEmulator(view: ObsidianTerminalView): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if (view.emulator?.terminal) return;
      await sleep(100);
    }
    throw new Error("Timed out waiting for terminal emulator to initialize.");
  }

  private getVaultRoot(vaultRootOverride?: string): string {
    const configuredRoot = vaultRootOverride?.trim();

    if (configuredRoot) {
      return configuredRoot.replace(/\/+$/, "");
    }

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("Vault root path is unavailable. Configure Vault root in plugin settings.");
    }

    return basePath.replace(/\/+$/, "");
  }
}

interface ObsidianTerminalView {
  emulator: {
    terminal: {
      paste(data: string): void;
      write(data: string): void;
      focus(): void;
    };
  } | null;
}

export function resolveWorkspacePath(file: TAbstractFile): string {
  const path = file instanceof TFile ? parentPath(file.path) : file.path;
  const parts = path.split("/").filter(Boolean);

  if (isProjectTaskPath(parts)) {
    return parts.slice(0, 6).join("/");
  }

  if (parts[0] === VaultDirectory.Workflows && parts[1]) {
    return `${VaultDirectory.Workflows}/${parts[1]}`;
  }

  if (parts[0] === VaultDirectory.Projects && parts[1]) {
    return `${VaultDirectory.Projects}/${parts[1]}`;
  }

  return "";
}

function isProjectTaskPath(parts: string[]): boolean {
  return parts[0] === VaultDirectory.Projects
    && Boolean(parts[1])
    && parts[2] === VaultDirectory.Inputs
    && Boolean(parts[3])
    && Boolean(parts[4])
    && Boolean(parts[5]);
}

function buildShellCommand(
  absoluteWorkspacePath: string,
  command: string,
  fileReference?: string,
  submitCommand = true
): string {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    throw new Error("AI workspace command is empty. Configure the CLI path in plugin settings.");
  }

  const fileArg = fileReference ? ` ${quoteShellArg(`@${fileReference}`)}` : "";
  const aiCommand = `${trimmedCommand}${fileArg}`;

  if (submitCommand) {
    return `cd ${quoteShellArg(absoluteWorkspacePath)} && ${aiCommand}`;
  }

  return `cd ${quoteShellArg(absoluteWorkspacePath)} && ${trimmedCommand}`;
}

function buildAiCommand(
  command: string,
  fileReference?: string
): string {
  const trimmedCommand = command.trim();

  if (!trimmedCommand) {
    throw new Error("AI workspace command is empty. Configure the CLI path in plugin settings.");
  }

  const fileArg = fileReference ? ` ${quoteShellArg(`@${fileReference}`)}` : "";
  return `${trimmedCommand}${fileArg}`;
}

interface TerminalScriptRequest {
  terminalApp: TerminalApp;
  absoluteWorkspacePath: string;
  shellCommand: string;
  aiCommand: string;
  submitCommand: boolean;
  fileReference?: string;
}

function assertTerminalPlatform(terminalApp: TerminalApp): void {
  if (!Platform.isDesktopApp) {
    throw new Error("AI terminal workspaces require Obsidian desktop.");
  }
  if (terminalApp !== TerminalApp.Obsidian && !Platform.isMacOS) {
    throw new Error("iTerm and Warp launchers are available only on macOS. Select Obsidian terminal in settings or use Copy to Agent.");
  }
  if (Platform.isWin) {
    throw new Error("Automatic terminal launch is not supported on Windows. Use Copy to Agent and run your CLI manually.");
  }
}

function buildTerminalScript(request: TerminalScriptRequest): string {
  assertTerminalPlatform(request.terminalApp);
  if (request.terminalApp === TerminalApp.Warp) {
    return buildWarpScript(
      request.absoluteWorkspacePath,
      request.aiCommand,
      request.submitCommand,
      request.fileReference
    );
  }

  return buildItermScript(request.shellCommand, request.submitCommand, request.fileReference);
}

function buildItermScript(
  command: string,
  submitCommand: boolean,
  fileReference?: string
): string {
  const writeLines = submitCommand || !fileReference
    ? [`write text ${quoteAppleScriptString(command)}`]
    : [
        `write text ${quoteAppleScriptString(command)}`,
        "delay 1",
        `write text ${quoteAppleScriptString(`@${fileReference} `)} newline NO`
      ];

  return [
    'tell application "iTerm"',
    "activate",
    "create window with default profile",
    "tell current session of current window",
    ...writeLines,
    "end tell",
    "end tell"
  ].join("\n");
}

function buildWarpScript(
  absoluteWorkspacePath: string,
  aiCommand: string,
  _submitCommand: boolean,
  _fileReference?: string
): string {
  const launchConfigPath = writeWarpLaunchConfiguration(absoluteWorkspacePath, aiCommand);

  return [
    `open location ${quoteAppleScriptString(buildWarpLaunchUri(launchConfigPath))}`
  ].join("\n");
}

function writeWarpLaunchConfiguration(
  absoluteWorkspacePath: string,
  command: string
): string {
  const configDirectory = join(homedir(), ".warp", "launch_configurations");
  const configPath = join(configDirectory, "ai-knowledge-workflow.yaml");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(configPath, buildWarpLaunchConfigurationYaml(absoluteWorkspacePath, command), "utf8");
  return configPath;
}

function buildWarpLaunchConfigurationYaml(
  absoluteWorkspacePath: string,
  command: string
): string {
  return [
    "---",
    "name: AI Knowledge Workflow",
    "windows:",
    "  - tabs:",
    "      - title: AI Agent",
    "        layout:",
    `          cwd: ${quoteYamlString(absoluteWorkspacePath)}`,
    "          commands:",
    `            - exec: ${quoteYamlString(command)}`,
    ""
  ].join("\n");
}

function buildWarpLaunchUri(launchConfigPath: string): string {
  return `warp://launch/${encodeURI(launchConfigPath)}`;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function runOsascript(script: string): Promise<void> {
  if (!Platform.isMacOS) {
    return Promise.reject(new Error("AppleScript automation requires macOS."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `osascript exited with code ${code ?? "unknown"}.`));
    });
  });
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
