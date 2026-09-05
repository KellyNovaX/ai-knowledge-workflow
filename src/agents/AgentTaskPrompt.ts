import { TFile } from "obsidian";
import { BoardTask, TASK_BOARD_PATH } from "../vault/TaskBoard";
import { TaskScope } from "../types";

export interface InboxOrganizePromptInput {
  vaultRoot: string;
  inboxPath: string;
  mode: "file" | "folder";
  fileList?: string[];
}

export function buildAgentPromptForBoardTask(task: BoardTask, vaultRoot: string): string {
  const taskEntry = getTaskEntryFromBoardTask(task);

  return buildAgentPrompt({
    vaultRoot,
    taskEntry,
    taskScope: task.taskScope,
    taskText: task.text
  });
}

export function buildAgentPromptForFile(file: TFile, vaultRoot: string): string {
  return buildAgentPrompt({
    vaultRoot,
    taskEntry: file.path,
    taskScope: inferTaskScopeFromPath(file.path)
  });
}

export function buildInboxOrganizePrompt(input: InboxOrganizePromptInput): string {
  const inboxPath = formatTaskEntryPath(input.inboxPath, input.vaultRoot);
  const fileList = (input.fileList ?? []).map((path) => `- ${path}`).join("\n") || "- 单文件整理，无文件清单";

  return [
    input.mode === "folder" ? "请批量整理这个 inbox 文件夹：" : "请整理这个 inbox 材料：",
    "",
    `vault 根目录：${input.vaultRoot || "当前 vault"}`,
    `${input.mode === "folder" ? "inbox 文件夹" : "inbox 文件"}：${inboxPath}`,
    "",
    "文件清单：",
    fileList,
    "",
    "执行规则：",
    "1. 先读取 vault 根目录 `AGENTS.md`；如果存在 `80-inbox/AGENTS.md`，再读取它。",
    "2. 只读取本 inbox 材料、必要索引和与整理直接相关的文件，不递归扫描整个 vault。",
    "3. 批量整理时先根据文件名、目录结构和少量摘要生成整理计划；不要一开始全文读取所有文件。",
    "4. 判断材料归类：一次性项目任务、复杂 workflow、跨项目长期知识、运维 SOP、或需要用户确认。",
    "5. 一次性项目任务写入 `30-projects/<project>/inputs/YYYY/MM/p-<id>-<slug>/`；复杂任务写入 `20-workflows/w-<id>-<slug>/`。",
    "6. 跨项目长期知识写入 `40-knowledge-base/`，必须使用规范 frontmatter，并同步更新 `40-knowledge-base/index.md`。",
    "7. 运维、环境、排障 SOP 写入 `40-knowledge-base/`，并保留来源链接。",
    "8. 不确定项目归属、是否长期知识、是否创建 workflow、标题或分类时，先问用户。",
    "9. 完成后说明创建、移动、修改了哪些文件，并写明未处理项和后续待办。",
    "",
    "跨项目知识推荐规则：",
    "1. 推荐相关知识时优先读取 `40-knowledge-base/index.md`。",
    "2. 只基于标题、summary、tags、aliases、projects 做候选筛选；用户确认前不要默认读取全文。",
    "3. 最多推荐 5 条候选，每条给出理由和置信度。",
    "4. 未找到明确候选时直接说明，不要强行关联。",
    "",
    "输出要求：先给整理计划和待确认问题；用户确认后再落盘。"
  ].join("\n");
}

