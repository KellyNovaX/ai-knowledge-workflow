import { App, ListedFiles } from "obsidian";
import {
  getTaskStatusLabel,
  normalizeTaskStatusValue,
  TASK_PRIORITY_ORDER
} from "../constants";
import { TaskPriority, TaskScope, TaskStatus } from "../types";
import { readTaskFileMetadata, TaskFileMetadata, updateTaskFileContent, updateTaskFileMetadata } from "./TaskFileMetadata";
import { extractLocalMarkdownLinks, findLocalLinkTarget, resolveLocalLinkTarget } from "./MarkdownLinks";
import { ProjectRepository } from "./ProjectRepository";

export const TASK_BOARD_PATH = "10-tasks/board.md";
export const TASK_DONE_PATH = "10-tasks/done.md";

const DEFAULT_TASK_DONE_CONTENT = [
  "# Tasks Done",
  "",
  "归档已完成事项，保留必要链接，避免把处理过程复制到这里。",
  ""
].join("\n");

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const TASK_LINE_PATTERN = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+?)\s*$/;
const PRIORITY_PATTERN = /^\[(P[0-4])\]\s+(.+)$/;
const DUE_DATE_PATTERN = /\bdue:(\d{4}-\d{2}-\d{2})\b/;
const BOARD_CREATED_AT_PATTERN = /\bcreated:(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)\b/;
const CREATED_AT_PATTERN = /^-\s*创建时间[：:]\s*(.+?)\s*$/m;
const TASK_ID_PATTERN = /\b(?:tid:(\d+)|id:([pwg]-\d+))\b/;
const TASK_SCOPE_PATTERN = /#task\/(general|project|workflow)\b/;
const LEGACY_GENERAL_TAG_PATTERN = /(?:^|\s)#general\b/g;
const PROJECT_METADATA_PATTERN = /[；;]\s*关联项目\s*[：:]\s*([^#\n]*?)(?=\s+due:|\s+wps:|\s+#task\/|\s+id:|\s+tid:|\s+created:|$)/;
const WPS_TARGET_PREFIX_PATTERN = /(?:^|\s)wps:/g;
const LINK_PATTERN = /(?:\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]|\[([^\]]*)]\(([^)#]+)(?:#[^)]+)?\))/g;
const EXTERNAL_LINK_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

enum VaultRootDirectory {
  Tasks = "10-tasks",
  Workflows = "20-workflows",
  Projects = "30-projects"
}

export enum TaskBoardSortMode {
  Priority = "priority",
  Manual = "manual"
}

export enum TaskManualMoveDirection {
  Up = "up",
  Down = "down"
}

export interface BoardTaskLink {
  label: string;
  target: string;
}

export interface BoardTaskWpsTarget {
  label: string;
  url: string | null;
}

export interface BoardTask {
  line: number;
  endLine: number;
  order: number;
  status: TaskStatus;
  sourcePath?: string;
  documentStatus?: TaskStatus;
  checked: boolean;
  priority: TaskPriority;
  hasExplicitPriority: boolean;
  dueDate: string | null;
  createdAt: string | null;
  taskId: string | null;
  taskScope: TaskScope;
  project: string | null;
  projects: string[];
  text: string;
  rawBody: string;
  rawLine: string;
  rawLines: string[];
  links: BoardTaskLink[];
  // 沿用 wps 来源字段以兼容旧知识库，打开应用由全局设置决定。
  wpsTargets: BoardTaskWpsTarget[];
}

export interface TaskStatusMove {
  task: BoardTask;
  toStatus: TaskStatus;
}

export interface TaskPriorityUpdate {
  task: BoardTask;
  priority: TaskPriority;
}

export interface TaskDueDateUpdate {
  task: BoardTask;
  dueDate: string | null;
}

export interface TaskTitleUpdate {
  task: BoardTask;
  title: string;
}

export interface TaskManualMove {
  task: BoardTask;
  direction: TaskManualMoveDirection;
}

export interface TaskNotesUpdate {
  task: BoardTask;
  notes: string[];
}

export interface TaskWpsTargetsUpdate {
  task: BoardTask;
  wpsTargets: BoardTaskWpsTarget[];
}

export interface TaskProjectUpdate {
  task: BoardTask;
  project: string;
}

export interface TaskWorkflowProjectsUpdate {
  task: BoardTask;
  projects: string[];
}

export class TaskBoard {
  constructor(private readonly app: App) {}

  async listTasks(): Promise<BoardTask[]> {
    return this.hydrateTaskCreationTimes(parseTaskBoard(await this.readTaskBoard()));
  }

  async listDoneTasks(): Promise<BoardTask[]> {
    if (!(await this.app.vault.adapter.exists(TASK_DONE_PATH))) {
      return [];
    }

    const content = await this.app.vault.adapter.read(TASK_DONE_PATH);
    return this.hydrateTaskCreationTimes(parseTaskDoneArchive(content));
  }

  async moveTask(move: TaskStatusMove): Promise<void> {
    const sourcePath = move.task.sourcePath ?? TASK_BOARD_PATH;
    const content = await this.app.vault.adapter.read(sourcePath);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, move.task);
    if (taskIndex === -1) throw new Error("Selected task no longer exists in its task document.");
    if (sourcePath === TASK_DONE_PATH && move.toStatus === TaskStatus.Done) {
      await this.requireTaskEntry(move.task);
      return;
    }

    const nextLines = [...lines];
    nextLines.splice(taskIndex, move.task.rawLines.length);
    const movedLines = renderTaskBlock(move.task, move.toStatus);
    if (move.toStatus === TaskStatus.Done) {
      const archiveExists = await this.app.vault.adapter.exists(TASK_DONE_PATH);
      const archiveContent = archiveExists ? await this.app.vault.adapter.read(TASK_DONE_PATH) : DEFAULT_TASK_DONE_CONTENT;
      await this.writeTaskDocuments(move.task, { status: move.toStatus }, [
        { path: TASK_BOARD_PATH, original: content, next: nextLines.join(newline) },
        { path: TASK_DONE_PATH, original: archiveExists ? archiveContent : null,
          next: appendTaskToDoneArchive(archiveContent, movedLines, new Date().getFullYear()) }
      ]);
      return;
    }

    const boardContent = sourcePath === TASK_DONE_PATH ? await this.readTaskBoard() : content;
    const targetLines = sourcePath === TASK_DONE_PATH ? boardContent.split(/\r?\n/) : nextLines;
    const headingIndex = findStatusHeadingIndex(targetLines, move.toStatus);
    if (headingIndex === -1) {
      const prefix = targetLines.length && targetLines[targetLines.length - 1] !== "" ? [""] : [];
      targetLines.push(...prefix, `## ${getTaskStatusLabel(move.toStatus)}`, ...movedLines);
    } else {
      targetLines.splice(findSectionEnd(targetLines, headingIndex), 0, ...movedLines);
    }
    await this.writeTaskDocuments(move.task, { status: move.toStatus }, [
      { path: TASK_BOARD_PATH, original: boardContent, next: targetLines.join(newline) },
      ...(sourcePath === TASK_DONE_PATH ? [{ path: TASK_DONE_PATH, original: content, next: nextLines.join(newline) }] : [])
    ]);
  }

  async updateTaskPriority(update: TaskPriorityUpdate): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, {
        priority: update.priority,
        forcePriority: true
      })
    );
    await this.writeTaskDocuments(update.task, { priority: update.priority }, [
      { path: TASK_BOARD_PATH, original: content, next: nextLines.join(newline) }
    ]);
  }

  async updateTaskDueDate(update: TaskDueDateUpdate): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, {
        dueDate: update.dueDate,
        forceDueDate: true
      })
    );
    await this.writeTaskDocuments(update.task, { due: update.dueDate ?? undefined }, [
      { path: TASK_BOARD_PATH, original: content, next: nextLines.join(newline) }
    ]);
  }

  async updateTaskTitle(update: TaskTitleUpdate): Promise<void> {
    const title = normalizeTaskTitle(update.title);
    if (!title) {
      throw new Error("Task title cannot be empty.");
    }

    const entryPath = await this.requireTaskEntry(update.task);
    const rename = entryPath ? getTaskEntryRename(entryPath, update.task, title) : null;
    if (rename && rename.fromPath !== rename.toPath && await this.app.vault.adapter.exists(rename.toPath)) {
      throw new Error(`Target task path already exists: ${rename.toPath}`);
    }

    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, { title })
    );

    if (rename) {
      const referenceRename = createReferenceRename(rename, update.task, title);
      for (let i = 0; i < update.task.rawLines.length; i += 1) {
        nextLines[taskIndex + i] = replaceMarkdownReferences(nextLines[taskIndex + i], referenceRename, TASK_BOARD_PATH);
      }
    }

    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));
    await this.updateLinkedTaskTitle(entryPath, title);

    if (rename && rename.fromPath !== rename.toPath) {
      await this.app.vault.adapter.rename(rename.fromPath, rename.toPath);
      await this.updateVaultReferences(createReferenceRename(rename, update.task, title));
    }
  }

  async moveTaskManually(move: TaskManualMove): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, move.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const adjacentIndex = findAdjacentTaskLineIndex(
      lines,
      taskIndex,
      move.task.documentStatus ?? move.task.status,
      move.direction
    );

    if (adjacentIndex === -1) {
      throw new Error(
        move.direction === TaskManualMoveDirection.Up
          ? "Task is already first in this status."
          : "Task is already last in this status."
      );
    }

    const nextLines = swapTaskBlocks(lines, taskIndex, adjacentIndex);
    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));
  }

  async deleteTask(task: BoardTask): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(taskIndex, task.rawLines.length);
    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));

    const entryPath = getTaskEntryPath(task);
    if (!entryPath) {
      return;
    }

    const entryFolder = getTaskEntryFolderForDelete(entryPath);
    if (entryFolder && (await this.app.vault.adapter.exists(entryFolder))) {
      await this.app.vault.adapter.rmdir(entryFolder, true);
    } else if (await this.app.vault.adapter.exists(entryPath)) {
      await this.app.vault.adapter.remove(entryPath);
    }
  }

  async updateTaskNotes(update: TaskNotesUpdate): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, {
        notes: update.notes
      })
    );
    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));
  }

  async updateTaskWpsTargets(update: TaskWpsTargetsUpdate): Promise<void> {
    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, {
        wpsTargets: update.wpsTargets,
        forceWpsTargets: true
      })
    );
    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));
  }

  async updateTaskProject(update: TaskProjectUpdate): Promise<void> {
    const { task, project: newProject } = update;
    const entryPath = await this.requireTaskEntry(task);
    if (!entryPath) {
      throw new Error("Task has no linked entry file.");
    }

    const oldProject = task.project;
    if (!oldProject || oldProject === newProject) {
      return;
    }

    const projects = await new ProjectRepository(this.app).listProjects();
    if (!projects.some((p) => p.name === newProject)) {
      throw new Error(`Project "${newProject}" does not exist.`);
    }

    const entryMatch = entryPath.match(/^(30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+)\/(AGENTS|index)\.md$/);
    if (!entryMatch) {
      throw new Error("Cannot determine task folder path for move.");
    }

    const entryFileName = `${entryMatch[2]}.md`;
    const newFolder = entryMatch[1].replace(
      `30-projects/${oldProject}/inputs/`,
      `30-projects/${newProject}/inputs/`
    );

    if (await this.app.vault.adapter.exists(newFolder)) {
      throw new Error(`Target folder already exists: ${newFolder}`);
    }

    await this.app.vault.adapter.rename(entryMatch[1], newFolder);

    const newEntryPath = `${newFolder}/${entryFileName}`;

    const content = await this.readTaskBoard();
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    for (let i = 0; i < task.rawLines.length; i += 1) {
      nextLines[taskIndex + i] = nextLines[taskIndex + i]
        .replace(`30-projects/${oldProject}/`, `30-projects/${newProject}/`);
    }

    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));

    await updateTaskFileMetadata(this.app, newEntryPath, { project: newProject });

    const fileContent = await this.app.vault.adapter.read(newEntryPath);
    const pathPrefix = `30-projects/${oldProject}/`;
    const newPathPrefix = `30-projects/${newProject}/`;
    let updatedContent = fileContent;
    if (fileContent.includes(pathPrefix)) {
      updatedContent = fileContent.split(pathPrefix).join(newPathPrefix);
    }
    if (updatedContent !== fileContent) {
      await this.app.vault.adapter.write(newEntryPath, updatedContent);
    }
  }

  async updateWorkflowProjects(update: TaskWorkflowProjectsUpdate): Promise<void> {
    const projects = normalizeProjectList(update.projects);
    if (projects.length === 0) {
      throw new Error("Workflow must keep at least one related project.");
    }

    const entryPath = await this.requireTaskEntry(update.task);
    if (!entryPath || !/^20-workflows\/[^/]+\/AGENTS\.md$/.test(entryPath)) {
      throw new Error("Task is not linked to a workflow AGENTS.md file.");
    }

    const knownProjects = await new ProjectRepository(this.app).listProjects();
    const knownProjectNames = new Set(knownProjects.map((project) => project.name));
    for (const project of projects) {
      if (!knownProjectNames.has(project)) {
        throw new Error(`Project "${project}" does not exist.`);
      }
    }

    const content = await this.app.vault.adapter.read(entryPath);
    const nextContent = updateWorkflowAgentsProjects(content, projects);
    await this.app.vault.adapter.write(entryPath, nextContent);

    const boardContent = await this.readTaskBoard();
    const newline = boardContent.includes("\r\n") ? "\r\n" : "\n";
    const lines = boardContent.split(/\r?\n/);
    const taskIndex = findTaskLineIndex(lines, update.task);

    if (taskIndex === -1) {
      throw new Error("Selected task no longer exists in the task board.");
    }

    const nextLines = [...lines];
    nextLines.splice(
      taskIndex,
      update.task.rawLines.length,
      ...renderTaskBlock(update.task, update.task.status, {
        projects,
        forceProjects: true
      })
    );
    await this.app.vault.adapter.write(TASK_BOARD_PATH, nextLines.join(newline));
  }

  private async readTaskBoard(): Promise<string> {
    return this.app.vault.adapter.read(TASK_BOARD_PATH);
  }

  private async requireTaskEntry(task: BoardTask): Promise<string> {
    const path = await resolveTaskEntryPath(this.app, task);
    if (!path) {
      throw new Error(`Cannot locate task entry for ${task.taskId ?? task.text}: ${path ?? "missing entry link"}.`);
    }
    const metadata = await readTaskFileMetadata(this.app, path);
    const documentId = task.rawLine.match(/\bid:([gpw]-\d+)\b/)?.[1] ?? task.taskId;
    if (!metadata?.status || !metadata.id || (documentId && metadata.id !== documentId)) {
      throw new Error(`Task entry metadata is missing or disagrees with the selected task: ${path}`);
    }
    return path;
  }

  private async writeTaskDocuments(
    task: BoardTask,
    updates: TaskFileMetadata,
    documents: { path: string; original: string | null; next: string }[]
  ): Promise<void> {
    const entryPath = await this.requireTaskEntry(task);
    const originalEntry = await this.app.vault.adapter.read(entryPath);
    const nextEntry = updateTaskFileContent(originalEntry, updates);
    const changes = [{ path: entryPath, original: originalEntry, next: nextEntry }, ...documents];
    const written: typeof changes = [];
    try {
      for (const change of changes) {
        written.push(change);
        await this.app.vault.adapter.write(change.path, change.next);
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const change of written.reverse()) {
        try {
          if (change.original === null) {
            if (await this.app.vault.adapter.exists(change.path)) await this.app.vault.adapter.remove(change.path);
          } else await this.app.vault.adapter.write(change.path, change.original);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "Task update failed and some files could not be restored; run vault validation before retrying.");
      throw error;
    }
  }

  private async hydrateTaskCreationTimes(tasks: BoardTask[]): Promise<BoardTask[]> {
    return Promise.all(
      tasks.map(async (task) => this.hydrateTaskFileMetadata(task))
    );
  }

  private async hydrateTaskFileMetadata(task: BoardTask): Promise<BoardTask> {
    const entryPath = await resolveTaskEntryPath(this.app, task);

    if (!entryPath) {
      return task;
    }

    const metadata = await readTaskFileMetadata(this.app, entryPath);
    const fallbackCreatedAt = task.createdAt ?? await this.readLegacyTaskCreatedAt(entryPath);

    if (!metadata) {
      return {
        ...task,
        createdAt: fallbackCreatedAt
      };
    }

    return {
      ...task,
      status: metadata.status ?? task.status,
      checked: metadata.status ? metadata.status === TaskStatus.Done : task.checked,
      priority: metadata.priority ?? task.priority,
      dueDate: metadata.due ?? task.dueDate,
      createdAt: metadata.created ?? fallbackCreatedAt,
      taskId: metadata.id ?? task.taskId,
      taskScope: metadata.type ?? task.taskScope,
      project: getPrimaryProject(metadata.project) ?? task.project,
      projects: getMetadataProjects(metadata.project, task.projects)
    };
  }

  private async readLegacyTaskCreatedAt(entryPath: string): Promise<string | null> {
    if (!(await this.app.vault.adapter.exists(entryPath))) {
      return null;
    }

    const content = await this.app.vault.adapter.read(entryPath);
    return content.match(CREATED_AT_PATTERN)?.[1]?.trim() || null;
  }

  private async updateLinkedTaskTitle(entryPath: string | null, title: string): Promise<void> {
    if (!entryPath || !(await this.app.vault.adapter.exists(entryPath))) {
      return;
    }

    await updateTaskFileMetadata(this.app, entryPath, { title });

    const content = await this.app.vault.adapter.read(entryPath);
    const nextContent = updateMarkdownTitleHeading(content, title);
    if (nextContent !== content) {
      await this.app.vault.adapter.write(entryPath, nextContent);
    }
  }

  private async updateVaultReferences(referenceRename: ReferenceRename): Promise<void> {
    const referenceFiles = await this.listReferenceFiles("");
    for (const path of referenceFiles) {
      if (path === TASK_BOARD_PATH) {
        continue;
      }

      const content = await this.app.vault.adapter.read(path);
      const nextContent = replaceReferences(content, path, referenceRename);
      if (nextContent !== content) {
        await this.app.vault.adapter.write(path, nextContent);
      }
    }
  }

  private async listReferenceFiles(path: string): Promise<string[]> {
    const listed = await this.safeList(path);
    const files = listed.files.filter(isReferenceFile);
    for (const folder of listed.folders.filter((folder) => !isSkippedReferenceFolder(folder))) {
      files.push(...await this.listReferenceFiles(folder));
    }
    return files;
  }

  private async safeList(path: string): Promise<ListedFiles> {
    return this.app.vault.adapter.list(path);
  }
}

