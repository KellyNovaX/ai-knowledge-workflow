import { App } from "obsidian";
import { getTaskStatusLabel } from "../constants";
import { TaskStatus } from "../types";
import { BoardTask, TaskBoard } from "./TaskBoard";

export enum TaskCompletionSection {
  Doing = "Doing",
  Todo = "Todo",
  PendingRelease = "Pending Release",
  Done = "Done"
}

const COMPLETABLE_STATUSES = [
  TaskStatus.Doing,
  TaskStatus.Todo,
  TaskStatus.PendingRelease
];

export interface CompletableTask {
  line: number;
  section: TaskCompletionSection.Doing | TaskCompletionSection.Todo | TaskCompletionSection.PendingRelease;
  text: string;
  rawLine: string;
  completedLine: string;
  boardTask: BoardTask;
}

export interface TaskCompletionPreview {
  task: CompletableTask;
  fromSection: TaskCompletionSection.Doing | TaskCompletionSection.Todo | TaskCompletionSection.PendingRelease;
  toSection: TaskCompletionSection.Done;
  originalLine: string;
  completedLine: string;
}

export class TaskCompleter {
  constructor(private readonly app: App) {}

  async listCompletableTasks(): Promise<CompletableTask[]> {
    const tasks = await new TaskBoard(this.app).listTasks();
    return tasks
      .filter((task) => !task.checked && COMPLETABLE_STATUSES.includes(task.status))
      .map(toCompletableTask);
  }

  createPreview(task: CompletableTask): TaskCompletionPreview {
    return {
      task,
      fromSection: task.section,
      toSection: TaskCompletionSection.Done,
      originalLine: task.rawLine,
      completedLine: task.completedLine
    };
  }

  async completeTask(task: CompletableTask): Promise<void> {
    await new TaskBoard(this.app).moveTask({
      task: task.boardTask,
      toStatus: TaskStatus.Done
    });
  }
}

function toCompletableTask(task: BoardTask): CompletableTask {
  return {
    line: task.line,
    section: getTaskStatusLabel(task.status) as CompletableTask["section"],
    text: task.text,
    rawLine: task.rawLine,
    completedLine: `- [x] ${task.hasExplicitPriority ? `[${task.priority}] ${task.text}` : task.rawBody}`,
    boardTask: task
  };
}
