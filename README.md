# AI Knowledge Workflow

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

本版本是社区目录提交前的发布准备版；目前可手动安装。后续正式上架状态以 Obsidian 社区目录为准。

### 已有知识库

1. 取得发布包 `ai-knowledge-workflow-0.3.0.zip` 并解压。
2. 将其中的 `ai-knowledge-workflow` 文件夹放入知识库的 `.obsidian/plugins/`。如果使用自定义配置目录，则放在该目录的 `plugins/` 下。
3. 重新加载 Obsidian，在设置 → 第三方插件中启用 **AI Knowledge Workflow**。
4. 在命令面板运行 **AI Knowledge: Initialize Vault Structure**，查看将要创建的内容并确认。初始化只补齐缺失文件，不覆盖已有内容。

更新时替换 `main.js`、`manifest.json`、`styles.css`，保留自己的 `data.json`。安装包不包含个人配置。

### 从零开始

取得 `ai-knowledge-starter-0.3.0.zip`，解压后在 Obsidian 中选择“打开本地仓库”，选中解压的知识库文件夹。阅读其中的 `START-HERE.md`，手动启用插件即可。

## 第一次使用

1. 保持插件设置的 **AI agent = Manual**，**Vault root 留空**。
2. 运行 **AI Knowledge: Add General Task**，创建一条不关联项目的任务。
3. 运行 **AI Knowledge: Open Todo Board**，移动状态、打开入口，完成后在已完成列表中查看或重开。
4. 需要项目任务时，先建立 `30-projects/<project>/AGENTS.md`、`index.md` 和 `links.md`。可使用下面的配套项目知识技能生成资料。
5. 运行 **AI Knowledge: Validate Vault**，检查当前结构。新项目的目标分支需要按真实开发任务填写。

| 目录 | 用途 |
| --- | --- |
| `10-tasks/` | 任务看板、完成归档、通用任务 |
| `20-workflows/` | 四类复杂工作流及执行记录 |
| `30-projects/` | 项目稳定知识和项目任务 |
| `80-inbox/` | 尚未整理的原始输入 |
| `90-templates/` | 新任务和工作流模板 |
| `rules/` | 提供给 AI 助手的知识库规则 |

任务入口的 YAML `status` 是状态来源；看板和归档由插件同步。完成时间写入 `completed_at`，重开清除，再次完成时重新记录。新生成链接采用标准 Markdown；已有 Wiki 链接仍可读取。

## 可选：配套 AI 技能

源码中的 `companion-skills/` 提供项目资料生成、任务管理和周报三个技能。它们与 Obsidian 插件分别安装；插件不会自行安装它们。

将三个技能文件夹复制到知识库的 `.agents/skills/`，再按所用 AI 助手的技能发现方式加载。Starter 已包含这些文件，是否读取和执行由 AI 助手决定。运行其中的脚本需要 Python 3。自定义 CLI 默认留空；如需使用，请填写能够从标准输入接收提示词的完整非交互命令，插件不会额外追加命令参数。后台技能执行继承 CLI 已有的权限与沙箱设置，不自动扩大写入权限；如果 CLI 只允许读取，请改用交互终端按提示授权。

## 平台与外部集成

需要 Obsidian 桌面版 1.5.0 或更新版本。移动端不支持。

| 功能 | 说明 |
| --- | --- |
| 本地任务和知识管理 | 按桌面 API 实现；Windows/Linux 尚未进行真实设备验收 |
| 复制上下文给助手 | 不依赖终端插件 |
| Codex / 自定义 CLI 技能执行 | 需自行安装、登录并配置相应 CLI 和配套技能；服务可能收费 |
| Obsidian 内嵌终端 | 可选的独立 Terminal 社区插件；需配置 POSIX shell；Windows 自动启动不可用 |
| iTerm / Warp / WPS 自动化 | 仅 macOS，需对应软件；系统可能提示自动化授权 |
| Codex 应用链接 | 需已安装能够处理对应链接的桌面应用 |

默认不会修改 Terminal 插件配置，不会接管文件列表点击或强制调整侧栏和标签布局。

## 隐私、网络与本地文件访问

- 插件本身不包含遥测、直接模型 API 请求、自更新或依赖安装逻辑。基本任务管理可离线使用。
- 主动选择 Codex / 自定义 CLI 功能时，插件运行你设置的本机命令，并把选定的提示词和上下文交给该 CLI。CLI 可能读取知识库和源码目录，将内容发送到其配置的服务。Codex 通常连接 OpenAI，自定义 CLI 连接你所选择的服务；账号、费用和数据处理取决于所用 CLI 及其服务配置。
- 外部命令拥有当前用户的文件权限，并不限制在 Obsidian 知识库内。项目源码路径和 Vault root 覆盖设置可能指向知识库外；只配置你信任的命令和目录。
- 在 macOS 选择 Warp 并主动打开 AI 工作区时，会创建或覆盖用户目录的 `~/.warp/launch_configurations/ai-knowledge-workflow.yaml`，保存本次工作目录、CLI 命令及可选任务引用；配置会留在磁盘。其他终端/应用打开功能会调用系统应用或链接处理程序。
- 向系统剪贴板复制上下文或交给外部应用，由相应操作显式触发。插件包不包含 API key、个人任务、公司项目资料或用户运行配置。

## 开发与打包

需要 Node.js 20+ 和 npm；生成 ZIP 还需要 Python 3。

```sh
npm ci
npm run build
npm run package
```

`build` 包含类型检查并生成生产版 `main.js`，不附带源映射。`package` 生成插件包、干净 Starter、三个发布文件和校验和，输出在 `dist/`。开发监听使用 `npm run dev`。

已通过空库初始化、四类工作流创建、任务归档/重开、特殊标题、编码路径和自定义配置目录的实际函数验证。真实 Obsidian UI 和 Windows/Linux 设备验收仍需完成，详情见 [验证记录](docs/VALIDATION.md)。

发布步骤见 [发布指南](docs/PUBLISHING.md)，变更见 [CHANGELOG](CHANGELOG.md)。

## License

MIT，见 [LICENSE](LICENSE)。包含 Zod，许可及版权见 [第三方声明](THIRD_PARTY_NOTICES.md)。本插件为独立社区项目。