function getTaskEntryFolderForDelete(entryPath: string): string | null {
  if (/^20-workflows\/[^/]+\/AGENTS\.md$/.test(entryPath)) {
    return parentPath(entryPath);
  }

  if (/^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/.test(entryPath)) {
    return parentPath(entryPath);
  }

  return entryPath.endsWith("/index.md") ? parentPath(entryPath) : null;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function parseTaskBoard(content: string): BoardTask[] {
  return parseTaskDocument(content, null, (heading) => normalizeTaskStatusValue(heading, null) ?? null)
    .map((task) => ({ ...task, sourcePath: TASK_BOARD_PATH, documentStatus: task.status }));
}

export function parseTaskDoneArchive(content: string): BoardTask[] {
  return parseTaskDocument(content, TaskStatus.Done, () => TaskStatus.Done)
    .map((task) => ({ ...task, sourcePath: TASK_DONE_PATH, documentStatus: task.status }));
}

function parseTaskDocument(
  content: string,
  initialStatus: TaskStatus | null,
  resolveHeadingStatus: (heading: string) => TaskStatus | null
): BoardTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: BoardTask[] = [];
  let currentStatus: TaskStatus | null = initialStatus;
  let pendingTask: PendingTaskEntry | null = null;

  lines.forEach((line, index) => {
    const heading = line.match(HEADING_PATTERN);
    const headingStatus = heading ? resolveHeadingStatus(heading[2]) : null;

    if (heading && (initialStatus !== null || headingStatus !== null)) {
      pushPendingTask(tasks, pendingTask);
      pendingTask = null;
      currentStatus = headingStatus;
      return;
    }

    if (!currentStatus) {
      return;
    }

    if (TASK_LINE_PATTERN.test(line)) {
      pushPendingTask(tasks, pendingTask);
      pendingTask = {
        firstLineNumber: index + 1,
        order: tasks.length,
        status: currentStatus,
        lines: [line]
      };
      return;
    }

    if (pendingTask && line.trim() !== "") {
      pendingTask.lines.push(line);
      return;
    }

    if (pendingTask && line.trim() === "") {
      pushPendingTask(tasks, pendingTask);
      pendingTask = null;
    }
  });

  pushPendingTask(tasks, pendingTask);
  return tasks;
}

