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

AI Knowledge Workflow is available in the Obsidian community directory.

### Install from the community directory

1. Open the plugin's public listing and select **Add to Obsidian**.
2. Follow the prompts in Obsidian to install and enable **AI Knowledge Workflow** in your chosen vault.
3. Run **AI Knowledge: Initialize vault structure** from the command palette. Review the proposed files before confirming. Initialization only adds missing files; it does not overwrite existing content.

### Install manually in an existing vault

1. Download and extract `ai-knowledge-workflow-0.3.2.zip`.
2. Place the extracted `ai-knowledge-workflow` folder in your vault's `.obsidian/plugins/` directory. If your vault uses a custom configuration directory, use its `plugins/` subdirectory instead.
3. Reload Obsidian and enable **AI Knowledge Workflow** under **Settings → Community plugins**.
4. Run **AI Knowledge: Initialize vault structure** from the command palette. Review the files it proposes to create, then confirm. Initialization only adds missing files; it does not overwrite existing content.

To update, replace `main.js`, `manifest.json`, and `styles.css`, and keep your own `data.json`. The installation package does not contain personal configuration.

### Start with an empty vault

Download and extract `ai-knowledge-starter-0.3.2.zip`. In Obsidian, choose **Open folder as vault** and select the extracted vault folder. Read its `START-HERE.md`, then enable the plugin manually.

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

The YAML `status` in each task entry is the source of task status; the plugin synchronizes the board and archive. Completing a task records `completed_at`. Reopening clears that timestamp, and completing the task again records a new one. Newly generated links use standard Markdown syntax; existing Wiki links can still be read.

## Optional companion AI skills

The source repository includes three skills in `companion-skills/`: project onboarding, task management, and weekly summaries. They are installed separately from the Obsidian plugin. The plugin does not install them automatically.

Copy the three skill folders into your vault's `.agents/skills/` directory, then load them using your AI assistant's skill-discovery mechanism. The Starter package already includes these files; your AI assistant decides whether to read and execute them. Their scripts require Python 3.

The custom CLI command is empty by default. To use it, configure a complete non-interactive command that accepts prompts through standard input. The plugin does not append extra command arguments.

Background skill execution inherits the CLI's existing permissions and sandbox settings. It does not automatically expand write access. If the CLI only permits reading, use an interactive terminal and follow its authorization prompts.

## Platforms and external integrations

Requires Obsidian desktop 1.5.0 or later. Mobile devices are not supported.

| Feature | Requirements and limitations |
| --- | --- |
| Local task and knowledge management | Implemented using desktop APIs; real-device validation on Windows and Linux is still pending |
| Copy context to an assistant | Does not require a terminal plugin |
| Run skills through Codex or a custom CLI | Install, sign in to, and configure the relevant CLI and companion skills yourself; external services may charge fees |
| Embedded terminal in Obsidian | Uses the optional, separately installed Terminal community plugin; requires a configured POSIX shell; automatic launch is unavailable on Windows |
| iTerm, Warp, and WPS automation | macOS only; requires the corresponding application; the operating system may request automation permission |
| Codex application links | Requires an installed desktop application that handles the corresponding links |

By default, the plugin does not modify the Terminal plugin's configuration, take over file-list clicks, or force changes to sidebar and tab layouts.

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
