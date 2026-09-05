import { App } from "obsidian";

const TASK_ID_GLOBAL_PATTERN = /\b(?:tid:|id:[pwg]-)(\d+)\b/g;

interface PluginData {
  lastTaskId?: unknown;
  [key: string]: unknown;
}

export class TaskIdStore {
  constructor(private readonly app: App) {}

  private get dataPath(): string {
    return `${this.app.vault.configDir}/plugins/ai-knowledge-workflow/data.json`;
  }

  async reserveTaskIds(boardContent: string, count: number): Promise<number> {
    if (count <= 0) {
      return Math.max(await this.readLastTaskId(), findMaxTaskId(boardContent)) + 1;
    }

    const data = await this.readPluginData();
    const firstTaskId = Math.max(readLastTaskId(data), findMaxTaskId(boardContent)) + 1;
    data.lastTaskId = firstTaskId + count - 1;
    await this.writePluginData(data);
    return firstTaskId;
  }

  async reserveNextTaskId(boardContent: string): Promise<number> {
    return this.reserveTaskIds(boardContent, 1);
  }

  private async readLastTaskId(): Promise<number> {
    return readLastTaskId(await this.readPluginData());
  }

  private async readPluginData(): Promise<PluginData> {
    if (!(await this.app.vault.adapter.exists(this.dataPath))) {
      return {};
    }

    try {
      const data = JSON.parse(await this.app.vault.adapter.read(this.dataPath));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  private async writePluginData(data: PluginData): Promise<void> {
    await this.app.vault.adapter.write(this.dataPath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function readLastTaskId(data: PluginData): number {
  return normalizeTaskId(data.lastTaskId);
}

function findMaxTaskId(content: string): number {
  let maxTaskId = 0;

  for (const match of content.matchAll(TASK_ID_GLOBAL_PATTERN)) {
    maxTaskId = Math.max(maxTaskId, normalizeTaskId(match[1]));
  }

  return maxTaskId;
}

function normalizeTaskId(value: unknown): number {
  const taskId = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : 0;
}
