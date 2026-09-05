import {
  TaskBoardEntry,
  TaskScope,
  TaskStatus,
  ValidationIssue,
  ValidationSeverity,
  VaultIndex,
  VaultIssueCode
} from "../types";
import { parseTaskFileMetadata } from "./TaskFileMetadata";

const PROJECT_INPUT_PATH_PATTERN = /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/.+$/;
const PROJECT_TASK_ENTRY_PATTERN = /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/;
const LEGACY_PROJECT_TASK_ENTRY_PATTERN = /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/index\.md$/;
const PROJECT_TASK_PATH_PROJECT_PATTERN = /^30-projects\/([^/]+)\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/;
const PROJECT_REFERENCE_PATTERN = /30-projects\/([^/\]\s`|)]+)/g;
const AGENTS_SHORT_ENTRY_MAX_BYTES = 3 * 1024;
const PROJECT_LINKS_HOT_ENTRY_MAX_BYTES = 5 * 1024;
const REQUIRED_PROJECT_TASK_HEADINGS = ["当前任务", "路由", "门槛"];
const REQUIRED_WORKFLOW_HEADINGS = ["当前任务", "路由", "门槛"];
const PROJECT_LINKS_ENV_PATTERN =
  /(数据库连接|日志信息|日志项目|Nacos|Redis|Kafka|Bruno|服务访问方式|服务地址|配置中心|Diamond|DB\b|mysql\s+-h|curl\s+-i)/i;
const PROJECT_LINKS_RUNBOOK_PATTERN = /(```bash|curl\s+|ssh\s+|mysql\s+|bru\s+run|kubectl\s+|排查步骤|联调|SOP|常用命令)/i;

export class VaultValidator {
  validateVault(index: VaultIndex): ValidationIssue[] {
    return [
      ...this.validateCoreEntries(index),
      ...this.validateProjectEntries(index),
      ...this.validateWorkflowEntries(index),
      ...this.validateTaskBoard(index),
      ...this.validateMaintenanceEntries(index)
    ];
  }