export function sortBoardTasks(tasks: BoardTask[], mode: TaskBoardSortMode): BoardTask[] {
  const sorted = [...tasks];

  if (mode === TaskBoardSortMode.Manual) {
    return sorted.sort((left, right) => left.order - right.order);
  }

  return sorted.sort((left, right) => {
    const priorityDelta =
      TASK_PRIORITY_ORDER.indexOf(left.priority) - TASK_PRIORITY_ORDER.indexOf(right.priority);
    return priorityDelta === 0 ? left.order - right.order : priorityDelta;
  });
}

function parseStatusHeading(line: string): TaskStatus | null {
  const match = line.match(HEADING_PATTERN);

  if (!match) {
    return null;
  }

  return normalizeTaskStatusValue(match[2], null) ?? null;
}

interface PendingTaskEntry {
  firstLineNumber: number;
  order: number;
  status: TaskStatus;
  lines: string[];
}

function pushPendingTask(tasks: BoardTask[], pendingTask: PendingTaskEntry | null): void {
  if (!pendingTask) {
    return;
  }

  const task = parseTaskEntry(pendingTask);

  if (task) {
    tasks.push(task);
  }
}

function parseTaskEntry(entry: PendingTaskEntry): BoardTask | null {
  const firstLine = entry.lines[0];
  const match = firstLine.match(TASK_LINE_PATTERN);

  if (!match) {
    return null;
  }

  const continuation = entry.lines.slice(1).join("\n").trim();
  const rawBody = [match[4].trim(), continuation].filter(Boolean).join("\n");

  if (!rawBody) {
    return null;
  }

  const priorityMatch = rawBody.match(PRIORITY_PATTERN);
  const priority = priorityMatch ? (priorityMatch[1] as TaskPriority) : TaskPriority.P3;
  const bodyWithoutPriority = priorityMatch ? priorityMatch[2].trim() : rawBody;
  const parsedMetadata = parseTaskMetadata(bodyWithoutPriority);
  const links = extractTaskLinks(parsedMetadata.text);
  const taskScope = parsedMetadata.taskScope ?? inferTaskScope(links);

  if (!parsedMetadata.text) {
    return null;
  }

  return {
    line: entry.firstLineNumber,
    endLine: entry.firstLineNumber + entry.lines.length - 1,
    order: entry.order,
    status: entry.status,
    checked: match[2].toLowerCase() === "x",
    priority,
    hasExplicitPriority: Boolean(priorityMatch),
    dueDate: parsedMetadata.dueDate,
    createdAt: parsedMetadata.createdAt,
    taskId: parsedMetadata.taskId,
    taskScope,
    project: null,
    projects: parsedMetadata.projects,
    text: parsedMetadata.text,
    rawBody,
    rawLine: firstLine,
    rawLines: [...entry.lines],
    links,
    wpsTargets: parsedMetadata.wpsTargets
  };
}

