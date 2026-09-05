import { App, TFile, normalizePath } from "obsidian";

export enum GeneralFaqPath {
  Default = "40-knowledge-base/faq.md",
  Legacy = "40-knowledge-base/business-domains/card-system-faq.md"
}

export const PROJECTS_ROOT_PATH = "30-projects";

const FAQ_HEADING_PATTERN = /^##\s+(.+?)\s*$/;
const ANSWER_PATTERN = /^回答[：:]\s*(.*)$/;
const UPDATED_PATTERN = /^更新时间[：:]\s*(.*)$/;

export enum FaqCategory {
  Project = "project",
  // 保留历史内部值，公开界面使用通用 FAQ。
  General = "card-system"
}

export interface FaqEntry {
  category: FaqCategory;
  path: string;
  project: string | null;
  question: string;
  answer: string;
  updatedAt: string | null;
  line: number;
  endLine: number;
}

export interface FaqDraft {
  category: FaqCategory;
  project?: string;
  question: string;
  answer: string;
}

interface ParsedFaqEntry {
  question: string;
  startLine: number;
  lines: string[];
}

export class FaqRepository {
  constructor(private readonly app: App) {}

  async listProjects(): Promise<string[]> {
    if (!(await this.app.vault.adapter.exists(PROJECTS_ROOT_PATH))) {
      return [];
    }
    const entries = await this.app.vault.adapter.list(PROJECTS_ROOT_PATH);

    return entries.folders
      .map((path) => path.split("/").pop())
      .filter((name): name is string => Boolean(name))
      .sort((left, right) => left.localeCompare(right));
  }

  async listFaqEntries(): Promise<FaqEntry[]> {
    const faqPaths = await this.listFaqPaths();
    const entries: FaqEntry[] = [];

    for (const path of faqPaths) {
      const content = await this.app.vault.adapter.read(path);
      entries.push(...parseFaqEntries(path, content));
    }

    return entries.sort(compareFaqEntries);
  }

  async appendFaq(draft: FaqDraft): Promise<string> {
    const path = resolveFaqPath(draft);
    await this.ensureFaqFile(path, draft);
    const content = await this.app.vault.adapter.read(path);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const nextContent = appendBlock(content, renderFaqBlock(draft, newline), newline);
    await this.app.vault.adapter.write(path, nextContent);
    return path;
  }

  async updateFaq(entry: FaqEntry, draft: FaqDraft): Promise<string> {
    const path = draft.category === FaqCategory.General && isGeneralFaqPath(entry.path)
      ? entry.path
      : resolveFaqPath(draft);

    if (path !== entry.path) {
      throw new Error("Changing FAQ location is not supported.");
    }

    const content = await this.app.vault.adapter.read(entry.path);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const nextLines = replaceFaqBlock(lines, entry, renderFaqBlock(draft, newline));
    await this.app.vault.adapter.write(entry.path, nextLines.join(newline));
    return entry.path;
  }

  async deleteFaq(entry: FaqEntry): Promise<void> {
    const content = await this.app.vault.adapter.read(entry.path);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const nextLines = removeFaqBlock(lines, entry);
    await this.app.vault.adapter.write(entry.path, nextLines.join(newline).replace(/\s+$/g, "") + newline);
  }

  async openFaq(entry: FaqEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.path);

    if (!(file instanceof TFile)) {
      throw new Error(`FAQ file not found: ${entry.path}`);
    }

    await this.app.workspace.getLeaf(false).openFile(file, {
      active: true,
      eState: { line: Math.max(0, entry.line - 1) }
    });
  }

  private async listFaqPaths(): Promise<string[]> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const paths = markdownFiles
      .map((file) => file.path)
      .filter(isFaqPath);

    for (const path of Object.values(GeneralFaqPath)) {
      if (await this.app.vault.adapter.exists(path) && !paths.includes(path)) {
        paths.push(path);
      }
    }

    return paths.sort((left, right) => left.localeCompare(right));
  }

  private async ensureFaqFile(path: string, draft: FaqDraft): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) {
      return;
    }

    await ensureParentFolders(this.app, path);
    const title = draft.category === FaqCategory.General
      ? "通用 FAQ"
      : `${draft.project ?? "项目"} FAQ`;
    await this.app.vault.create(path, `# ${title}\n\n`);
  }
}