  private validateMaintenanceEntries(index: VaultIndex): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const file of index.routingFiles ?? []) {
      if (file.path === "AGENTS.md" || /^30-projects\/[^/]+\/AGENTS\.md$/.test(file.path)) {
        issues.push(...this.validateShortAgentsEntry(file.path, file.content));
      }
    }
    for (const link of index.linkChecks ?? []) {
      if (!link.exists) issues.push({ code: VaultIssueCode.BrokenMarkdownLink, severity: ValidationSeverity.Error,
        path: link.path, message: `Broken local link on line ${link.line}: ${link.target}` });
    }
    const ids = new Map<string, string>();
    for (const task of index.taskReferences ?? []) {
      const location = `${task.path}:${task.line}`;
      if (task.id) {
        const previous = ids.get(task.id);
        if (previous) issues.push({ code: VaultIssueCode.DuplicateTask, severity: ValidationSeverity.Error,
          path: task.path, message: `Task ID ${task.id} appears in both ${previous} and ${location}.` });
        else ids.set(task.id, location);
      }
      if (task.entryContent === null) {
        issues.push({ code: VaultIssueCode.MissingTaskEntry, severity: ValidationSeverity.Error,
          path: task.path, message: `Task on line ${task.line} has no valid entry: ${task.entryPath ?? "missing task link"}.` });
        continue;
      }
      const metadata = parseTaskFileMetadata(task.entryContent);
      if (!metadata?.id || metadata.id !== task.id || metadata.status !== task.status ||
          task.checked !== (metadata.status === TaskStatus.Done)) {
        issues.push({ code: VaultIssueCode.TaskMetadataMismatch, severity: ValidationSeverity.Error,
          path: task.path, message: `Task on line ${task.line} disagrees with entry frontmatter (ID, status, or checkbox): ${task.entryPath}.` });
      }
      if (metadata?.completed_at && metadata.status !== TaskStatus.Done) {
        issues.push({ code: VaultIssueCode.TaskMetadataMismatch, severity: ValidationSeverity.Warning,
          path: task.entryPath ?? task.path, message: "Active task still has completed_at; clear it when reopening the task." });
      }
    }
    return issues;
  }

  private validateCoreEntries(index: VaultIndex): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!index.rootAgentsExists) {
      issues.push({
        code: VaultIssueCode.MissingRootAgents,
        severity: ValidationSeverity.Blocker,
        message: "Root AGENTS.md is missing.",
        path: "AGENTS.md"
      });
    }

    if (!index.taskBoardExists) {
      issues.push({
        code: VaultIssueCode.MissingTaskBoard,
        severity: ValidationSeverity.Blocker,
        message: "Task board is missing.",
        path: "10-tasks/board.md"
      });
    }

    return issues;
  }

  private validateProjectEntries(index: VaultIndex): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const project of index.projects) {
      if (!project.hasAgents && !project.hasIndex) {
        issues.push({
          code: VaultIssueCode.MissingProjectEntry,
          severity: ValidationSeverity.Error,
          message: "Project is missing both AGENTS.md and index.md entry files.",
          path: project.path
        });
      }

      if (project.hasLinks && !hasHeading(project.linksContent, "相关长期知识")) {
        issues.push({
          code: VaultIssueCode.MissingProjectKnowledgeSection,
          severity: ValidationSeverity.Warning,
          message: "Project links.md should include a 相关长期知识 section for cross-project knowledge entry points.",
          path: `${project.path}/links.md`
        });
      }

      if (project.hasLinks && !hasHeading(project.linksContent, "源码仓库")) {
        issues.push({
          code: VaultIssueCode.MissingProjectSourceSection,
          severity: ValidationSeverity.Warning,
          message: "Project links.md should include a 源码仓库 section for source path, branch, modules, and commands.",
          path: `${project.path}/links.md`
        });
      }

      if (project.hasLinks) {
        issues.push(...this.validateProjectLinksHotEntry(`${project.path}/links.md`, project.linksContent));
      }

      for (const inputFile of project.inputFiles) {
        if (!PROJECT_INPUT_PATH_PATTERN.test(inputFile)) {
          issues.push({
            code: VaultIssueCode.InvalidProjectInputPath,
            severity: ValidationSeverity.Error,
            message: "Project input file must live under inputs/YYYY/MM/<task-slug>/.",
            path: inputFile
          });
        }

      }

      for (const inputIndexFile of project.inputIndexFiles) {
        if (PROJECT_TASK_ENTRY_PATTERN.test(inputIndexFile.path)) {
          issues.push(...this.validateProjectTaskStructure(inputIndexFile.path, inputIndexFile.content));
          issues.push(...this.validateProjectTaskDevelopmentBranch(inputIndexFile.path, inputIndexFile.content));
        }
      }
    }

    return issues;
  }

  private validateProjectLinksHotEntry(path: string, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const byteLength = new TextEncoder().encode(content).length;

    if (byteLength > PROJECT_LINKS_HOT_ENTRY_MAX_BYTES) {
      issues.push({
        code: VaultIssueCode.OversizedProjectLinks,
        severity: ValidationSeverity.Warning,
        message: "Project links.md is larger than 5KB; keep hot source/document links here and move environment details to env.md or runbook steps to runbook.md.",
        path
      });
    }

    if (PROJECT_LINKS_ENV_PATTERN.test(content)) {
      issues.push({
        code: VaultIssueCode.ProjectLinksColdContent,
        severity: ValidationSeverity.Warning,
        message: "Project links.md appears to contain environment details; move DB/logs/Nacos/Redis/Kafka/Bruno/service endpoints to env.md.",
        path
      });
    }

    if (PROJECT_LINKS_RUNBOOK_PATTERN.test(content)) {
      issues.push({
        code: VaultIssueCode.ProjectLinksColdContent,
        severity: ValidationSeverity.Warning,
        message: "Project links.md appears to contain commands or runbook steps; move curl/ssh/mysql/bru/kubectl/SOP content to runbook.md.",
        path
      });
    }

    return issues;
  }

  private validateProjectTaskStructure(path: string, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (LEGACY_PROJECT_TASK_ENTRY_PATTERN.test(path)) {
      issues.push({
        code: VaultIssueCode.LegacyProjectTaskEntry,
        severity: ValidationSeverity.Warning,
        message: "Project task uses legacy index.md entry; new project tasks should use AGENTS.md.",
        path
      });
    }

    if (!content.includes("关联项目")) {
      issues.push({
        code: VaultIssueCode.MissingProjectTaskStructure,
        severity: ValidationSeverity.Warning,
        message: "Project task AGENTS.md should include an 关联项目 field.",
        path
      });
    }

    const metadata = parseTaskFileMetadata(content);
    if (!metadata) {
      issues.push({
        code: VaultIssueCode.MissingProjectTaskStructure,
        severity: ValidationSeverity.Warning,
        message: "Project task AGENTS.md should include frontmatter for id, type, status, title, and created metadata.",
        path
      });
    } else {
      for (const field of ["id", "type", "status", "title", "created"] as const) {
        if (!metadata[field]) {
          issues.push({
            code: VaultIssueCode.MissingProjectTaskStructure,
            severity: ValidationSeverity.Warning,
            message: `Project task AGENTS.md frontmatter should include ${field}.`,
            path
          });
        }
      }
    }

    issues.push(...this.validateProjectTaskProjectConsistency(path, content));
    issues.push(...this.validateShortAgentsEntry(path, content));

    for (const heading of REQUIRED_PROJECT_TASK_HEADINGS) {
      if (!hasHeading(content, heading)) {
        issues.push({
          code: VaultIssueCode.MissingProjectTaskStructure,
          severity: ValidationSeverity.Warning,
          message: `Project task AGENTS.md should include a ${heading} section.`,
          path
        });
      }
    }

    return issues;
  }

  private validateProjectTaskProjectConsistency(path: string, content: string): ValidationIssue[] {
    const pathProject = getProjectFromTaskEntryPath(path);
    const metadata = parseTaskFileMetadata(content);
    const metadataProjects = getMetadataProjects(metadata?.project);
    const referencedProjects = getReferencedProjects(content);
    const issues: ValidationIssue[] = [];

    if (!pathProject) {
      return issues;
    }

    if (metadata?.type && metadata.type !== TaskScope.Project) {
      issues.push({
        code: VaultIssueCode.ProjectTaskProjectMismatch,
        severity: ValidationSeverity.Warning,
        message: `Project task frontmatter type should be project, got ${metadata.type}.`,
        path
      });
    }

    if (metadataProjects.length > 0 && !metadataProjects.includes(pathProject)) {
      issues.push({
        code: VaultIssueCode.ProjectTaskProjectMismatch,
        severity: ValidationSeverity.Warning,
        message: `Project task path belongs to ${pathProject}, but frontmatter project is ${metadataProjects.join(", ")}.`,
        path
      });
    }

    const mismatchedReferences = referencedProjects.filter((project) => project !== pathProject);
    if (mismatchedReferences.length > 0) {
      issues.push({
        code: VaultIssueCode.ProjectTaskProjectMismatch,
        severity: ValidationSeverity.Warning,
        message: `Project task path belongs to ${pathProject}, but body links reference ${Array.from(new Set(mismatchedReferences)).join(", ")}.`,
        path
      });
    }

    return issues;
  }

  private validateProjectTaskDevelopmentBranch(path: string, content: string): ValidationIssue[] {
    if (hasDevelopmentBranchValue(content)) {
      return [];
    }

    return [
      {
        code: VaultIssueCode.MissingProjectTaskDevelopmentBranch,
        severity: ValidationSeverity.Warning,
        message: "Project task AGENTS.md should include a filled 目标分支 field.",
        path
      }
    ];
  }

  private validateWorkflowEntries(index: VaultIndex): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const workflow of index.workflows) {
      if (!workflow.hasAgents && !workflow.hasTodo) {
        issues.push({
          code: VaultIssueCode.MissingWorkflowEntry,
          severity: ValidationSeverity.Error,
          message: "Workflow is missing both AGENTS.md and todo.md entry files.",
          path: workflow.path
        });
      }

      if (!workflow.hasInputs) {
        issues.push({
          code: VaultIssueCode.MissingWorkflowInputs,
          severity: ValidationSeverity.Error,
          message: "Workflow inputs/ directory is missing.",
          path: `${workflow.path}/inputs`
        });
      }

      if (isDataExportWorkflow(workflow.files, workflow.path) && !workflow.hasExports) {
        issues.push({
          code: VaultIssueCode.MissingWorkflowExports,
          severity: ValidationSeverity.Error,
          message: "Data export workflow exports/ directory is missing.",
          path: `${workflow.path}/exports`
        });
      }

      if (workflow.hasAgents) {
        const agentsPath = `${workflow.path}/AGENTS.md`;
        issues.push(...this.validateShortAgentsEntry(agentsPath, workflow.agentsContent));
        issues.push(...this.validateWorkflowTaskMetadata(workflow.path, workflow.agentsContent));
        issues.push(...this.validateWorkflowKnowledgeScaffolding(workflow.path, workflow.agentsContent));
        issues.push(...this.validateWorkflowDevelopmentBranch(workflow.path, workflow.agentsContent));
      }

      if (workflow.hasLocalRules) {
        issues.push({
          code: VaultIssueCode.LocalWorkflowRules,
          severity: ValidationSeverity.Warning,
          message: "Workflow should not keep a local rules/ directory; link to vault root rules/*.md from AGENTS.md instead.",
          path: `${workflow.path}/rules`
        });
      }
    }

    return issues;
  }

  private validateWorkflowKnowledgeScaffolding(workflowPath: string, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const agentsPath = `${workflowPath}/AGENTS.md`;

    if (!content.includes("关联项目")) {
      issues.push({
        code: VaultIssueCode.MissingWorkflowProjectsSection,
        severity: ValidationSeverity.Warning,
        message: "Workflow AGENTS.md should include an 关联项目 field in its short entry.",
        path: agentsPath
      });
    }

    if (!content.includes("[[rules/") && !content.includes("](../../rules/")) {
      issues.push({
        code: VaultIssueCode.MissingWorkflowKnowledgeSection,
        severity: ValidationSeverity.Warning,
        message: "Workflow AGENTS.md should link to vault root rules/*.md instead of carrying local rules.",
        path: agentsPath
      });
    }

    for (const heading of REQUIRED_WORKFLOW_HEADINGS) {
      if (!hasHeading(content, heading)) {
        issues.push({
          code: VaultIssueCode.MissingWorkflowStructure,
          severity: ValidationSeverity.Warning,
          message: `Workflow AGENTS.md should include a ${heading} section.`,
          path: agentsPath
        });
      }
    }

    return issues;
  }

  private validateShortAgentsEntry(path: string, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (new TextEncoder().encode(content).length > AGENTS_SHORT_ENTRY_MAX_BYTES) {
      issues.push({
        code: VaultIssueCode.OversizedAgentsEntry,
        severity: ValidationSeverity.Warning,
        message: "AGENTS.md is larger than 3KB; split details into overview.md, execution.md, todo.md, risk.md, or project links.",
        path
      });
    }

    if (hasHeading(content, "执行结果")) {
      issues.push({
        code: VaultIssueCode.AgentsExecutionSection,
        severity: ValidationSeverity.Warning,
        message: "AGENTS.md contains a 执行结果 section; move execution results to execution.md and keep AGENTS.md as a short routing entry.",
        path
      });
    }

    return issues;
  }

  private validateWorkflowTaskMetadata(workflowPath: string, content: string): ValidationIssue[] {
    const metadata = parseTaskFileMetadata(content);

    if (!metadata) {
      return [
        {
          code: VaultIssueCode.MissingWorkflowStructure,
          severity: ValidationSeverity.Warning,
          message: "Workflow AGENTS.md should include frontmatter for id, type, status, title, and created metadata.",
          path: `${workflowPath}/AGENTS.md`
        }
      ];
    }

    const issues: ValidationIssue[] = [];
    for (const field of ["id", "type", "status", "title", "created"] as const) {
      if (!metadata[field]) {
        issues.push({
          code: VaultIssueCode.MissingWorkflowStructure,
          severity: ValidationSeverity.Warning,
          message: `Workflow AGENTS.md frontmatter should include ${field}.`,
          path: `${workflowPath}/AGENTS.md`
        });
      }
    }

    return issues;
  }

  private validateWorkflowDevelopmentBranch(workflowPath: string, content: string): ValidationIssue[] {
    if ((hasHeading(content, "开发分支") || hasHeading(content, "路由")) && hasDevelopmentBranchValue(content)) {
      return [];
    }

    return [
      {
        code: VaultIssueCode.MissingWorkflowDevelopmentBranch,
        severity: ValidationSeverity.Warning,
        message: "Workflow AGENTS.md should include a filled 目标分支 field in its short routing entry.",
        path: `${workflowPath}/AGENTS.md`
      }
    ];
  }

  private validateTaskBoard(index: VaultIndex): ValidationIssue[] {
    const workflowPaths = new Set(index.workflows.map((workflow) => workflow.path));
    const workflowFiles = new Set(index.workflows.flatMap((workflow) => workflow.files));

    return [
      ...(index.linkChecks ? [] : this.validateWorkflowLinks(index.taskBoardEntries, workflowPaths, workflowFiles)),
      ...this.validateDuplicateTasks(index.taskBoardEntries)
    ];
  }

  private validateWorkflowLinks(
    entries: TaskBoardEntry[],
    workflowPaths: Set<string>,
    workflowFiles: Set<string>
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const entry of entries) {
      for (const link of entry.workflowLinks) {
        if (!workflowPaths.has(link) && !workflowFiles.has(link) && !workflowFiles.has(`${link}.md`)) {
          issues.push({
            code: VaultIssueCode.BrokenWorkflowLink,
            severity: ValidationSeverity.Error,
            message: `Task board workflow link is broken on line ${entry.line}.`,
            path: link
          });
        }
      }
    }

    return issues;
  }

  private validateDuplicateTasks(entries: TaskBoardEntry[]): ValidationIssue[] {
    const seen = new Map<string, TaskBoardEntry>();
    const issues: ValidationIssue[] = [];

    for (const entry of entries) {
      const firstEntry = seen.get(entry.normalizedText);

      if (firstEntry) {
        issues.push({
          code: VaultIssueCode.DuplicateTask,
          severity: ValidationSeverity.Warning,
          message: `Duplicate task text on lines ${firstEntry.line} and ${entry.line}.`,
          path: "10-tasks/board.md"
        });
      } else {
        seen.set(entry.normalizedText, entry);
      }
    }

    return issues;
  }

}

