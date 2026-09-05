import { App, ListedFiles } from "obsidian";
import {
  ProjectIndexEntry,
  TaskBoardEntry,
  VaultEntry,
  VaultEntryKind,
  VaultIndex,
  WorkflowIndexEntry
} from "../types";
import { extractLocalMarkdownLinks, findLocalLinkTarget } from "./MarkdownLinks";
import { getTaskEntryPath, parseTaskBoard, parseTaskDoneArchive, resolveTaskEntryPath, TASK_DONE_PATH } from "./TaskBoard";

const ROOT_AGENTS_PATH = "AGENTS.md";
const TASK_BOARD_PATH = "10-tasks/board.md";
const PROJECTS_PATH = "30-projects";
const WORKFLOWS_PATH = "20-workflows";
const TASK_BOARD_DIRECTORY = "10-tasks";
const WORKFLOW_LINK_PATTERN =
  /(?:\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]|\[[^\]]*]\(([^)#]+)(?:#[^)]+)?\))/g;
const MARKDOWN_TASK_PATTERN = /^\s*(?:[-*]\s+\[[ xX-]\]\s*|[-*]\s+|\d+\.\s+)/;
const IGNORED_FILE_NAMES = new Set([".DS_Store"]);

enum MaintenancePath {
  Templates = "90-templates",
  GeneralTasks = "10-tasks/items"
}

export class VaultScanner {
  constructor(private readonly app: App) {}

  async scanVault(): Promise<VaultIndex> {
    const [rootAgentsExists, taskBoardExists, taskBoardEntries, projects, workflows] =
      await Promise.all([
        this.exists(ROOT_AGENTS_PATH),
        this.exists(TASK_BOARD_PATH),
        this.scanTaskBoard(),
        this.scanProjects(),
        this.scanWorkflows()
      ]);

    const routingFiles = await this.scanRoutingFiles(projects, workflows);
    const taskDocuments = await Promise.all([TASK_BOARD_PATH, TASK_DONE_PATH].map(async (path) => ({
      path, content: await this.readIfExists(path)
    })));
    const linkChecks: NonNullable<VaultIndex["linkChecks"]> = [];
    for (const file of [...routingFiles, ...taskDocuments]) {
      for (const link of extractLocalMarkdownLinks(file.content, file.path)) {
        linkChecks.push({ path: file.path, line: link.line, target: link.target,
          exists: (await findLocalLinkTarget(this.app, link, file.path)) !== null });
      }
    }
    const taskReferences: NonNullable<VaultIndex["taskReferences"]> = [];
    for (const document of taskDocuments) {
      const tasks = document.path === TASK_DONE_PATH ? parseTaskDoneArchive(document.content) : parseTaskBoard(document.content);
      for (const task of tasks) {
        const entryPath = await resolveTaskEntryPath(this.app, task) ?? getTaskEntryPath(task);
        taskReferences.push({ path: document.path, line: task.line, id: task.taskId, status: task.status,
          checked: task.checked, entryPath,
          entryContent: entryPath && await this.exists(entryPath) ? await this.readIfExists(entryPath) : null });
      }
    }

    return {
      rootAgentsExists,
      taskBoardExists,
      taskBoardEntries,
      projects,
      workflows,
      inboxItems: [],
      routingFiles,
      linkChecks,
      taskReferences
    };
  }

  private async scanRoutingFiles(projects: ProjectIndexEntry[], workflows: WorkflowIndexEntry[]): Promise<{ path: string; content: string }[]> {
    const paths = new Set([ROOT_AGENTS_PATH, "index.md"]);
    for (const project of projects) {
      for (const filename of ["AGENTS.md", "index.md", "links.md"]) paths.add(`${project.path}/${filename}`);
      for (const file of project.inputIndexFiles) paths.add(file.path);
    }
    for (const workflow of workflows) paths.add(`${workflow.path}/AGENTS.md`);
    for (const folder of Object.values(MaintenancePath)) {
      for (const path of await this.listFilesRecursive(folder)) if (path.endsWith(".md")) paths.add(path);
    }
    const files = [];
    for (const path of paths) if (await this.exists(path)) files.push({ path, content: await this.readIfExists(path) });
    return files;
  }

  private async scanTaskBoard(): Promise<TaskBoardEntry[]> {
    if (!(await this.exists(TASK_BOARD_PATH))) {
      return [];
    }

    const content = await this.app.vault.adapter.read(TASK_BOARD_PATH);

    return content
      .split(/\r?\n/)
      .map((text, index) => this.toTaskBoardEntry(text, index + 1))
      .filter((entry): entry is TaskBoardEntry => entry !== null);
  }

  private toTaskBoardEntry(text: string, line: number): TaskBoardEntry | null {
    const trimmed = text.trim();
    const normalizedText = normalizeTaskText(trimmed);

    if (!MARKDOWN_TASK_PATTERN.test(trimmed) || normalizedText.length === 0) {
      return null;
    }

    return {
      line,
      text: trimmed,
      normalizedText,
      workflowLinks: extractWorkflowLinks(trimmed)
    };
  }

  private async scanProjects(): Promise<ProjectIndexEntry[]> {
    const projectDirs = await this.listImmediateFolders(PROJECTS_PATH);

    return Promise.all(
      projectDirs.map(async (path) => ({
        path,
        hasAgents: await this.exists(`${path}/AGENTS.md`),
        hasIndex: await this.exists(`${path}/index.md`),
        hasLinks: await this.exists(`${path}/links.md`),
        linksContent: await this.readIfExists(`${path}/links.md`),
        inputFiles: await this.scanProjectInputFiles(path),
        inputIndexFiles: await this.scanProjectInputIndexFiles(path)
      }))
    );
  }

  private async scanProjectInputFiles(projectPath: string): Promise<string[]> {
    const inputsPath = `${projectPath}/inputs`;

    if (!(await this.exists(inputsPath))) {
      return [];
    }

    return this.listFilesRecursive(inputsPath);
  }

  private async scanProjectInputIndexFiles(projectPath: string): Promise<{ path: string; content: string }[]> {
    const inputFiles = await this.scanProjectInputFiles(projectPath);
    const indexFiles = inputFiles.filter((path) => path.endsWith("/AGENTS.md") || path.endsWith("/index.md"));

    return Promise.all(
      indexFiles.map(async (path) => ({
        path,
        content: await this.readIfExists(path)
      }))
    );
  }

  private async scanWorkflows(): Promise<WorkflowIndexEntry[]> {
    const workflowDirs = await this.listImmediateFolders(WORKFLOWS_PATH);

    return Promise.all(
      workflowDirs.map(async (path) => ({
        path,
        hasAgents: await this.exists(`${path}/AGENTS.md`),
        hasTodo: await this.exists(`${path}/todo.md`),
        hasInputs: await this.exists(`${path}/inputs`),
        hasExports: await this.exists(`${path}/exports`),
        hasLocalRules: await this.exists(`${path}/rules`),
        agentsContent: await this.readIfExists(`${path}/AGENTS.md`),
        files: await this.listFilesRecursive(path)
      }))
    );
  }

  private async listImmediateFolders(path: string): Promise<string[]> {
    if (!(await this.exists(path))) {
      return [];
    }

    const listed = await this.app.vault.adapter.list(path);
    return listed.folders.map(normalizePath).sort();
  }

  private async listFilesRecursive(path: string): Promise<string[]> {
    const entries = await this.listEntriesRecursive(path);
    return entries
      .filter((entry) => entry.kind === VaultEntryKind.File)
      .map((entry) => entry.path)
      .sort();
  }

  private async listEntriesRecursive(path: string): Promise<VaultEntry[]> {
    const entries: VaultEntry[] = [];
    await this.collectEntries(path, entries);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async collectEntries(path: string, entries: VaultEntry[]): Promise<void> {
    const listed = await this.safeList(path);

    for (const file of listed.files) {
      const normalizedFile = normalizePath(file);
      if (!isIgnoredFile(normalizedFile)) {
        entries.push({ path: normalizedFile, kind: VaultEntryKind.File });
      }
    }

    for (const folder of listed.folders) {
      const normalizedFolder = normalizePath(folder);
      entries.push({ path: normalizedFolder, kind: VaultEntryKind.Folder });
      await this.collectEntries(normalizedFolder, entries);
    }
  }

  private async safeList(path: string): Promise<ListedFiles> {
    if (!(await this.exists(path))) {
      return { files: [], folders: [] };
    }

    return this.app.vault.adapter.list(path);
  }

  private async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  private async readIfExists(path: string): Promise<string> {
    if (!(await this.exists(path))) {
      return "";
    }

    return this.app.vault.adapter.read(path);
  }
}

export function extractWorkflowLinks(text: string): string[] {
  const links: string[] = [];

  for (const match of text.matchAll(WORKFLOW_LINK_PATTERN)) {
    const rawLink = match[1] ?? match[2];
    const normalizedLink = normalizeLinkTarget(rawLink);

    if (normalizedLink.startsWith(`${WORKFLOWS_PATH}/`)) {
      links.push(normalizedLink);
    }
  }

  return links;
}

function normalizeTaskText(text: string): string {
  return text
    .replace(MARKDOWN_TASK_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeLinkTarget(link: string): string {
  const trimmed = link.trim();
  const decoded = decodeLinkTarget(trimmed).replace(/^\/+/, "");

  if (!decoded.startsWith("../") && !decoded.startsWith("./")) {
    return normalizePath(decoded);
  }

  const segments = TASK_BOARD_DIRECTORY.split("/");
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return normalizePath(segments.join("/"));
}

function decodeLinkTarget(link: string): string {
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isIgnoredFile(path: string): boolean {
  const fileName = path.split("/").pop() ?? path;
  return IGNORED_FILE_NAMES.has(fileName);
}