export function isTaskEntryPath(path: string): boolean {
  return /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/.test(path) ||
    /^10-tasks\/items\/\d{4}\/\d{2}\/[^/]+\.md$/.test(path) ||
    /^20-workflows\/[^/]+\/AGENTS\.md$/.test(path);
}

export function getTaskEntryPath(task: BoardTask): string | null {
  for (const link of task.links) {
    const target = normalizeTaskEntryPath(link.target);

    if (isTaskEntryPath(target)) {
      return target;
    }
  }

  return null;
}

export async function resolveTaskEntryPath(app: App, task: BoardTask): Promise<string | null> {
  const direct = getTaskEntryPath(task);
  if (direct && await app.vault.adapter.exists(direct)) return direct;
  const sourcePath = task.sourcePath ?? TASK_BOARD_PATH;
  for (const link of extractLocalMarkdownLinks(task.rawLine, sourcePath)) {
    const target = await findLocalLinkTarget(app, link, sourcePath) ?? link.target;
    for (const candidate of [target, `${target}.md`, `${target}/AGENTS.md`, `${target}/index.md`]) {
      if (isTaskEntryPath(candidate) && await app.vault.adapter.exists(candidate)) return candidate;
    }
  }
  return null;
}

interface TaskEntryRename {
  oldEntryPath: string;
  newEntryPath: string;
  fromPath: string;
  toPath: string;
  oldTaskSegment: string;
  newTaskSegment: string;
}

function getTaskEntryRename(entryPath: string, task: BoardTask, title: string): TaskEntryRename | null {
  const taskId = task.taskId;
  if (!taskId) {
    return null;
  }

  const folderSlug = createTaskPathSegment(taskId, title);

  const projectMatch = entryPath.match(/^(30-projects\/[^/]+\/inputs\/\d{4}\/\d{2})\/[^/]+\/(AGENTS|index)\.md$/);
  if (projectMatch) {
    const fromPath = parentPath(entryPath);
    const toPath = `${projectMatch[1]}/${folderSlug}`;
    const entryFileName = `${projectMatch[2]}.md`;
    return {
      oldEntryPath: entryPath,
      newEntryPath: `${toPath}/${entryFileName}`,
      fromPath,
      toPath,
      oldTaskSegment: lastPathSegment(fromPath),
      newTaskSegment: lastPathSegment(toPath)
    };
  }

  const workflowMatch = entryPath.match(/^(20-workflows)\/[^/]+\/AGENTS\.md$/);
  if (workflowMatch) {
    const fromPath = parentPath(entryPath);
    const toPath = `${workflowMatch[1]}/${folderSlug}`;
    return {
      oldEntryPath: entryPath,
      newEntryPath: `${toPath}/AGENTS.md`,
      fromPath,
      toPath,
      oldTaskSegment: lastPathSegment(fromPath),
      newTaskSegment: lastPathSegment(toPath)
    };
  }

  const generalMatch = entryPath.match(/^(10-tasks\/items\/\d{4}\/\d{2})\/[^/]+\.md$/);
  if (generalMatch) {
    const toPath = `${generalMatch[1]}/${folderSlug}.md`;
    return {
      oldEntryPath: entryPath,
      newEntryPath: toPath,
      fromPath: entryPath,
      toPath,
      oldTaskSegment: stripMarkdownExtension(lastPathSegment(entryPath)),
      newTaskSegment: stripMarkdownExtension(lastPathSegment(toPath))
    };
  }

  return null;
}