function isDataExportWorkflow(files: string[], workflowPath: string): boolean {
  return files.includes(`${workflowPath}/query.sql`);
}

function hasHeading(content: string, heading: string): boolean {
  return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(content);
}

function hasDevelopmentBranchValue(content: string): boolean {
  const branchListPattern = /^-\s*目标(?:开发)?分支[：:]\s*(.+?)\s*$/;

  return content
    .split(/\r?\n/)
    .some((line) => {
      const listMatch = line.trim().match(branchListPattern);
      if (listMatch) {
        return isFilledBranchValue(listMatch[1]);
      }

      if (!line.includes("|")) {
        return false;
      }

      const parts = line
        .replace(/`/g, "")
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length < 2 || parts.includes("项目") || parts.includes("目标开发分支")) {
        return false;
      }

      return isFilledBranchValue(parts[parts.length - 1]);
    });
}

function isFilledBranchValue(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== "待填写" && !/^-+$/.test(normalized);
}

function getProjectFromTaskEntryPath(path: string): string | null {
  return path.match(PROJECT_TASK_PATH_PROJECT_PATTERN)?.[1] ?? null;
}

function getMetadataProjects(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getReferencedProjects(content: string): string[] {
  const projects: string[] = [];

  for (const match of content.matchAll(PROJECT_REFERENCE_PATTERN)) {
    projects.push(match[1]);
  }

  return Array.from(new Set(projects));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
