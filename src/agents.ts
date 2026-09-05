import { MODEL_PROVIDER_LABELS } from "./constants";
import { AiKnowledgeWorkflowSettings, ModelProviderType } from "./types";

export interface ConfiguredAiAgent {
  provider: ModelProviderType.Codex | ModelProviderType.CustomCli;
  label: string;
  command: string;
}

export function getConfiguredAiAgent(
  settings: AiKnowledgeWorkflowSettings
): ConfiguredAiAgent | null {
  switch (settings.provider) {
    case ModelProviderType.Codex:
      if (!settings.codexCliPath.trim()) return null;
      return {
        provider: ModelProviderType.Codex,
        label: MODEL_PROVIDER_LABELS[ModelProviderType.Codex],
        command: settings.codexCliPath
      };
    case ModelProviderType.CustomCli:
      if (!settings.customCliPath.trim()) return null;
      return {
        provider: ModelProviderType.CustomCli,
        label: MODEL_PROVIDER_LABELS[ModelProviderType.CustomCli],
        command: settings.customCliPath
      };
    default:
      return null;
  }
}