function parseFaqEntries(path: string, content: string): FaqEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: FaqEntry[] = [];
  let current: ParsedFaqEntry | null = null;

  lines.forEach((line, index) => {
    const heading = line.match(FAQ_HEADING_PATTERN);

    if (heading) {
      pushFaqEntry(entries, path, current);
      current = {
        question: heading[1].trim(),
        startLine: index + 1,
        lines: []
      };
      return;
    }

    if (current) {
      current.lines.push(line);
    }
  });

  pushFaqEntry(entries, path, current);
  return entries;
}

function pushFaqEntry(entries: FaqEntry[], path: string, current: ParsedFaqEntry | null): void {
  if (!current) {
    return;
  }

  const answer = findFirstMatch(current.lines, ANSWER_PATTERN) || "未填写回答";
  const updatedAt = findFirstMatch(current.lines, UPDATED_PATTERN) || null;
  entries.push({
    category: getFaqCategory(path),
    path,
    project: getProjectFromFaqPath(path),
    question: current.question,
    answer,
    updatedAt,
    line: current.startLine,
    endLine: current.startLine + current.lines.length
  });
}

function findFirstMatch(lines: string[], pattern: RegExp): string {
  for (const line of lines) {
    const match = line.trim().match(pattern);

    if (match) {
      return match[1].trim();
    }
  }

  return "";
}

function renderFaqBlock(draft: FaqDraft, newline: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `## ${draft.question.trim()}`,
    "",
    `回答：${draft.answer.trim()}`,
    "",
    `更新时间：${today}`,
    ""
  ].join(newline);
}

function appendBlock(content: string, block: string, newline: string): string {
  const trimmed = content.replace(/\s+$/g, "");
  return `${trimmed}${newline}${newline}${block}`;
}

function replaceFaqBlock(lines: string[], entry: FaqEntry, block: string): string[] {
  const startIndex = entry.line - 1;
  const endIndex = entry.endLine;
  const blockLines = block.replace(/\s+$/g, "").split(/\r?\n/);
  const nextLines = [...lines];
  nextLines.splice(startIndex, endIndex - startIndex, ...blockLines);
  return nextLines;
}

function removeFaqBlock(lines: string[], entry: FaqEntry): string[] {
  const startIndex = entry.line - 1;
  let endIndex = entry.endLine;

  while (endIndex < lines.length && lines[endIndex].trim() === "") {
    endIndex += 1;
  }

  const nextLines = [...lines];
  nextLines.splice(startIndex, endIndex - startIndex);
  return nextLines;
}

function resolveFaqPath(draft: FaqDraft): string {
  if (draft.category === FaqCategory.General) {
    return GeneralFaqPath.Default;
  }

  if (!draft.project) {
    throw new Error("Project FAQ requires a project.");
  }

  return normalizePath(`${PROJECTS_ROOT_PATH}/${draft.project}/faq.md`);
}

function isFaqPath(path: string): boolean {
  if (isGeneralFaqPath(path)) {
    return true;
  }

  return /^30-projects\/[^/]+\/faq\.md$/.test(path);
}

function getFaqCategory(path: string): FaqCategory {
  return isGeneralFaqPath(path) ? FaqCategory.General : FaqCategory.Project;
}

function isGeneralFaqPath(path: string): boolean {
  return path === GeneralFaqPath.Default || path === GeneralFaqPath.Legacy;
}

function getProjectFromFaqPath(path: string): string | null {
  const match = path.match(/^30-projects\/([^/]+)\/faq\.md$/);
  return match ? match[1] : null;
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;

    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

function compareFaqEntries(left: FaqEntry, right: FaqEntry): number {
  const updatedLeft = left.updatedAt ?? "";
  const updatedRight = right.updatedAt ?? "";

  if (updatedLeft !== updatedRight) {
    return updatedRight.localeCompare(updatedLeft);
  }

  return left.question.localeCompare(right.question);
}
