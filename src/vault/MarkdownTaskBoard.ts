import { App } from "obsidian";
import { getTaskStatusLabel, normalizeTaskStatusValue } from "../constants";
import { PlanTask, TaskScope, TaskStatus } from "../types";
import { TaskIdStore } from "./TaskIdStore";

const TASK_BOARD_PATH = "10-tasks/board.md";
const MARKDOWN_TASK_PATTERN = /^\s*(?:[-*]\s+\[[ xX-]\]|[-*]|\d+\.)\s+/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

enum BoardTaskIdPrefix {
  General = "g",
  Project = "p",
  Workflow = "w"
}

export interface TaskBoardAppendResult {
  path: string;
  addedTasks: string[];
}

export interface TaskBoardAppendOptions {
  taskScope?: TaskScope;
  createdAt?: string;
  taskIds?: string[];
}

export class MarkdownTaskBoard {
  constructor(private readonly app: App) {}

  async readTaskBoard(): Promise<string> {
    return this.app.vault.adapter.read(TASK_BOARD_PATH);
  }

  async findDuplicateTasks(tasks: PlanTask[], options: TaskBoardAppendOptions = {}): Promise<string[]> {
    const content = await this.readTaskBoard();
    const existingTasks = new Set(
      content
        .split(/\r?\n/)
        .filter((line) => MARKDOWN_TASK_PATTERN.test(line.trim()))
        .map(normalizeTaskIdentity)
    );
    const seenPlanTasks = new Set<string>();
    const duplicates: string[] = [];

    for (const task of tasks) {
      const normalized = normalizeTaskIdentity(renderTaskLine(task, options));

      if (existingTasks.has(normalized) || seenPlanTasks.has(normalized)) {
        duplicates.push(task.text);
      }

      seenPlanTasks.add(normalized);
    }

    return duplicates;
  }

  async appendTasks(
    tasks: PlanTask[],
    status: TaskStatus,
    options: TaskBoardAppendOptions = {}
  ): Promise<TaskBoardAppendResult> {
    const content = await this.readTaskBoard();
    const duplicateTasks = await this.findDuplicateTasks(tasks, options);

    if (duplicateTasks.length > 0) {
      throw new Error(`Duplicate task entries blocked: ${duplicateTasks.join(", ")}`);
    }

    const taskLines = await this.renderTaskLines(content, tasks, options);
    const updatedContent = insertTasksIntoStatusSection(content, status, taskLines);
    await this.app.vault.adapter.write(TASK_BOARD_PATH, updatedContent);

    return {
      path: TASK_BOARD_PATH,
      addedTasks: taskLines
    };
  }

  private async renderTaskLines(
    boardContent: string,
    tasks: PlanTask[],
    options: TaskBoardAppendOptions
  ): Promise<string[]> {
    const taskScope = options.taskScope;
    const firstTaskId = options.taskIds
      ? 0
      : await new TaskIdStore(this.app).reserveTaskIds(boardContent, tasks.length);
    const createdAt = options.createdAt ?? formatDateTime(new Date());
    return tasks.map((task, index) =>
      renderTaskLine(task, {
        ...options,
        createdAt,
        taskIds: [options.taskIds?.[index] ?? formatBoardTaskId(taskScope, firstTaskId + index)]
      })
    );
  }
}

export function renderTaskLine(task: PlanTask, options: TaskBoardAppendOptions = {}): string {
  const { title, notes } = parsePlanTaskText(task.text);
  const titleWithScope = options.taskScope ? appendTaskScopeTag(title, options.taskScope) : title;
  const metadata = [
    options.taskIds?.[0],
    options.createdAt ? `created:${options.createdAt}` : ""
  ].filter(Boolean);
  const titleWithMetadata = metadata.length > 0 ? `${titleWithScope} ${metadata.join(" ")}` : titleWithScope;
  const firstLine = task.link
    ? `- [ ] ${titleWithMetadata} ${formatTaskLink(task.link)}`
    : `- [ ] ${titleWithMetadata}`;

  if (notes.length === 0) {
    return firstLine;
  }

  return [
    firstLine,
    "  > [!note] 说明",
    ...notes.map((note) => `  > - ${note}`)
  ].join("\n");
}

