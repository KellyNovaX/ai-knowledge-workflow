# AI Knowledge Workflow

[English](README.md) | 简体中文

在 Obsidian 中管理工程知识、任务和工作流，把清晰的上下文交给 AI 编程助手。

Organize project knowledge, track tasks, and prepare structured context for AI coding agents. The core workflow runs locally without an AI account. Desktop only; the interface is primarily Chinese.

## 能做什么

- **任务看板**：管理待办、进行中、等待、待发布和积压任务，完成后归档，也可以重开。
- **项目资料**：将项目入口、源码位置、环境说明和操作手册组织成普通 Markdown。
- **四类工作流**：需求开发、问题排查、数据修复、数据导出，创建对应的记录和模板。
- **结构检查**：检查任务状态、上下文和本地链接，减少资料与看板不同步。
- **可选 AI 协作**：复制上下文到你使用的助手，或调用本机已安装的 Codex 或自定义 CLI。

所有任务内容保存在普通 Markdown 文件中。默认使用手工模式，不需要 AI 服务、API key 或其他插件即可创建、移动、完成和重开任务。

源码仓库：[KellyNovaX/ai-knowledge-workflow](https://github.com/KellyNovaX/ai-knowledge-workflow)。

## 安装

AI Knowledge Workflow 已有 Obsidian 社区目录公开展示页，客户端搜索是否已收录尚未确认。如果 **Add to Obsidian** 未能打开可安装的条目，请使用下方 ZIP 手动安装方式。

### 从社区目录安装

1. 打开插件的公开展示页，点击 **Add to Obsidian**。
2. 按 Obsidian 中的提示，在要使用的知识库中安装并启用 **AI Knowledge Workflow**。
3. 在命令面板运行 **AI Knowledge: Initialize vault structure**，查看将要创建的内容并确认。初始化会补齐知识库文件和 `.agents/skills/` 下的三个配套技能，不覆盖已有内容。

### 在已有知识库中手动安装

1. 取得发布包 `ai-knowledge-workflow-0.3.3.zip` 并解压。
2. 将其中的 `ai-knowledge-workflow` 文件夹放入知识库的 `.obsidian/plugins/`。如果使用自定义配置目录，则放在该目录的 `plugins/` 下。
3. 重新加载 Obsidian，在设置 → 第三方插件中启用 **AI Knowledge Workflow**。
4. 在命令面板运行 **AI Knowledge: Initialize vault structure**，查看将要创建的内容并确认。初始化会补齐知识库文件和 `.agents/skills/` 下的三个配套技能，不覆盖已有内容。

手动更新时替换 `main.js`、`manifest.json`、`styles.css`，保留自己的 `data.json`。安装包不包含个人配置。旧知识库更新后可再次运行 **AI Knowledge: Initialize vault structure**，补齐缺失的技能文件；已有文件保留，不会自动更新。

### 从零开始

取得 `ai-knowledge-starter-0.3.3.zip`，解压后在 Obsidian 中选择“打开本地仓库”，选中解压的知识库文件夹。阅读其中的 `START-HERE.md`，手动启用插件即可。

## 第一次使用

1. 保持插件设置的 **AI agent = Manual**，**Vault root 留空**。
2. 运行 **AI Knowledge: Add general task**，创建一条不关联项目的任务。
3. 运行 **AI Knowledge: Open todo board**，移动状态、打开入口，完成后在已完成列表中查看或重开。
4. 需要项目任务时，先建立 `30-projects/<project>/AGENTS.md`、`index.md` 和 `links.md`。可使用下面的配套项目知识技能生成资料。
5. 运行 **AI Knowledge: Validate vault**，检查当前结构。新项目的目标分支需要按真实开发任务填写。

| 目录 | 用途 |
| --- | --- |
| `10-tasks/` | 任务看板、完成归档、通用任务 |
| `20-workflows/` | 四类复杂工作流及执行记录 |
| `30-projects/` | 项目稳定知识和项目任务 |
| `80-inbox/` | 尚未整理的原始输入 |
| `90-templates/` | 新任务和工作流模板 |
| `rules/` | 提供给 AI 助手的知识库规则 |
| `.agents/skills/` | 配套技能说明、模板和 Python 脚本 |

任务入口的 YAML `status` 是状态来源；看板和归档由插件同步。完成时间写入 `completed_at`，重开清除，再次完成时重新记录。新生成链接采用标准 Markdown；已有 Wiki 链接仍可读取。

## 可选：配套 AI 技能

插件内置项目资料生成、任务管理和周报三个配套技能。运行 **AI Knowledge: Initialize vault structure**，预览会说明三个技能及目标目录 `.agents/skills/`；确认后补齐缺失的技能说明、模板和 Python 脚本，共 17 个文件。通过 Obsidian 安装插件的用户也无需另行下载技能。

旧知识库可再次运行初始化补齐缺失文件。已有文件全部保留，技能不会自动更新。Starter 包包含完全相同的技能文件；源码位于仓库的 `companion-skills/`。

初始化离线完成，不下载或执行脚本，不启动 AI 会话，不安装 Python 或 CLI，也不修改全局助手配置。技能是否被发现、加载和使用由 AI 助手决定；写入文件不代表正在运行的助手已经加载它们。

插件基本功能仍不依赖 AI 或 Python。运行技能脚本需要自行准备 Python 3；使用 AI 协作功能还需自行安装、配置相应 CLI 和所需账号，外部服务可能收费。

自定义 CLI 默认留空；如需使用，请填写能够从标准输入接收提示词的完整非交互命令，插件不会额外追加命令参数。后台技能执行继承 CLI 已有的权限与沙箱设置，不自动扩大写入权限；如果 CLI 只允许读取，请改用交互终端按提示授权。

## 平台与外部集成

在设置 → AI Knowledge Workflow → **任务来源应用** 中选择 **WPS** 或 **飞书**（默认 WPS）。所有任务（含已完成任务）的来源标签、编辑按钮和打开入口统一跟随设置，切换后已打开的看板立即刷新，已有来源名称和链接不会被批量改写。

选择飞书后，点击来源旁的聊天图标可按名称唤起飞书搜索，并尽可能复制搜索词以便手动粘贴；需安装并登录飞书桌面客户端。同平台的已有链接直接打开，切换后不属于所选平台的旧链接改为按来源名称搜索。为兼容旧知识库，任务 Markdown 继续使用 `wps:` 保存来源信息，该字段不再决定打开哪个应用。

需要 Obsidian 桌面版 1.5.0 或更新版本。移动端不支持。

| 功能 | 说明 |
| --- | --- |
| 本地任务和知识管理 | 按桌面 API 实现；Windows/Linux 尚未进行真实设备验收 |
| 复制上下文给助手 | 不依赖终端插件 |
| Codex / 自定义 CLI 技能执行 | 需自行准备相应 CLI 和账号，并让助手加载配套技能；服务可能收费 |
| Obsidian 内嵌终端 | 可选的独立 Terminal 社区插件；需配置 POSIX shell；Windows 自动启动不可用 |
| iTerm / Warp / WPS 自动化 | 仅 macOS，需对应软件；系统可能提示自动化授权 |
| 飞书任务来源 | 通过客户端链接唤起搜索或打开已有飞书链接；需飞书桌面客户端 |
| Codex 应用链接 | 需已安装能够处理对应链接的桌面应用 |

在文件列表中双击文件，可用系统默认程序打开（包括 Markdown、TXT、PDF 等）；单击仍按 Obsidian 原有方式打开，文件夹仍可正常展开和收起。右键菜单也提供 **Open with system default app**。

默认不会修改 Terminal 插件配置或强制调整侧栏和标签布局。

## 隐私、网络与本地文件访问

- 插件本身不包含遥测、直接模型 API 请求、自更新或依赖安装逻辑。基本任务管理可离线使用。
- 主动选择 Codex / 自定义 CLI 功能时，插件运行你设置的本机命令，并把选定的提示词和上下文交给该 CLI。CLI 可能读取知识库和源码目录，将内容发送到其配置的服务。Codex 通常连接 OpenAI，自定义 CLI 连接你所选择的服务；账号、费用和数据处理取决于所用 CLI 及其服务配置。
- 外部命令拥有当前用户的文件权限，并不限制在 Obsidian 知识库内。项目源码路径和 Vault root 覆盖设置可能指向知识库外；只配置你信任的命令和目录。
- 在 macOS 选择 Warp 并主动打开 AI 工作区时，会创建或覆盖用户目录的 `~/.warp/launch_configurations/ai-knowledge-workflow.yaml`，保存本次工作目录、CLI 命令及可选任务引用；配置会留在磁盘。其他终端/应用打开功能会调用系统应用或链接处理程序。
- 向系统剪贴板复制上下文或交给外部应用，由相应操作显式触发。插件包不包含 API key、个人任务、公司项目资料或用户运行配置。

## 开发与打包

需要 Node.js 22.13+ 和 npm；生成 ZIP 还需要 Python 3。

```sh
npm ci --ignore-scripts
npm run lint
npm run build
npm run package
```

`build` 包含类型检查并生成生产版 `main.js`，不附带源映射。`package` 生成插件包、干净 Starter、三个发布文件和校验和，输出在 `dist/`。开发监听使用 `npm run dev`。

已通过空库初始化、四类工作流创建、任务归档/重开、特殊标题、编码路径和自定义配置目录的实际函数验证。真实 Obsidian UI 和 Windows/Linux 设备验收仍需完成，详情见 [验证记录](docs/VALIDATION.md)。

发布步骤见 [发布指南](docs/PUBLISHING.md)，变更见 [CHANGELOG](CHANGELOG.md)。

## License

MIT，见 [LICENSE](LICENSE)。包含 Zod，许可及版权见 [第三方声明](THIRD_PARTY_NOTICES.md)。本插件为独立社区项目。
