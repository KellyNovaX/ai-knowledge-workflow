# AI Knowledge Workflow

English | [简体中文](README.zh-CN.md)

Organize project knowledge, track tasks, and prepare structured context for AI coding agents in Obsidian. Keep your project documentation, task details, and workflow records in ordinary Markdown files.

The core workflow runs locally without an AI account. The plugin is desktop only, and its interface is primarily Chinese.

## Features

- **Task board:** Manage to-do, in-progress, waiting, pending-release, and backlog tasks. Archive completed tasks and reopen them when needed.
- **Project knowledge:** Organize project entry points, source-code locations, environment notes, and runbooks as Markdown documents.
- **Four workflow types:** Create records and templates for feature development, incident investigation, data fixes, and data exports.
- **Structure validation:** Check task status, context, and local links to help keep task records and the board consistent.
- **Optional AI collaboration:** Copy context to your preferred assistant, or run a locally installed Codex or custom CLI.

All task content is stored in ordinary Markdown files. Manual mode is the default: creating, moving, completing, and reopening tasks does not require an AI service, an API key, or another plugin.

Source repository: [KellyNovaX/ai-knowledge-workflow](https://github.com/KellyNovaX/ai-knowledge-workflow).

## Installation

AI Knowledge Workflow has a public listing in the Obsidian community directory. Availability in the desktop search results has not been confirmed. If **Add to Obsidian** does not open an installable entry, use the manual ZIP installation below.

### Install from the community directory

1. Open the plugin's public listing and select **Add to Obsidian**.
2. Follow the prompts in Obsidian to install and enable **AI Knowledge Workflow** in your chosen vault.
3. Run **AI Knowledge: Initialize vault structure** from the command palette. Review the proposed files before confirming. Initialization adds missing vault files and the three companion skills under `.agents/skills/`; it does not overwrite existing content.

### Install manually in an existing vault

1. Download and extract `ai-knowledge-workflow-0.3.4.zip`.
2. Place the extracted `ai-knowledge-workflow` folder in your vault's `.obsidian/plugins/` directory. If your vault uses a custom configuration directory, use its `plugins/` subdirectory instead.
3. Reload Obsidian and enable **AI Knowledge Workflow** under **Settings → Community plugins**.
4. Run **AI Knowledge: Initialize vault structure** from the command palette. Review the files it proposes to create, then confirm. Initialization adds missing vault files and the three companion skills under `.agents/skills/`; it does not overwrite existing content.

To update manually, replace `main.js`, `manifest.json`, and `styles.css`, and keep your own `data.json`. The installation package does not contain personal configuration. After updating an existing vault, run **AI Knowledge: Initialize vault structure** again to add missing skill files. Existing files are preserved and are not automatically updated.

### Start with an empty vault

Download and extract `ai-knowledge-starter-0.3.4.zip`. In Obsidian, choose **Open folder as vault** and select the extracted vault folder. Read its `START-HERE.md`, then enable the plugin manually.

## First steps

1. Keep **AI agent = Manual** and leave **Vault root** empty in the plugin settings.
2. Run **AI Knowledge: Add general task** to create a task without linking it to a project.
3. Run **AI Knowledge: Open todo board** to move tasks between states and open their details. Completed tasks appear in the completed list, where you can view or reopen them.
4. When you need project tasks, first create `30-projects/<project>/AGENTS.md`, `index.md`, and `links.md`. The companion project-onboarding skill described below can generate these documents.
5. Run **AI Knowledge: Validate vault** to check the structure. Fill in each new project's target branch to match the actual development task.

| Directory | Purpose |
| --- | --- |
| `10-tasks/` | Task board, completed-task archive, and general tasks |
| `20-workflows/` | The four workflow types and their execution records |
| `30-projects/` | Stable project knowledge and project tasks |
| `80-inbox/` | Raw input that has not been organized yet |
| `90-templates/` | Templates for new tasks and workflows |
| `rules/` | Vault instructions for AI assistants |
| `.agents/skills/` | Companion skill instructions, templates, and Python scripts |

The YAML `status` in each task entry is the source of task status; the plugin synchronizes the board and archive. Completing a task records `completed_at`. Reopening clears that timestamp, and completing the task again records a new one. Newly generated links use standard Markdown syntax; existing Wiki links can still be read.

## Optional companion AI skills

The plugin includes three companion skills: project onboarding, task management, and weekly summaries. Run **AI Knowledge: Initialize vault structure** to preview the three skills and their destination, `.agents/skills/`. After you confirm, initialization adds their missing instructions, templates, and Python scripts: 17 files in total. You do not need to download the skills separately, including when installing through Obsidian.

You can run initialization again in an existing vault to add missing files. It preserves every existing file and does not automatically update skills. The Starter package contains the same skill files. Their source is available in `companion-skills/` in the repository.

Initialization works offline. It does not download or execute scripts, start an AI session, install Python or a CLI, or change global assistant settings. Your AI assistant controls whether it discovers, loads, and uses the skill files; creating them does not guarantee that a running assistant has loaded them.

The plugin's basic features remain usable without AI or Python. Running the skill scripts requires Python 3. To use AI-assisted actions, separately install and configure your chosen CLI and any required account; external services may charge fees.

The custom CLI command is empty by default. To use it, configure a complete non-interactive command that accepts prompts through standard input. The plugin does not append extra command arguments.

Background skill execution inherits the CLI's existing permissions and sandbox settings. It does not automatically expand write access. If the CLI only permits reading, use an interactive terminal and follow its authorization prompts.

## Platforms and external integrations

Choose **WPS** or **飞书 (Feishu)** under **Settings → AI Knowledge Workflow → 任务来源应用**. WPS is the default. All tasks, including completed tasks, follow this setting for source labels and opening actions; open boards refresh immediately. Switching apps preserves existing source names and links.

Feishu source actions request a client search by name and try to copy the search text for manual pasting. Install and sign in to the Feishu desktop client first. Existing links for the selected app open directly; links for the other app fall back to searching by name. The Markdown field remains `wps:` for backward compatibility and no longer determines which app opens.

Requires Obsidian desktop 1.5.0 or later. Mobile devices are not supported.

| Feature | Requirements and limitations |
| --- | --- |
| Local task and knowledge management | Implemented using desktop APIs; real-device validation on Windows and Linux is still pending |
| Copy context to an assistant | Does not require a terminal plugin |
| Run skills through Codex or a custom CLI | Prepare the relevant CLI and account, and have your assistant load the companion skills; external services may charge fees |
| Embedded terminal in Obsidian | Uses the optional, separately installed Terminal community plugin; requires a configured POSIX shell; automatic launch is unavailable on Windows |
| iTerm, Warp, and WPS automation | macOS only; requires the corresponding application; the operating system may request automation permission |
| Codex application links | Requires an installed desktop application that handles the corresponding links |

Double-click a file in the file explorer to open it with the system default app, including Markdown, TXT, and PDF files. Single clicks keep Obsidian's normal behavior, and folders still expand and collapse normally. The context menu also provides **Open with system default app**.

By default, the plugin does not modify the Terminal plugin's configuration or force changes to sidebar and tab layouts.

## Privacy, network use, and local file access

- The plugin itself has no telemetry, direct model API requests, self-updating logic, or dependency installation. Basic task management works offline.
- When you explicitly select a Codex or custom CLI feature, the plugin runs the local command you configured and passes the selected prompt and context to that CLI. The CLI may read the vault and source-code directories and send content to its configured service. Codex typically connects to OpenAI; a custom CLI connects to the service you choose. Account requirements, fees, and data handling depend on the CLI and its service configuration.
- External commands run with the current user's file permissions and are not confined to the Obsidian vault. Project source paths and the Vault root override may point outside the vault. Configure only commands and directories you trust.
- On macOS, selecting Warp and explicitly opening an AI workspace creates or overwrites `~/.warp/launch_configurations/ai-knowledge-workflow.yaml` in the user's home directory. This file stores the working directory, CLI command, and optional task reference for that workspace, and remains on disk. Other terminal and application launch features invoke system applications or link handlers.
- Copying context to the system clipboard or passing it to another application requires an explicit user action. The plugin package does not include API keys, personal tasks, company project documents, or user runtime settings.

## Development and packaging

Requires Node.js 22.13 or later and npm. Creating ZIP packages also requires Python 3.

```sh
npm ci --ignore-scripts
npm run lint
npm run build
npm run package
```

`build` performs type checking and produces a production `main.js` without source maps. `package` generates a plugin ZIP, a clean Starter ZIP, the three release files, and checksums in `dist/`. Use `npm run dev` for development watch mode.

Function-level validation has covered empty-vault initialization, creation of all four workflow types, task archiving and reopening, special characters in titles, encoded paths, and custom configuration directories. Real Obsidian UI validation and real-device validation on Windows and Linux are still pending. See the [validation record](docs/VALIDATION.md) for the evidence and its limits.

See the [publishing guide](docs/PUBLISHING.md) for release steps and the [changelog](CHANGELOG.md) for changes. These supporting documents are currently in Chinese.

## License

MIT; see [LICENSE](LICENSE). This plugin bundles Zod; its license and copyright notice are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). AI Knowledge Workflow is an independent community project.