function formatTaskLink(path: string): string {
  const target = path.endsWith(".md") ? path : `${path}.md`;
  const label = (target.split("/").pop()?.replace(/\.md$/i, "") || "任务入口").replace(/[[\]]/g, "");
  const encodedTarget = target.split("/").map((segment) => encodeURIComponent(segment).replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
  return `[${label}](../${encodedTarget})`;
}

function appendTaskScopeTag(title: string, taskScope: TaskScope): string {
  const cleanTitle = title.replace(/#task\/(?:general|project|workflow)\b/g, "").replace(/\s+/g, " ").trim();
  return `${cleanTitle} #task/${taskScope}`;
}

export function normalizeTaskIdentity(text: string): string {
  return text
    .replace(MARKDOWN_TASK_PATTERN, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?]]/g, "$2$1")
    .replace(/#task\/(?:general|project|workflow)\b/g, "")
    .replace(/\bid:[pwg]-\d+\b/g, "")
    .replace(/\btid:\d+\b/g, "")
    .replace(/\bcreated:\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatBoardTaskId(taskScope: TaskScope | undefined, taskId: number): string {
  return `id:${getTaskIdPrefix(taskScope)}-${taskId}`;
}

export function formatTaskFileId(taskScope: TaskScope | undefined, taskId: number): string {
  return `${getTaskIdPrefix(taskScope)}-${taskId}`;
}

function getTaskIdPrefix(taskScope: TaskScope | undefined): BoardTaskIdPrefix {
  if (taskScope === TaskScope.Workflow) {
    return BoardTaskIdPrefix.Workflow;
  }

  if (taskScope === TaskScope.General) {
    return BoardTaskIdPrefix.General;
  }

  return BoardTaskIdPrefix.Project;
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function insertTasksIntoStatusSection(content: string, status: TaskStatus, taskLines: string[]): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const statusHeadingIndex = findStatusHeadingIndex(lines, status);

  if (statusHeadingIndex === -1) {
    const prefix = content.endsWith("\n") || content.length === 0 ? "" : newline;
    return `${content}${prefix}${newline}## ${getTaskStatusLabel(status)}${newline}${taskLines.join(newline)}${newline}`;
  }

  const insertAt = findSectionEnd(lines, statusHeadingIndex);
  const nextLines = [...lines];
  const needsSpacer =
    insertAt > statusHeadingIndex + 1 && nextLines[insertAt - 1] !== "" && !MARKDOWN_TASK_PATTERN.test(nextLines[insertAt - 1]);
  const insertedLines = needsSpacer ? ["", ...taskLines] : taskLines;

  nextLines.splice(insertAt, 0, ...insertedLines);
  return nextLines.join(newline);
}

function findStatusHeadingIndex(lines: string[], status: TaskStatus): number {
  return lines.findIndex((line) => {
    const match = line.match(HEADING_PATTERN);
    return match ? normalizeTaskStatusValue(match[2], null) === status : false;
  });
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

export function parsePlanTaskText(text: string): { title: string; notes: string[] } {
  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => normalizeTaskTextLine(line))
    .filter(Boolean);

  if (normalizedLines.length === 0) {
    return { title: "", notes: [] };
  }

  const [firstLine, ...restLines] = normalizedLines;
  const semicolonParts = splitSemicolonTaskText(firstLine);

  if (semicolonParts) {
    return {
      title: semicolonParts.title,
      notes: [...semicolonParts.notes, ...restLines]
    };
  }

  return {
    title: firstLine,
    notes: restLines
  };
}

function splitSemicolonTaskText(line: string): { title: string; notes: string[] } | null {
  const parts = line
    .split(/[；;]/)
    .map((part) => normalizeTaskTextLine(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const title = parts[0];
  const notes: string[] = [];

  for (const part of parts.slice(1)) {
    if (/^关联项目\s*[：:]/.test(part)) {
      continue;
    }

    notes.push(part.replace(/^说明\s*[：:]\s*/, ""));
  }

  return notes.length > 0 ? { title, notes } : null;
}

function normalizeTaskTextLine(line: string): string {
  return line
    .trim()
    .replace(/^>\s*(?:-\s*)?/, "")
    .replace(/^\[!note]\s*说明\s*$/i, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}
