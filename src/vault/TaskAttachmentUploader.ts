import { App } from "obsidian";
import { TaskScope } from "../types";
import { BoardTask } from "./TaskBoard";

export interface TaskAttachmentUploadResult {
  targetRoot: string;
  copiedFiles: number;
}

export class TaskAttachmentUploader {
  constructor(private readonly app: App) {}

  async uploadFiles(task: BoardTask, files: FileList | File[]): Promise<TaskAttachmentUploadResult> {
    const selectedFiles = Array.from(files);
    const inputsPath = getTaskInputsPath(task);
    if (!inputsPath) {
      throw new Error("Task has no linked entry file.");
    }

    if (selectedFiles.length === 0) {
      throw new Error("No files selected.");
    }

    const targets = selectedFiles.map((file) => ({
      file,
      targetPath: `${inputsPath}/${getBrowserFileRelativePath(file)}`
    }));

    for (const target of targets) {
      if (await this.app.vault.adapter.exists(target.targetPath)) {
        throw new Error(`Target already exists: ${target.targetPath}`);
      }
    }

    await this.ensureFolder(inputsPath);
    for (const target of targets) {
      await this.copyBrowserFile(target.file, target.targetPath);
    }

    return {
      targetRoot: inputsPath,
      copiedFiles: targets.length
    };
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;

      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async copyBrowserFile(file: File, targetPath: string): Promise<void> {
    await this.ensureFolder(parentPath(targetPath));
    await this.app.vault.adapter.writeBinary(targetPath, await file.arrayBuffer());
  }
}

function getTaskInputsPath(task: BoardTask): string | null {
  const entryPath = getTaskEntryPath(task);

  if (!entryPath) {
    return null;
  }

  const projectMatch = entryPath.match(/^(30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+)\/(?:AGENTS|index)\.md$/);
  if (task.taskScope === TaskScope.Project && projectMatch) {
    return `${projectMatch[1]}/inputs`;
  }

  const workflowMatch = entryPath.match(/^(20-workflows\/[^/]+)\/AGENTS\.md$/);
  if (task.taskScope === TaskScope.Workflow && workflowMatch) {
    return `${workflowMatch[1]}/inputs`;
  }

  const generalMatch = entryPath.match(/^(10-tasks\/items\/\d{4}\/\d{2}\/[^/]+)\.md$/);
  if (task.taskScope === TaskScope.General && generalMatch) {
    return `${generalMatch[1]}/inputs`;
  }

  return null;
}

function getTaskEntryPath(task: BoardTask): string | null {
  for (const link of task.links) {
    const target = normalizeTaskEntryPath(link.target);

    if (isTaskEntryPath(target)) {
      return target;
    }
  }

  return null;
}

function isTaskEntryPath(path: string): boolean {
  return /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/.test(path) ||
    /^20-workflows\/[^/]+\/AGENTS\.md$/.test(path) ||
    /^10-tasks\/items\/\d{4}\/\d{2}\/[^/]+\.md$/.test(path);
}

function normalizeTaskEntryPath(path: string): string {
  if (isTaskEntryPath(path)) {
    return path;
  }

  if (/^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+$/.test(path)) {
    return `${path}/AGENTS.md`;
  }

  if (/^20-workflows\/[^/]+$/.test(path)) {
    return `${path}/AGENTS.md`;
  }

  const withExtension = path.endsWith(".md") ? path : `${path}.md`;
  return isTaskEntryPath(withExtension) ? withExtension : path;
}

function getBrowserFileRelativePath(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizeRelativePath(relativePath || file.name);
}

function normalizeRelativePath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