function buildAgentPrompt(input: {
  vaultRoot: string;
  taskEntry: string;
  taskScope: TaskScope;
  taskText?: string;
}): string {
  const taskEntry = formatTaskEntryPath(input.taskEntry, input.vaultRoot);
  const contextRoot = formatTaskEntryPath(getContextRoot(input.taskEntry, input.taskScope), input.vaultRoot);
  const projectEntry = getProjectEntry(input.taskEntry);
  const sourceEntry = projectEntry ? `${projectEntry}/links.md` : "按任务入口或 workflow 记录读取";

  return [
    getCopyPromptHeading(input.taskScope),
    "",
    `vault 根目录：${input.vaultRoot || "当前 vault"}`,
    `任务入口：${taskEntry}`,
    `上下文根：${contextRoot}`,
    `任务类型：${input.taskScope}`,
    `任务标题：${input.taskText ?? "见任务入口"}`,
    `关联项目：${projectEntry ?? "见任务入口"}`,
    "目标分支：见任务入口中的 `目标分支`，为 `待填写` 或为空时先让用户补充",
    `源码入口：${sourceEntry}`,
    "",
    "按需读取规则：",
    "1. 只读取 vault 根目录 `AGENTS.md`。",
    "2. 读取上面的任务入口，并以“上下文根”为当前任务上下文。",
    "3. 需要确认需求、范围或执行前确认项时，才读取任务入口指向的 `overview.md`。",
    "4. 若已读取的 `overview.md` 存在 `状态：待确认` 的确认项，先基于当前任务上下文给出 AI 建议，再请用户确认或选择；用户确认后写回对应确认项。已确认或无需确认的确认项不要重复询问。",
    "5. 对 `related_knowledge` 确认项，优先读取 `40-knowledge-base/index.md`，只基于标题、summary、tags、aliases、projects 推荐最多 5 条候选；用户确认前不要默认读取知识全文。",
    "6. 需要项目稳定知识时读取项目 `AGENTS.md`；需要源码路径或文档入口时读取项目 `links.md`。",
    "7. 只读取与任务直接相关的源码、日志、数据库或外部文档。",
    "",
    "约束：不要递归扫描整个 vault；不要读取无关 workflow、无关项目 inputs 或无关源码目录；任务完成后把执行结果、修改文件、验证方式、风险和后续待办写入当前任务或 workflow 的 `execution.md`，不要追加到 `AGENTS.md`。"
  ].join("\n");
}

function getTaskEntryFromBoardTask(task: BoardTask): string {
  const primaryLink = task.links.find((link) => isTaskEntryLink(link.target)) ?? task.links[0];
  return primaryLink?.target ?? `${TASK_BOARD_PATH}:${task.line}`;
}

function isTaskEntryLink(path: string): boolean {
  return (
    path.startsWith("30-projects/") ||
    path.startsWith("20-workflows/") ||
    path === TASK_BOARD_PATH
  );
}

function inferTaskScopeFromPath(path: string): TaskScope {
  if (path.startsWith("20-workflows/")) {
    return TaskScope.Workflow;
  }

  if (path.startsWith("30-projects/")) {
    return TaskScope.Project;
  }

  return TaskScope.General;
}

function getCopyPromptHeading(taskScope: TaskScope): string {
  if (taskScope === TaskScope.Workflow) {
    return "按这个 workflow 入口继续处理：";
  }

  if (taskScope === TaskScope.Project) {
    return "按这个项目任务入口继续处理：";
  }

  return "按这个通用待办位置继续处理：";
}

function getContextRoot(path: string, taskScope: TaskScope): string {
  const filePath = path.split(/:(.+)/)[0];

  if (taskScope === TaskScope.Workflow) {
    const workflowMatch = filePath.match(/^(20-workflows\/[^/]+)/);
    return workflowMatch?.[1] ?? parentPath(filePath);
  }

  if (taskScope === TaskScope.Project && (filePath.endsWith("/AGENTS.md") || filePath.endsWith("/index.md"))) {
    return parentPath(filePath);
  }

  return parentPath(filePath) || TASK_BOARD_PATH;
}

function getProjectEntry(path: string): string | null {
  const projectMatch = path.match(/^(30-projects\/[^/]+)/);
  return projectMatch?.[1] ?? null;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function formatTaskEntryPath(path: string, vaultRoot: string): string {
  if (isAbsolutePath(path) || !vaultRoot.trim()) {
    return path;
  }

  const [filePath, suffix] = path.split(/:(.+)/);
  return `${vaultRoot.replace(/\/+$/, "")}/${filePath}${suffix ? `:${suffix}` : ""}`;
}

function isAbsolutePath(path: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i.test(path);
}
