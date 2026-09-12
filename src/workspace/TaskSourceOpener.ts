import { Platform } from "obsidian";
import { TaskSourceApp } from "../types";
import { BoardTaskWpsTarget } from "../vault/TaskBoard";
import { openExternalUri } from "./ExternalAppOpener";
import { openWpsChatTarget } from "./WpsChatOpener";

export enum TaskSourceOpenMode {
  Direct = "direct",
  Search = "search",
  SearchWithCopiedText = "search-with-copied-text",
  CopiedSearchText = "copied-search-text",
  FilledSearchText = "filled-search-text"
}

export function canOpenTaskSource(sourceApp: TaskSourceApp): boolean {
  return Platform.isDesktopApp && (sourceApp === TaskSourceApp.Feishu || Platform.isMacOS);
}

export async function openTaskSource(
  sourceApp: TaskSourceApp,
  target: BoardTaskWpsTarget
): Promise<TaskSourceOpenMode> {
  if (!canOpenTaskSource(sourceApp)) {
    throw new Error("当前平台不支持打开此来源应用。");
  }

  // 切换应用后，其他平台的旧链接改用名称搜索，保留原始来源信息。
  const url = target.url && matchesSourceApp(target.url, sourceApp) ? target.url : null;
  if (sourceApp === TaskSourceApp.Wps) {
    const result = await openWpsChatTarget({ ...target, url });
    return result.filledSearchText
      ? TaskSourceOpenMode.FilledSearchText
      : result.copiedSearchText ? TaskSourceOpenMode.CopiedSearchText : TaskSourceOpenMode.Direct;
  }

  if (url) {
    await openExternalUri(url);
    return TaskSourceOpenMode.Direct;
  }

  const label = target.label.trim();
  if (!label) {
    throw new Error("请先填写来源名称。");
  }
  const copied = await navigator.clipboard.writeText(label).then(() => true, () => false);
  await openExternalUri(`feishu://applink.feishu.cn/client/search/open?query=${encodeURIComponent(label)}`);
  return copied ? TaskSourceOpenMode.SearchWithCopiedText : TaskSourceOpenMode.Search;
}

function matchesSourceApp(value: string, sourceApp: TaskSourceApp): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const isFeishu = url.protocol === "feishu:" || url.protocol === "lark:"
    || ["feishu.cn", "larksuite.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (sourceApp === TaskSourceApp.Feishu) {
    return isFeishu && ["https:", "http:", "feishu:", "lark:"].includes(url.protocol);
  }
  return !isFeishu && ["https:", "http:", "wps:", "kdocs:", "xiezuo:"].includes(url.protocol);
}
