import { ModelProviderType } from "../types";

export interface CliShellCommand {
  executable: string;
  args: string[];
}

export function buildNonInteractiveCommand(
  command: string,
  provider: ModelProviderType.Codex | ModelProviderType.CustomCli
): string {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    throw new Error("CLI command is empty. Configure it in AI Knowledge Workflow settings.");
  }
  return provider === ModelProviderType.Codex
    ? `${trimmedCommand} exec --skip-git-repo-check --color never -`
    : trimmedCommand;
}

export function resolveCliShellCommand(command: string): CliShellCommand {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command]
    };
  }

  return {
    executable: process.env.SHELL || "/bin/zsh",
    args: ["-i", "-c", command]
  };
}
