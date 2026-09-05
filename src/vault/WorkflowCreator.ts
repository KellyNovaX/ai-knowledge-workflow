import { App, ListedFiles } from "obsidian";
import { WorkflowType } from "../types";

const WORKFLOW_ROOT_PATH = "20-workflows";

enum WorkflowTemplatePath {
  Feature = "90-templates/workflow-feature-template",
  Incident = "90-templates/workflow-incident-template",
  Datafix = "90-templates/workflow-datafix-template",
  DataExport = "90-templates/workflow-data-export-template"
}

export interface WorkflowCreateResult {
  workflowPath: string;
  copiedFiles: string[];
}

export class WorkflowCreator {
  constructor(private readonly app: App) {}

  getWorkflowPath(workflowSlug: string): string {
    return `${WORKFLOW_ROOT_PATH}/${workflowSlug}`;
  }

  getTemplatePath(workflowType: WorkflowType): string {
    switch (workflowType) {
      case WorkflowType.Feature:
        return WorkflowTemplatePath.Feature;
      case WorkflowType.Incident:
        return WorkflowTemplatePath.Incident;
      case WorkflowType.Datafix:
        return WorkflowTemplatePath.Datafix;
      case WorkflowType.DataExport:
        return WorkflowTemplatePath.DataExport;
    }
  }

  async createWorkflow(workflowType: WorkflowType, workflowSlug: string): Promise<WorkflowCreateResult> {
    const workflowPath = this.getWorkflowPath(workflowSlug);
    const templatePath = this.getTemplatePath(workflowType);

    if (await this.app.vault.adapter.exists(workflowPath)) {
      throw new Error(`Workflow target already exists: ${workflowPath}`);
    }

    await this.ensureFolder(workflowPath);
    await this.ensureFolder(`${workflowPath}/inputs`);
    if (workflowType === WorkflowType.DataExport) {
      await this.ensureFolder(`${workflowPath}/exports`);
    }

    const copiedFiles = await this.copyTemplateFiles(templatePath, workflowPath);

    return {
      workflowPath,
      copiedFiles
    };
  }

  private async copyTemplateFiles(templatePath: string, workflowPath: string): Promise<string[]> {
    const copiedFiles: string[] = [];
    await this.copyFolder(templatePath, templatePath, workflowPath, copiedFiles);
    return copiedFiles;
  }

  private async copyFolder(
    rootTemplatePath: string,
    currentTemplatePath: string,
    workflowPath: string,
    copiedFiles: string[]
  ): Promise<void> {
    const listed = await this.safeList(currentTemplatePath);

    for (const folder of listed.folders) {
      const relativeFolder = stripPrefix(folder, rootTemplatePath);
      if (isLocalRulesPath(relativeFolder)) {
        continue;
      }
      await this.ensureFolder(`${workflowPath}/${relativeFolder}`);
      await this.copyFolder(rootTemplatePath, folder, workflowPath, copiedFiles);
    }

    for (const file of listed.files) {
      const relativeFile = stripPrefix(file, rootTemplatePath);
      if (isLocalRulesPath(relativeFile)) {
        continue;
      }
      const target = `${workflowPath}/${relativeFile}`;
      const content = await this.app.vault.adapter.read(file);
      await this.ensureFolder(parentPath(target));
      await this.app.vault.adapter.write(target, content);
      copiedFiles.push(target);
    }
  }

  private async safeList(path: string): Promise<ListedFiles> {
    if (!(await this.app.vault.adapter.exists(path))) {
      throw new Error(`Workflow template path is missing: ${path}`);
    }

    return this.app.vault.adapter.list(path);
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
}

function stripPrefix(path: string, prefix: string): string {
  return path.slice(prefix.length).replace(/^\/+/, "");
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function isLocalRulesPath(path: string): boolean {
  return path === "rules" || path.startsWith("rules/");
}
