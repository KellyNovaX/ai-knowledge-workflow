import { App, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  DEFAULT_CODEX_CLI_PATH,
  DEFAULT_CUSTOM_CLI_COMMAND,
  DEFAULT_VAULT_ROOT,
  ACTIVE_TASK_STATUS_ORDER,
  MODEL_PROVIDER_LABELS,
  normalizeTaskStatusValue,
  TASK_STATUS_LABELS,
  TASK_SOURCE_APP_LABELS,
  TERMINAL_APP_LABELS
} from "./constants";
import {
  AiKnowledgeWorkflowSettings,
  LayoutDirection,
  ModelProviderType,
  TaskStatus,
  TaskSourceApp,
  TerminalApp
} from "./types";

export const DEFAULT_SETTINGS: AiKnowledgeWorkflowSettings = {
  vaultRoot: DEFAULT_VAULT_ROOT,
  provider: ModelProviderType.Manual,
  terminalApp: TerminalApp.Obsidian,
  taskSourceApp: TaskSourceApp.Wps,
  codexCliPath: DEFAULT_CODEX_CLI_PATH,
  customCliPath: DEFAULT_CUSTOM_CLI_COMMAND,
  defaultTaskStatus: TaskStatus.Todo,
  autoValidate: true,
  layoutDirection: LayoutDirection.Vertical
};

export function normalizeTaskStatus(value: unknown): TaskStatus {
  const status = normalizeTaskStatusValue(value, DEFAULT_SETTINGS.defaultTaskStatus);
  return status && ACTIVE_TASK_STATUS_ORDER.includes(status)
    ? status
    : DEFAULT_SETTINGS.defaultTaskStatus;
}

export function normalizeTerminalApp(value: unknown): TerminalApp {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.terminalApp;
  }

  if (getAvailableTerminalApps().includes(value as TerminalApp)) {
    return value as TerminalApp;
  }

  return DEFAULT_SETTINGS.terminalApp;
}

export function getAvailableTerminalApps(): TerminalApp[] {
  return Platform.isMacOS ? Object.values(TerminalApp) : [TerminalApp.Obsidian];
}

export function normalizeLayoutDirection(value: unknown): LayoutDirection {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.layoutDirection;
  }

  if (Object.values(LayoutDirection).includes(value as LayoutDirection)) {
    return value as LayoutDirection;
  }

  return DEFAULT_SETTINGS.layoutDirection;
}

export interface SettingsHostPlugin extends Plugin {
  settings: AiKnowledgeWorkflowSettings;
  saveSettings(): Promise<void>;
  refreshTaskSourceViews(): Promise<void>;
}

export class AiKnowledgeWorkflowSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SettingsHostPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Vault root")
      .setDesc("Optional absolute vault root override. Leave empty to use the current Obsidian vault automatically.")
      .addText((text) =>
        text
          .setPlaceholder("Auto-detect current vault")
          .setValue(this.plugin.settings.vaultRoot)
          .onChange(async (value) => {
            this.plugin.settings.vaultRoot = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI agent")
      .setDesc("Configured agent used by plan generation, skill execution, and terminal workspace actions.")
      .addDropdown((dropdown) => {
        for (const provider of Object.values(ModelProviderType)) {
          dropdown.addOption(provider, MODEL_PROVIDER_LABELS[provider]);
        }

        dropdown.setValue(this.plugin.settings.provider).onChange(async (value) => {
          this.plugin.settings.provider = value as ModelProviderType;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("任务来源应用")
      .setDesc("选择 WPS 或飞书。所有任务的来源标签和打开入口统一跟随此设置，已有来源名称保持不变。WPS 打开功能仅支持 macOS；飞书需要安装桌面客户端。")
      .addDropdown((dropdown) => {
        for (const sourceApp of Object.values(TaskSourceApp)) {
          dropdown.addOption(sourceApp, TASK_SOURCE_APP_LABELS[sourceApp]);
        }
        dropdown.setValue(this.plugin.settings.taskSourceApp).onChange(async (value) => {
          this.plugin.settings.taskSourceApp = value as TaskSourceApp;
          await this.plugin.saveSettings();
          await this.plugin.refreshTaskSourceViews();
        });
      });

    new Setting(containerEl)
      .setName("Terminal app")
      .setDesc(Platform.isWin
        ? "Automatic terminal launch is unavailable on Windows. Use Copy to Agent and run your CLI manually."
        : "Obsidian terminal requires the separate Terminal community plugin and a POSIX shell. iTerm and Warp launchers are available on macOS only.")
      .addDropdown((dropdown) => {
        for (const terminalApp of getAvailableTerminalApps()) {
          dropdown.addOption(terminalApp, TERMINAL_APP_LABELS[terminalApp]);
        }

        dropdown.setValue(this.plugin.settings.terminalApp).onChange(async (value) => {
          this.plugin.settings.terminalApp = value as TerminalApp;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Codex CLI path")
      .setDesc("Command or absolute path used by the Codex provider.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_CODEX_CLI_PATH)
          .setValue(this.plugin.settings.codexCliPath)
          .onChange(async (value) => {
            this.plugin.settings.codexCliPath = value.trim() || DEFAULT_CODEX_CLI_PATH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom CLI command")
      .setDesc("Complete non-interactive command that reads the prompt from standard input and writes its answer to standard output. Include all required arguments; no arguments are added automatically.")
      .addText((text) =>
        text
          .setPlaceholder("Enter a command that reads from standard input")
          .setValue(this.plugin.settings.customCliPath)
          .onChange(async (value) => {
            this.plugin.settings.customCliPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default task status")
      .setDesc("Task board status used when a ready plan does not specify one.")
      .addDropdown((dropdown) => {
        for (const status of ACTIVE_TASK_STATUS_ORDER) {
          dropdown.addOption(status, TASK_STATUS_LABELS[status]);
        }

        dropdown.setValue(this.plugin.settings.defaultTaskStatus).onChange(async (value) => {
          this.plugin.settings.defaultTaskStatus = value as TaskStatus;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Auto validate")
      .setDesc("Run vault validation after future execution modules finish writing changes.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoValidate).onChange(async (value) => {
          this.plugin.settings.autoValidate = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
