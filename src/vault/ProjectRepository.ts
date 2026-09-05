import { App } from "obsidian";

export const PROJECTS_ROOT_PATH = "30-projects";

const SOURCE_PROJECT_ROW_PATTERN = /^\|\s*源码项目\s*\|\s*`([^`]+)`\s*\|/m;
const SOURCE_ROOT_ROW_PATTERN = /^\|\s*`([^`]+)`\s*\|\s*源码根目录\s*\|/m;

export interface ProjectCardEntry {
  name: string;
  path: string;
  linksPath: string;
  sourcePath: string | null;
}

export class ProjectRepository {
  constructor(private readonly app: App) {}

  async listProjects(): Promise<ProjectCardEntry[]> {
    const entries = await this.app.vault.adapter.list(PROJECTS_ROOT_PATH);

    const projects = await Promise.all(
      entries.folders.map(async (path) => {
        const name = path.split("/").pop() ?? path;
        const linksPath = `${path}/links.md`;
        const linksContent = await this.readIfExists(linksPath);

        return {
          name,
          path,
          linksPath,
          sourcePath: extractSourcePath(linksContent)
        };
      })
    );

    return projects.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async readIfExists(path: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(path))) {
      return "";
    }

    return this.app.vault.adapter.read(path);
  }
}

function extractSourcePath(content: string): string | null {
  const projectRow = content.match(SOURCE_PROJECT_ROW_PATTERN)?.[1]?.trim();
  const rootRow = content.match(SOURCE_ROOT_ROW_PATTERN)?.[1]?.trim();
  const sourcePath = (projectRow && projectRow !== "待填写") ? projectRow : (rootRow && rootRow !== "待填写") ? rootRow : null;

  if (!sourcePath) {
    return null;
  }

  return sourcePath.startsWith("/") ? sourcePath.replace(/\/+$/, "") : null;
}
