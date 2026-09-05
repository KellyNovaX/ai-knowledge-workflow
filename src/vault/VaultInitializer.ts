import { App } from "obsidian";
import { WorkflowType } from "../types";

export interface VaultInitializationPlan {
  missingFolders: string[];
  missingFiles: string[];
}

export interface VaultInitializationResult {
  createdFolders: string[];
  createdFiles: string[];
}

const STARTER_FOLDERS = [
  "rules",
  "10-tasks/items",
  "20-workflows",
  "30-projects",
  "60-其他/周报",
  "80-inbox",
  "90-templates/project-task-template",
  "90-templates/workflow-feature-template/inputs",
  "90-templates/workflow-incident-template/inputs",
  "90-templates/workflow-datafix-template/inputs",
  "90-templates/workflow-data-export-template/inputs",
  "90-templates/workflow-data-export-template/exports"
];

const ROOT_AGENTS = `# AI Knowledge Vault

## 定位

- 本目录是工程知识与任务上下文入口，不是源码工作区。
- 任务板只做轻量调度；任务细节写入对应任务入口。

## 默认路由

1. 待办从 [任务板](10-tasks/board.md) 进入。
2. 无需关联项目的通用任务进入 \`10-tasks/items/\`，新知识库无需先创建项目。
3. 项目任务进入 \`30-projects/<project>/inputs/YYYY/MM/<task>/AGENTS.md\`。
4. 复杂任务进入 \`20-workflows/<workflow>/AGENTS.md\`。
5. 原始输入放入 \`80-inbox/\`，整理后再归档到任务或项目。

## 通用规则

- [任务路由](rules/task-routing.md)
- [环境安全](rules/env-safety.md)
- [写回归档](rules/writeback.md)
- [工作流规则](rules/workflow-policy.md)
- [输入归属](rules/input-policy.md)
- [项目知识](rules/project-knowledge.md)
`;

const WORKFLOW_AGENTS_TEMPLATE = `---
id: "{{TASK_ID}}"
type: workflow
status: todo
project: "<project>"
title: "{{WORKFLOW_TITLE}}"
created: "{{YYYY-MM-DD}}"
entry_type: workflow
task_type: "{{WORKFLOW_TYPE}}"
---

# {{WORKFLOW_TITLE}}

## 当前任务

- 目标：待填写
- 执行记录：[execution](execution.md)
- 需求背景：[overview](overview.md)
- 待办：[todo](todo.md)；风险：[risk](risk.md)；发布准备：[release-prep](release-prep.md)
{{WORKFLOW_FILES}}

## 路由

- 关联项目：[AGENTS](../../30-projects/%3Cproject%3E/AGENTS.md)、[links](../../30-projects/%3Cproject%3E/links.md)
- 项目：[index](../../30-projects/%3Cproject%3E/index.md)
  - 目标开发分支：待填写
- 项目入口：[AGENTS](../../30-projects/%3Cproject%3E/AGENTS.md)
- 规则：[task-routing](../../rules/task-routing.md)、[workflow-policy](../../rules/workflow-policy.md)、[writeback](../../rules/writeback.md)、[env-safety](../../rules/env-safety.md)

## 任务说明

说明这次需求要解决什么问题，以及完成边界。

## 门槛

- 开发前读取项目入口并确认源码仓库和目标分支。
- 涉及外部写操作时先说明影响并等待确认。
`;

const EXECUTION_TEMPLATE = `# Execution

## 执行记录

- 待补充
`;

const OVERVIEW_TEMPLATE = `# Overview

## 背景

- 待补充

## 目标

- 待补充

## 非目标

- 待补充
`;

const RELEASE_PREP_TEMPLATE = `# Release Preparation

## 发布前检查

- [ ] 目标分支已确认
- [ ] 影响范围已确认
- [ ] 回滚方案已确认
`;

function workflowAgentsTemplate(type: WorkflowType): string {
  const routes: Record<WorkflowType, string> = {
    [WorkflowType.Feature]: "",
    [WorkflowType.Incident]: "- 排查：[investigation](investigation.md)；时间线：[timeline](timeline.md)",
    [WorkflowType.Datafix]: "- 数据修复：[execute.sql](execute.sql)；验证：[verify.sql](verify.sql)；回滚：[rollback.sql](rollback.sql)；结果：[result](result.md)",
    [WorkflowType.DataExport]: "- 数据导出：[query.sql](query.sql)；核对：[verify](verify.md)；结果：[result](result.md)；产物：[exports](exports/)"
  };
  return WORKFLOW_AGENTS_TEMPLATE.replace("{{WORKFLOW_TYPE}}", type).replace("{{WORKFLOW_FILES}}", routes[type]);
}