function createTaskPathSegment(taskId: string, title: string): string {
  return `${taskId}-${createFileSlug(title)}`;
}

function createFileSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "task";
}

function normalizeTaskEntryPath(path: string): string {
  if (isTaskEntryPath(path)) {
    return path;
  }

  if (/^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+$/.test(path)) {
    return `${path}/AGENTS.md`;
  }

  const withExtension = path.endsWith(".md") ? path : `${path}.md`;
  return isTaskEntryPath(withExtension) ? withExtension : path;
}

function renderTaskLine(
  task: BoardTask,
  toStatus: TaskStatus,
  options: {
    priority?: TaskPriority;
    forcePriority?: boolean;
    dueDate?: string | null;
    forceDueDate?: boolean;
    title?: string;
    wpsTargets?: BoardTaskWpsTarget[];
    forceWpsTargets?: boolean;
    projects?: string[];
    forceProjects?: boolean;
  } = {}
): string {
  const checkbox = toStatus === TaskStatus.Done ? "x" : " ";
  const priority = options.priority ?? task.priority;
  const forcePriority = options.forcePriority ?? false;
  const dueDate = Object.prototype.hasOwnProperty.call(options, "dueDate")
    ? options.dueDate ?? null
    : task.dueDate;
  const forceDueDate = options.forceDueDate ?? false;
  const text = options.title ? replaceTaskTitle(task.text, options.title) : task.text;
  const wpsTargets = options.wpsTargets ?? task.wpsTargets;
  const forceWpsTargets = options.forceWpsTargets ?? false;
  const projects = options.projects ?? task.projects;
  const forceProjects = options.forceProjects ?? false;
  const shouldCompose = Boolean(options.title) || task.hasExplicitPriority || forcePriority || forceDueDate || forceWpsTargets || forceProjects;
  const priorityPrefix = task.hasExplicitPriority || forcePriority ? `[${priority}] ` : "";
  const dueSuffix = dueDate ? ` due:${dueDate}` : "";
  const wpsSuffix = formatWpsTargets(wpsTargets);
  const projectsSuffix = forceProjects && projects.length > 0 ? `；关联项目：${projects.join("、")}` : "";
  const scopeTag = ` #task/${task.taskScope}`;
  const taskIdSuffix = task.taskId ? ` ${formatTaskId(task.taskId)}` : "";
  const createdAtSuffix = task.createdAt ? ` created:${task.createdAt}` : "";
  const body = shouldCompose
    ? composeTaskBody(text, priorityPrefix, dueSuffix, wpsSuffix, projectsSuffix, scopeTag, taskIdSuffix, createdAtSuffix)
    : task.rawBody;
  return `- [${checkbox}] ${body}`;
}

function composeTaskBody(
  text: string,
  priorityPrefix: string,
  dueSuffix: string,
  wpsSuffix: string,
  projectsSuffix: string,
  scopeTag: string,
  taskIdSuffix: string,
  createdAtSuffix: string
): string {
  const lines = text.split("\n");
  const firstLine = lines[0] ?? "";
  return [
    `${priorityPrefix}${firstLine}${projectsSuffix}${dueSuffix}${wpsSuffix}${scopeTag}${taskIdSuffix}${createdAtSuffix}`,
    ...lines.slice(1)
  ].join("\n");
}

function formatTaskId(taskId: string): string {
  return /^\d+$/.test(taskId) ? `tid:${taskId}` : `id:${taskId}`;
}

function renderTaskBlock(
  task: BoardTask,
  toStatus: TaskStatus,
  options: {
    priority?: TaskPriority;
    forcePriority?: boolean;
    dueDate?: string | null;
    forceDueDate?: boolean;
    title?: string;
    wpsTargets?: BoardTaskWpsTarget[];
    forceWpsTargets?: boolean;
    projects?: string[];
    forceProjects?: boolean;
    notes?: string[];
  } = {}
): string[] {
  const renderedLines = renderTaskLine(task, toStatus, options).split("\n");
  const nonCalloutLines = renderedLines.filter(line => !line.trimStart().startsWith(">"));
  const notes = options.notes !== undefined
    ? options.notes
    : extractCalloutLines(task.rawLines);
  return [...nonCalloutLines, ...renderCalloutBlock(notes)];
}

function normalizeTaskTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function replaceTaskTitle(text: string, title: string): string {
  const lines = text.split("\n");
  const firstLine = lines[0] ?? "";
  const links = extractFirstLineLinkLiterals(firstLine);
  const nextFirstLine = [title, ...links].filter(Boolean).join(" ");
  return [nextFirstLine, ...lines.slice(1)].join("\n");
}

function extractFirstLineLinkLiterals(line: string): string[] {
  const links: string[] = [];
  LINK_PATTERN.lastIndex = 0;

  for (const match of line.matchAll(LINK_PATTERN)) {
    links.push(match[0]);
  }

  return links;
}

