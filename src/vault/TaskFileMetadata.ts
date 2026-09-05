import { App, parseYaml, stringifyYaml } from "obsidian";
import { normalizeTaskStatusValue } from "../constants";
import { TaskPriority, TaskScope, TaskStatus } from "../types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TASK_SCOPE_VALUES = new Set<string>(Object.values(TaskScope));
const TASK_PRIORITY_VALUES = new Set<string>(Object.values(TaskPriority));

export interface TaskFileMetadata {
  id?: string;
  type?: TaskScope;
  status?: TaskStatus;
  project?: string | string[];
  title?: string;
  created?: string;
  completed_at?: string;
  due?: string;
  priority?: TaskPriority;
  source?: string;
  entry_type?: string;
  task_type?: string;
}

export async function readTaskFileMetadata(app: App, path: string): Promise<TaskFileMetadata | null> {
  if (!(await app.vault.adapter.exists(path))) {
    return null;
  }

  return parseTaskFileMetadata(await app.vault.adapter.read(path));
}

export async function updateTaskFileMetadata(
  app: App,
  path: string,
  updates: TaskFileMetadata
): Promise<void> {
  if (!(await app.vault.adapter.exists(path))) {
    throw new Error(`Task entry does not exist: ${path}`);
  }

  const content = await app.vault.adapter.read(path);
  await app.vault.adapter.write(path, updateTaskFileContent(content, updates));
}

export function updateTaskFileContent(content: string, updates: TaskFileMetadata): string {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error("Task entry is missing frontmatter; repair it before updating the task.");
  }
  const metadata = parseFrontmatterBlock(match[1]);
  const previousStatus = normalizeTaskStatusValue(metadata.status, null);
  const nextMetadata: Record<string, unknown> = { ...metadata, ...updates };
  if (updates.status !== undefined) {
    if (updates.status !== TaskStatus.Done) {
      delete nextMetadata.completed_at;
    } else if (previousStatus !== TaskStatus.Done && !nextMetadata.completed_at) {
      nextMetadata.completed_at = new Date().toISOString();
    }
  }
  for (const key of Object.keys(updates)) {
    if (nextMetadata[key] === undefined || nextMetadata[key] === "") delete nextMetadata[key];
  }
  const body = removeTaskStatusLine(content.slice(match[0].length));
  return `---\n${stringifyYaml(nextMetadata).trimEnd()}\n---\n${body}`;
}

export function removeTaskStatusLine(content: string): string {
  let fence: string | null = null;
  return content.split(/(?<=\n)/).filter((line) => {
    const marker = line.replace(/\r?\n$/, "").match(/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") fence = null;
      return true;
    }
    return fence !== null || !/^-\s*状态[：:]\s*(?:doing|todo|pending_release|waiting|backlog|done|Doing|Todo|Pending Release|Waiting|Backlog|Done|进行中|待处理|待上线|等待中|待排期|已完成)[。.]?\s*$/.test(line);
  }).join("");
}

export function parseTaskFileMetadata(content: string): TaskFileMetadata | null {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return null;
  }

  try {
    return normalizeMetadata(parseFrontmatterBlock(match[1]));
  } catch {
    return null;
  }
}

export function renderTaskFileFrontmatter(metadata: TaskFileMetadata): string {
  const orderedKeys: (keyof TaskFileMetadata)[] = [
    "id",
    "type",
    "status",
    "project",
    "title",
    "created",
    "completed_at",
    "due",
    "priority",
    "source",
    "entry_type",
    "task_type"
  ];
  const lines = orderedKeys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== "")
    .flatMap((key) => renderYamlEntry(key, metadata[key]));

  return ["---", ...lines, "---", ""].join("\n");
}

function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const result: unknown = parseYaml(block);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Task frontmatter must be a YAML mapping.");
  }
  return result as Record<string, unknown>;
}

function normalizeMetadata(raw: Record<string, unknown>): TaskFileMetadata {
  const status = normalizeTaskStatusValue(raw.status, null);
  const type = typeof raw.type === "string" && TASK_SCOPE_VALUES.has(raw.type) ? raw.type as TaskScope : undefined;
  const priority =
    typeof raw.priority === "string" && TASK_PRIORITY_VALUES.has(raw.priority)
      ? raw.priority as TaskPriority
      : undefined;

  return removeEmptyValues({
    id: normalizeString(raw.id),
    type,
    status: status ?? undefined,
    project: normalizeProjectValue(raw.project),
    title: normalizeString(raw.title),
    created: normalizeString(raw.created),
    completed_at: normalizeString(raw.completed_at),
    due: raw.due instanceof Date ? raw.due.toISOString().slice(0, 10) : normalizeString(raw.due),
    priority,
    source: normalizeString(raw.source),
    entry_type: normalizeString(raw.entry_type),
    task_type: normalizeString(raw.task_type)
  });
}

function normalizeProjectValue(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const projects = value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item));
    return projects.length > 0 ? projects : undefined;
  }

  return normalizeString(value);
}

function normalizeString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function removeEmptyValues(metadata: TaskFileMetadata): TaskFileMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== "")
  );
}

function formatYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function renderYamlEntry(key: keyof TaskFileMetadata, value: TaskFileMetadata[keyof TaskFileMetadata]): string[] {
  if (Array.isArray(value)) {
    return value.length > 0
      ? [`${key}:`, ...value.map((item) => `  - ${formatYamlScalar(item)}`)]
      : [];
  }

  return [`${key}: ${formatYamlScalar(String(value))}`];
}