const STARTER_FILES: Record<string, string> = {
  "AGENTS.md": ROOT_AGENTS,
  "rules/task-routing.md": `# 任务路由\n\n- 任务板只保留调度信息，状态的唯一来源是任务入口 frontmatter 的 \`status\`。\n- 看板和归档由插件或配套任务脚本同步，正文不重复维护状态。\n- 状态使用 \`doing\`、\`todo\`、\`pending_release\`、\`waiting\`、\`backlog\`、\`done\`。\n- 通用任务进入 \`10-tasks/items/\`。\n- 单项目任务进入项目 \`inputs/YYYY/MM/\`。\n- 跨项目、长周期或高风险任务进入 \`20-workflows/\`。\n`,
  "rules/env-safety.md": `# 环境安全\n\n- 环境不明确时先确认，不默认使用生产环境。\n- 凭据不写入共享模板；如需本地保存，由仓库所有者明确决定。\n- 外部写操作、数据修改和发布动作执行前说明影响范围。\n`,
  "rules/writeback.md": `# 写回与归档\n\n- 活动任务写入 \`10-tasks/board.md\`。\n- 完成任务归档到 \`10-tasks/done.md\`，同步入口状态为 \`done\`。\n- 新完成任务写入带时区的 ISO 8601 \`completed_at\`；重开时删除，再次完成时记录新的完成时间。历史缺失日期保持未知，不推测补写。\n- 执行过程写入任务入口或 \`execution.md\`，不写入任务板。\n`,
  "rules/workflow-policy.md": `# Workflow 规则\n\n- 复杂、跨项目、需持续记录或有风险控制的工作使用 workflow。\n- workflow 至少包含 AGENTS.md、overview.md、execution.md、todo.md、risk.md、release-prep.md 和 inputs/。\n- feature 记录需求、待办和风险；incident 补充 investigation.md 与 timeline.md。\n- datafix 使用 execute.sql、verify.sql 和 rollback.sql，执行前确认环境、影响范围、验证和回滚方案。\n- data-export 使用只读 query.sql、verify.md、result.md 和 exports/，明确数据范围并检查敏感字段。\n`,
  "rules/input-policy.md": `# 输入归属\n\n- 未整理材料先放入 \`80-inbox/\`。\n- 明确项目归属后再移动到项目任务或 workflow 的 inputs/。\n- 不确定归属时保留原位置并询问用户。\n`,
  "rules/project-knowledge.md": `# 项目知识\n\n- 项目稳定知识放在 \`30-projects/<project>/\`。\n- links.md 保持轻量；环境事实写入 env.md；操作步骤写入 runbook.md。\n- 源码保持在独立源码仓库，只记录路径和入口。\n`,
  "10-tasks/board.md": `# Tasks\n\n## Doing\n\n## Todo\n\n## Pending Release\n\n## Waiting\n\n## Backlog\n`,
  "10-tasks/done.md": `# Tasks Done\n\n归档已完成事项，保留必要链接。\n`,
  "30-projects/index.md": `# Projects\n\n项目知识入口索引。每个项目使用独立目录。\n\n当前没有项目，可直接创建通用任务。需要项目任务或工作流时，先在此目录建立真实项目的 AGENTS.md、index.md 和 links.md，或使用单独安装的配套项目知识技能生成。\n`,
  "80-inbox/AGENTS.md": `# Inbox\n\n- 本目录保存尚未分类的原始输入。\n- 整理前保留原内容；确认归属后再移动。\n- 不在这里长期维护任务状态或执行记录。\n`,
  "90-templates/index.md": `# Templates\n\n供 AI Knowledge Workflow 创建项目任务和 workflow 使用。\n`,
  "90-templates/project-task-template/execution.md": EXECUTION_TEMPLATE,
  "90-templates/project-task-template/release-prep.md": RELEASE_PREP_TEMPLATE,
  "90-templates/workflow-feature-template/AGENTS.md": workflowAgentsTemplate(WorkflowType.Feature),
  "90-templates/workflow-feature-template/overview.md": OVERVIEW_TEMPLATE,
  "90-templates/workflow-feature-template/execution.md": EXECUTION_TEMPLATE,
  "90-templates/workflow-feature-template/todo.md": `# Todo\n\n- [ ] 待补充\n`,
  "90-templates/workflow-feature-template/risk.md": `# Risks\n\n- 待补充\n`,
  "90-templates/workflow-feature-template/release-prep.md": RELEASE_PREP_TEMPLATE,
  "90-templates/workflow-feature-template/inputs/.gitkeep": "",
  "90-templates/workflow-incident-template/AGENTS.md": workflowAgentsTemplate(WorkflowType.Incident),
  "90-templates/workflow-incident-template/overview.md": OVERVIEW_TEMPLATE,
  "90-templates/workflow-incident-template/execution.md": EXECUTION_TEMPLATE,
  "90-templates/workflow-incident-template/investigation.md": `# Investigation\n\n## 现象\n\n- 待补充\n\n## 假设与证据\n\n- 待补充\n`,
  "90-templates/workflow-incident-template/timeline.md": `# Timeline\n\n- 待补充\n`,
  "90-templates/workflow-incident-template/todo.md": `# Todo\n\n- [ ] 待补充\n`,
  "90-templates/workflow-incident-template/risk.md": `# Risks\n\n- 待补充\n`,
  "90-templates/workflow-incident-template/release-prep.md": RELEASE_PREP_TEMPLATE,
  "90-templates/workflow-incident-template/inputs/.gitkeep": "",
  "90-templates/workflow-datafix-template/AGENTS.md": workflowAgentsTemplate(WorkflowType.Datafix),
  "90-templates/workflow-datafix-template/overview.md": OVERVIEW_TEMPLATE,
  "90-templates/workflow-datafix-template/execution.md": EXECUTION_TEMPLATE,
  "90-templates/workflow-datafix-template/result.md": `# Result\n\n- 待补充\n`,
  "90-templates/workflow-datafix-template/release-prep.md": RELEASE_PREP_TEMPLATE,
  "90-templates/workflow-datafix-template/execute.sql": `-- Write the reviewed data-fix SQL here.\n`,
  "90-templates/workflow-datafix-template/verify.sql": `-- Write read-only verification SQL here.\n`,
  "90-templates/workflow-datafix-template/rollback.sql": `-- Write rollback SQL here.\n`,
  "90-templates/workflow-datafix-template/todo.md": `# Todo\n\n- [ ] 待补充\n`,
  "90-templates/workflow-datafix-template/risk.md": `# Risks\n\n- 待补充\n`,
  "90-templates/workflow-datafix-template/inputs/.gitkeep": "",
  "90-templates/workflow-data-export-template/AGENTS.md": workflowAgentsTemplate(WorkflowType.DataExport),
  "90-templates/workflow-data-export-template/overview.md": OVERVIEW_TEMPLATE,
  "90-templates/workflow-data-export-template/execution.md": EXECUTION_TEMPLATE,
  "90-templates/workflow-data-export-template/result.md": `# Result\n\n- 导出文件：待补充\n- 数据范围：待补充\n`,
  "90-templates/workflow-data-export-template/verify.md": `# Verification\n\n- [ ] 行数已核对\n- [ ] 敏感字段已检查\n`,
  "90-templates/workflow-data-export-template/query.sql": `-- Write read-only export SQL here.\n`,
  "90-templates/workflow-data-export-template/todo.md": `# Todo\n\n- [ ] 待补充\n`,
  "90-templates/workflow-data-export-template/risk.md": `# Risks\n\n- 待补充\n`,
  "90-templates/workflow-data-export-template/release-prep.md": RELEASE_PREP_TEMPLATE,
  "90-templates/workflow-data-export-template/inputs/.gitkeep": "",
  "90-templates/workflow-data-export-template/exports/.gitkeep": ""
};