function updateMarkdownTitleHeading(content: string, title: string): string {
  return content.replace(/^(#\s+).+$/m, (_match, prefix: string) => `${prefix}${title}`);
}

interface ReferenceRename {
  oldEntryPath: string;
  newEntryPath: string;
  oldEntryPathNoExtension: string;
  newEntryPathNoExtension: string;
  oldTaskPath: string;
  newTaskPath: string;
  oldTaskPathNoExtension: string;
  newTaskPathNoExtension: string;
  oldTaskSegment: string;
  newTaskSegment: string;
  oldTitle: string;
  newTitle: string;
}

function createReferenceRename(rename: TaskEntryRename, task: BoardTask, title: string): ReferenceRename {
  return {
    oldEntryPath: rename.oldEntryPath,
    newEntryPath: rename.newEntryPath,
    oldEntryPathNoExtension: stripMarkdownExtension(rename.oldEntryPath),
    newEntryPathNoExtension: stripMarkdownExtension(rename.newEntryPath),
    oldTaskPath: rename.fromPath,
    newTaskPath: rename.toPath,
    oldTaskPathNoExtension: stripMarkdownExtension(rename.fromPath),
    newTaskPathNoExtension: stripMarkdownExtension(rename.toPath),
    oldTaskSegment: rename.oldTaskSegment,
    newTaskSegment: rename.newTaskSegment,
    oldTitle: normalizeTaskTitle(extractTaskTitleText(task.text)),
    newTitle: title
  };
}

function replaceReferences(content: string, path: string, rename: ReferenceRename): string {
  if (path.endsWith(".md")) {
    return replaceMarkdownReferences(content, rename, path);
  }

  return replacePathStrings(content, rename);
}

function replaceMarkdownReferences(content: string, rename: ReferenceRename, sourcePath: string): string {
  return replacePathStrings(content, rename)
    .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_match, target: string, anchor = "", alias?: string) => {
      const nextTarget = mapReferenceTarget(target, rename, sourcePath);
      const nextAlias = alias === undefined ? undefined : mapReferenceLabel(alias, rename);
      return nextAlias === undefined ? `[[${nextTarget}${anchor}]]` : `[[${nextTarget}${anchor}|${nextAlias}]]`;
    })
    .replace(/\[([^\]]*)]\(([^)#]+)(#[^)]*)?\)/g, (_match, label: string, target: string, anchor = "") => {
      const nextTarget = mapReferenceTarget(target, rename, sourcePath);
      const nextLabel = mapReferenceLabel(label, rename);
      return `[${nextLabel}](${nextTarget}${anchor})`;
    });
}

function replacePathStrings(content: string, rename: ReferenceRename): string {
  return getPathReplacementPairs(rename).reduce(
    (current, [oldPath, newPath]) => oldPath && oldPath !== newPath ? current.split(oldPath).join(newPath) : current,
    content
  );
}

function mapReferenceTarget(target: string, rename: ReferenceRename, sourcePath: string): string {
  const decodedTarget = decodeObsidianLinkTarget(target);
  const resolvedTarget = resolveVaultRelativePath(decodedTarget, sourcePath);
  const mappedTarget = getPathReplacementPairs(rename, true).find(([oldPath]) => resolvedTarget === oldPath)?.[1];

  if (!mappedTarget) {
    return target;
  }

  const nextTarget = isRelativeVaultLink(decodedTarget)
    ? toRelativeMarkdownPath(sourcePath, mappedTarget)
    : mappedTarget;
  return target === decodedTarget ? nextTarget : encodeObsidianLinkTarget(nextTarget);
}

function resolveVaultRelativePath(path: string, sourcePath: string): string {
  if (!isRelativeVaultLink(path)) {
    return path.replace(/^\/+/, "");
  }

  const segments = parentPath(sourcePath).split("/").filter(Boolean);
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function toRelativeMarkdownPath(sourcePath: string, targetPath: string): string {
  const sourceSegments = parentPath(sourcePath).split("/").filter(Boolean);
  const targetSegments = targetPath.split("/").filter(Boolean);
  while (sourceSegments.length > 0 && targetSegments.length > 0 && sourceSegments[0] === targetSegments[0]) {
    sourceSegments.shift();
    targetSegments.shift();
  }
  return [...sourceSegments.map(() => ".."), ...targetSegments].join("/");
}

function mapReferenceLabel(label: string, rename: ReferenceRename): string {
  const normalized = normalizeTaskTitle(label);
  if (
    normalized === rename.oldTitle ||
    normalized === rename.oldTaskSegment ||
    normalized === rename.oldEntryPath ||
    normalized === rename.oldEntryPathNoExtension ||
    normalized === rename.oldTaskPath ||
    normalized === rename.oldTaskPathNoExtension
  ) {
    return rename.newTitle;
  }

  return replacePathStrings(label, rename);
}

function getPathReplacementPairs(rename: ReferenceRename, includeRelativeSegment = false): [string, string][] {
  const pairs: [string, string][] = [
    [rename.oldEntryPath, rename.newEntryPath],
    [rename.oldEntryPathNoExtension, rename.newEntryPathNoExtension],
    [rename.oldTaskPath, rename.newTaskPath],
    [rename.oldTaskPathNoExtension, rename.newTaskPathNoExtension]
  ];

  if (includeRelativeSegment) {
    pairs.push([rename.oldTaskSegment, rename.newTaskSegment]);
  }

  return pairs.sort((left, right) => right[0].length - left[0].length);
}

function extractTaskTitleText(text: string): string {
  const firstLine = text.split("\n")[0] ?? text;
  return firstLine.replace(LINK_PATTERN, "").trim();
}

function decodeObsidianLinkTarget(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function encodeObsidianLinkTarget(target: string): string {
  return encodeURI(target).replace(/%2F/g, "/");
}

function stripMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

function lastPathSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function isReferenceFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".canvas") || path.endsWith(".json");
}

function isSkippedReferenceFolder(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return name.startsWith(".") || name === "node_modules";
}

function extractCalloutLines(rawLines: string[]): string[] {
  const lines: string[] = [];
  let inCallout = false;
  for (const raw of rawLines) {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith(">")) {
      inCallout = true;
      const content = trimmed.replace(/^>\s*/, "");
      if (content && !content.startsWith("[!")) {
        lines.push(content.replace(/^-\s*/, ""));
      }
    } else if (inCallout && trimmed === "") {
      inCallout = false;
    }
  }
  return lines;
}

function renderCalloutBlock(notes: string[]): string[] {
  if (notes.length === 0) return [];
  return [
    "  > [!note] 说明",
    ...notes.map((note) => `  > - ${note}`)
  ];
}