export class VaultInitializer {
  constructor(private readonly app: App) {}

  async preview(): Promise<VaultInitializationPlan> {
    const missingFolders: string[] = [];
    const missingFiles: string[] = [];

    for (const folder of STARTER_FOLDERS) {
      if (!(await this.app.vault.adapter.exists(folder))) {
        missingFolders.push(folder);
      }
    }

    for (const path of Object.keys(STARTER_FILES)) {
      if (!(await this.app.vault.adapter.exists(path))) {
        missingFiles.push(path);
      }
    }

    return { missingFolders, missingFiles };
  }

  async initialize(): Promise<VaultInitializationResult> {
    const plan = await this.preview();
    const createdFolders: string[] = [];
    const createdFiles: string[] = [];

    for (const folder of [...plan.missingFolders].sort(compareFolderDepth)) {
      await this.ensureFolder(folder, createdFolders);
    }

    for (const path of plan.missingFiles) {
      await this.ensureFolder(parentPath(path), createdFolders);
      if (await this.app.vault.adapter.exists(path)) {
        continue;
      }
      await this.app.vault.adapter.write(path, STARTER_FILES[path]);
      createdFiles.push(path);
    }

    return { createdFolders, createdFiles };
  }

  private async ensureFolder(path: string, createdFolders: string[]): Promise<void> {
    if (!path) {
      return;
    }

    let current = "";
    for (const segment of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      if (await this.app.vault.adapter.exists(current)) {
        continue;
      }
      await this.app.vault.adapter.mkdir(current);
      createdFolders.push(current);
    }
  }
}

function compareFolderDepth(left: string, right: string): number {
  return left.split("/").length - right.split("/").length || left.localeCompare(right);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