function parseTaskMetadata(body: string): {
  dueDate: string | null;
  createdAt: string | null;
  taskId: string | null;
  taskScope: TaskScope | null;
  wpsTargets: BoardTaskWpsTarget[];
  projects: string[];
  text: string;
} {
  const source = extractWpsTargets(body);
  body = source.text;
  const dueMatch = body.match(DUE_DATE_PATTERN);
  const createdAtMatch = body.match(BOARD_CREATED_AT_PATTERN);
  const taskIdMatch = body.match(TASK_ID_PATTERN);
  const scopeMatch = body.match(TASK_SCOPE_PATTERN);
  const dueDate = dueMatch ? dueMatch[1] : null;
  const createdAt = createdAtMatch ? createdAtMatch[1] : null;
  const taskId = taskIdMatch ? taskIdMatch[2] ?? taskIdMatch[1] : null;
  const taskScope = scopeMatch ? (scopeMatch[1] as TaskScope) : null;
  const wpsTargets = source.targets;
  const projects = extractProjectMetadata(body);
  const text = body
    .replace(PROJECT_METADATA_PATTERN, "")
    .replace(DUE_DATE_PATTERN, "")
    .replace(BOARD_CREATED_AT_PATTERN, "")
    .replace(TASK_ID_PATTERN, "")
    .replace(TASK_SCOPE_PATTERN, "")
    .replace(LEGACY_GENERAL_TAG_PATTERN, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  return { dueDate, createdAt, taskId, taskScope, wpsTargets, projects, text };
}

function extractProjectMetadata(body: string): string[] {
  const value = body.match(PROJECT_METADATA_PATTERN)?.[1] ?? "";
  return normalizeProjectList(
    value
      .split(/[、,，]/)
      .map((project) => project.trim())
  );
}

function extractWpsTargets(body: string): { targets: BoardTaskWpsTarget[]; text: string } {
  const targets: BoardTaskWpsTarget[] = [];
  const pattern = new RegExp(WPS_TARGET_PREFIX_PATTERN);
  const text: string[] = [];
  let previousEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    const start = pattern.lastIndex;
    let end = start;
    let label = "";
    let url: string | null = null;
    const labelEnd = findSourceDelimiterEnd(body, start, "[", "]");
    const urlEnd = labelEnd !== -1 ? findSourceDelimiterEnd(body, labelEnd + 1, "(", ")") : -1;
    if (urlEnd !== -1) {
      label = body.slice(start + 1, labelEnd).replace(/\\([\\[\]])/g, "$1");
      url = body.slice(labelEnd + 2, urlEnd).replace(/\\([\\()])/g, "$1");
      end = urlEnd + 1;
    } else {
      const quoted = body.slice(start).match(/^"((?:\\.|[^"\\\r\n])*)"/);
      const simple = quoted ? null : body.slice(start).match(/^\S+/);
      label = quoted ? quoted[1].replace(/\\(["\\])/g, "$1") : simple?.[0] ?? "";
      end += quoted?.[0].length ?? simple?.[0].length ?? 0;
    }
    if (end === start || !label.trim()) {
      pattern.lastIndex = end;
      continue;
    }
    addWpsTarget(targets, label, url);
    text.push(body.slice(previousEnd, match.index), " ");
    previousEnd = end;
    pattern.lastIndex = end;
  }
  text.push(body.slice(previousEnd));
  return { targets, text: text.join("") };
}

// 按嵌套层级寻找闭合符，避免链接中的括号截断来源地址。
function findSourceDelimiterEnd(text: string, start: number, open: string, close: string): number {
  if (text[start] !== open) return -1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === "\r" || char === "\n") return -1;
    if (char === "\\") {
      if (text[i + 1] === "\r" || text[i + 1] === "\n") return -1;
      i++;
    } else if (char === open) {
      depth++;
    } else if (char === close && --depth === 0) {
      return i;
    }
  }
  return -1;
}

function addWpsTarget(targets: BoardTaskWpsTarget[], label: string, url: string | null): void {
  const normalizedLabel = label.trim();
  const normalizedUrl = url?.trim() || null;

  if (!normalizedLabel) {
    return;
  }

  if (targets.some((target) => target.label === normalizedLabel && target.url === normalizedUrl)) {
    return;
  }

  targets.push({ label: normalizedLabel, url: normalizedUrl });
}

function formatWpsTargets(targets: BoardTaskWpsTarget[]): string {
  if (targets.length === 0) {
    return "";
  }

  return targets.map((target) => ` ${formatWpsTarget(target)}`).join("");
}

function formatWpsTarget(target: BoardTaskWpsTarget): string {
  if (target.url) {
    const label = target.label.replace(/[\\[\]]/g, "\\$&");
    const url = target.url.replace(/[\\()]/g, "\\$&");
    return `wps:[${label}](${url})`;
  }

  const escapedLabel = target.label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return /[\s"\\]/.test(target.label) ? `wps:"${escapedLabel}"` : `wps:${target.label}`;
}

function extractTaskLinks(text: string): BoardTaskLink[] {
  const links: BoardTaskLink[] = [];

  for (const match of text.matchAll(LINK_PATTERN)) {
    const wikiTarget = match[1];
    const wikiLabel = match[2];
    const markdownLabel = match[3];
    const markdownTarget = match[4];
    const target = resolveLocalLinkTarget(wikiTarget ?? markdownTarget ?? "", TASK_BOARD_PATH, wikiTarget !== undefined);

    if (!target) {
      continue;
    }

    links.push({
      target,
      label: wikiLabel ?? markdownLabel ?? target
    });
  }

  return links;
}

function inferTaskScope(links: BoardTaskLink[]): TaskScope {
  if (links.some((link) => link.target.startsWith("20-workflows/"))) {
    return TaskScope.Workflow;
  }

  if (links.some((link) => link.target.startsWith("30-projects/"))) {
    return TaskScope.Project;
  }

  return TaskScope.General;
}

function getPrimaryProject(project: string | string[] | undefined): string | undefined {
  return Array.isArray(project) ? project[0] : project;
}

function getMetadataProjects(
  project: string | string[] | undefined,
  fallback: string[]
): string[] {
  if (Array.isArray(project)) {
    return normalizeProjectList(project);
  }

  if (project) {
    return [project];
  }

  return fallback;
}

function normalizeProjectList(projects: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawProject of projects) {
    const project = rawProject.trim();
    if (!project || seen.has(project)) {
      continue;
    }
    seen.add(project);
    result.push(project);
  }

  return result;
}

function updateWorkflowAgentsProjects(content: string, projects: string[]): string {
  const branchMap = parseWorkflowDevelopmentBranches(content);
  return updateWorkflowKnowledgeProjectEntry(
    updateMarkdownSection(
      updateMarkdownSection(
        replaceProjectFrontmatter(content, projects),
        "关联项目",
        projects.map((project) => `- [${project}](../../30-projects/${encodeURIComponent(project)}/index.md)`)
      ),
      "开发分支",
      projects.flatMap((project) => [
        `- 项目：[${project}](../../30-projects/${encodeURIComponent(project)}/index.md)`,
        `  - 目标开发分支：${branchMap.get(project) ?? "待填写"}`
      ])
    )
  );
}

function replaceProjectFrontmatter(content: string, projects: string[]): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return content;
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const block = match[1];
  const lines = block.split(/\r?\n/);
  const nextLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^project:\s*/.test(line)) {
      nextLines.push(...renderProjectFrontmatterLines(projects));
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
      }
      continue;
    }

    nextLines.push(line);
  }

  if (!lines.some((line) => /^project:\s*/.test(line))) {
    nextLines.push(...renderProjectFrontmatterLines(projects));
  }

  return ["---", ...nextLines, "---", content.slice(match[0].length)].join(newline);
}

function renderProjectFrontmatterLines(projects: string[]): string[] {
  return projects.length > 0
    ? ["project:", ...projects.map((project) => `  - ${formatYamlScalar(project)}`)]
    : ["project: []"];
}

function updateMarkdownSection(content: string, heading: string, bodyLines: string[]): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (headingIndex === -1) {
    return content;
  }

  const endIndex = findSectionEnd(lines, headingIndex);
  const replacement = [`## ${heading}`, ...bodyLines, ""];
  lines.splice(headingIndex, endIndex - headingIndex, ...replacement);
  return lines.join(newline);
}

function updateWorkflowKnowledgeProjectEntry(content: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 相关知识");
  if (headingIndex === -1) {
    return content;
  }

  const endIndex = findSectionEnd(lines, headingIndex);
  const entryIndex = lines.findIndex((line, index) =>
    index > headingIndex &&
    index < endIndex &&
    /^-\s*项目入口[：:]/.test(line.trim())
  );

  if (entryIndex === -1) {
    lines.splice(headingIndex + 1, 0, "- 项目入口：见关联项目");
  } else {
    lines[entryIndex] = "- 项目入口：见关联项目";
  }

  return lines.join(newline);
}

function parseWorkflowDevelopmentBranches(content: string): Map<string, string> {
  const branchMap = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 开发分支");
  if (headingIndex === -1) {
    return branchMap;
  }

  const endIndex = findSectionEnd(lines, headingIndex);
  let currentProject: string | null = null;
  for (const line of lines.slice(headingIndex + 1, endIndex)) {
    const projectMatch = line.match(/30-projects\/([^/\]]+)\/index/);
    if (projectMatch) {
      currentProject = projectMatch[1];
      continue;
    }

    const branchMatch = line.match(/目标开发分支[：:]\s*(.+?)\s*$/);
    if (currentProject && branchMatch) {
      branchMap.set(currentProject, branchMatch[1]);
      currentProject = null;
    }
  }

  return branchMap;
}

function formatYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function appendTaskToDoneArchive(content: string, taskLines: string[], year: number): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\s+$/, "").split(/\r?\n/);
  const yearHeading = `## ${year}`;
  const headingIndex = lines.findIndex((line) => line.trim() === yearHeading);

  if (headingIndex === -1) {
    const prefix = lines.length > 0 && lines[lines.length - 1] !== "" ? [""] : [];
    return [...lines, ...prefix, yearHeading, "", ...taskLines, ""].join(newline);
  }

  let insertAt = findSectionEnd(lines, headingIndex);
  while (insertAt > headingIndex + 1 && lines[insertAt - 1] === "") {
    insertAt -= 1;
  }
  const separator = insertAt > headingIndex + 1 ? [""] : [];
  lines.splice(insertAt, 0, ...separator, ...taskLines);
  return [...lines, ""].join(newline);
}

function findTaskLineIndex(lines: string[], task: BoardTask): number {
  const originalIndex = task.line - 1;

  if (lines[originalIndex] === task.rawLine) {
    return originalIndex;
  }

  if (task.sourcePath === TASK_DONE_PATH) {
    return lines.findIndex((line) => line === task.rawLine);
  }

  let currentStatus: TaskStatus | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseStatusHeading(lines[index]);

    if (heading) {
      currentStatus = heading;
      continue;
    }

    if (currentStatus === (task.documentStatus ?? task.status) && lines[index] === task.rawLine) {
      return index;
    }
  }

  return -1;
}

function findStatusHeadingIndex(lines: string[], status: TaskStatus): number {
  return lines.findIndex((line) => parseStatusHeading(line) === status);
}

function findSectionEnd(lines: string[], headingIndex: number): number {
  const heading = lines[headingIndex].match(HEADING_PATTERN);
  const headingLevel = heading ? heading[1].length : 6;

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(HEADING_PATTERN);

    if (match && match[1].length <= headingLevel) {
      return index;
    }
  }

  return lines.length;
}

function findAdjacentTaskLineIndex(
  lines: string[],
  taskIndex: number,
  status: TaskStatus,
  direction: TaskManualMoveDirection
): number {
  const headingIndex = findEnclosingStatusHeadingIndex(lines, taskIndex, status);

  if (headingIndex === -1) {
    return -1;
  }

  const sectionEnd = findSectionEnd(lines, headingIndex);
  const step = direction === TaskManualMoveDirection.Up ? -1 : 1;
  const stop = direction === TaskManualMoveDirection.Up ? headingIndex : sectionEnd;

  for (let index = taskIndex + step; index !== stop; index += step) {
    if (TASK_LINE_PATTERN.test(lines[index])) {
      return index;
    }
  }

  return -1;
}

function swapTaskBlocks(lines: string[], firstIndex: number, secondIndex: number): string[] {
  const nextLines = [...lines];
  const firstEnd = findTaskBlockEndIndex(lines, firstIndex);
  const secondEnd = findTaskBlockEndIndex(lines, secondIndex);
  const firstBlock = lines.slice(firstIndex, firstEnd);
  const secondBlock = lines.slice(secondIndex, secondEnd);

  if (firstIndex < secondIndex) {
    nextLines.splice(secondIndex, secondBlock.length, ...firstBlock);
    nextLines.splice(firstIndex, firstBlock.length, ...secondBlock);
  } else {
    nextLines.splice(firstIndex, firstBlock.length, ...secondBlock);
    nextLines.splice(secondIndex, secondBlock.length, ...firstBlock);
  }

  return nextLines;
}

function findTaskBlockEndIndex(lines: string[], taskIndex: number): number {
  for (let index = taskIndex + 1; index < lines.length; index += 1) {
    if (
      lines[index].trim() === "" ||
      TASK_LINE_PATTERN.test(lines[index]) ||
      parseStatusHeading(lines[index])
    ) {
      return index;
    }
  }

  return lines.length;
}

function findEnclosingStatusHeadingIndex(
  lines: string[],
  taskIndex: number,
  status: TaskStatus
): number {
  for (let index = taskIndex - 1; index >= 0; index -= 1) {
    const heading = parseStatusHeading(lines[index]);

    if (heading) {
      return heading === status ? index : -1;
    }
  }

  return -1;
}

function isRelativeVaultLink(link: string): boolean {
  return (
    !link.startsWith("/") &&
    !EXTERNAL_LINK_PATTERN.test(link) &&
    !Object.values(VaultRootDirectory).some((directory) => link.startsWith(`${directory}/`))
  );
}
