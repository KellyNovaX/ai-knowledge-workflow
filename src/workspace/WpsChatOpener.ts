import { spawn } from "child_process";
import { Platform } from "obsidian";

const WPS_COLLABORATION_APP_NAME = "xiezuo";
const WPS_COLLABORATION_APP_PATH = "/Applications/xiezuo.app";
const WPS_COLLABORATION_PROCESS_NAMES = ["WPS协作", "xiezuo"];
const SEARCH_FIELD_CLICK_OFFSETS = [
  [180, 70],
  [160, 70],
  [125, 58],
  [105, 58],
  [145, 58],
  [180, 58],
  [125, 92],
  [180, 92]
];

export interface WpsChatOpenRequest {
  label: string;
  url: string | null;
}

export interface WpsChatOpenResult {
  copiedSearchText: boolean;
  filledSearchText: boolean;
}

export async function openWpsChatTarget(request: WpsChatOpenRequest): Promise<WpsChatOpenResult> {
  if (!Platform.isMacOS) {
    throw new Error("WPS collaboration integration is available only on macOS.");
  }
  if (request.url) {
    await runOpenCommand(["-a", WPS_COLLABORATION_APP_NAME, request.url]);
    return { copiedSearchText: false, filledSearchText: false };
  }

  await navigator.clipboard.writeText(request.label);
  await runOpenCommand([WPS_COLLABORATION_APP_PATH]);
  const filledSearchText = await runAppleScript(buildFillSearchScript(request.label))
    .then(() => true)
    .catch((error) => {
      console.warn("AI Knowledge: WPS search fill automation failed", error);
      return false;
    });
  return { copiedSearchText: true, filledSearchText };
}

function runOpenCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("open", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `open exited with code ${code ?? "unknown"}.`));
    });
  });
}

function runAppleScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `osascript exited with code ${code ?? "unknown"}.`));
    });
  });
}

function buildFillSearchScript(searchText: string): string {
  const processList = WPS_COLLABORATION_PROCESS_NAMES
    .map((name) => quoteAppleScriptString(name))
    .join(", ");
  const searchFieldClickOffsets = SEARCH_FIELD_CLICK_OFFSETS
    .map(([x, y]) => `{${x}, ${y}}`)
    .join(", ");

  return `
set processNames to {${processList}}
set searchFieldClickOffsets to {${searchFieldClickOffsets}}
set searchText to ${quoteAppleScriptString(searchText)}
set the clipboard to searchText
tell application "System Events"
  repeat with processName in processNames
    if exists process (processName as text) then
      tell process (processName as text)
        set frontmost to true
        repeat 30 times
          if (count of windows) > 0 then exit repeat
          delay 0.2
        end repeat
        if (count of windows) is 0 then error "WPS window was not ready."

        set windowPosition to position of window 1
        set searchField to my findWpsSearchField(window 1)
        if searchField is not missing value then
          my pasteIntoWpsSearchField(searchField)
          return
        end if

        -- WPS has no stable accessibility identifier for the search box, so retry likely top-bar positions.
        repeat with clickOffset in searchFieldClickOffsets
          click at {(item 1 of windowPosition) + (item 1 of clickOffset), (item 2 of windowPosition) + (item 2 of clickOffset)}
          delay 0.2
          try
            set focusedElement to value of attribute "AXFocusedUIElement"
            set focusedRole to role of focusedElement
            if focusedRole is "AXTextField" then
              set focusedPosition to position of focusedElement
              set focusedSize to size of focusedElement
              set focusedMidY to (item 2 of focusedPosition) + ((item 2 of focusedSize) / 2)
              if focusedMidY < ((item 2 of windowPosition) + ((item 2 of windowSize) / 2)) then
                keystroke "a" using command down
                delay 0.05
                keystroke "v" using command down
                return
              end if
            end if
          end try
        end repeat
        error "WPS search field was not focused."
      end tell
      return
    end if
  end repeat
end tell

on pasteIntoWpsSearchField(searchField)
  tell application "System Events"
    tell searchField
      set fieldPosition to position
      set fieldSize to size
    end tell
    click at {(item 1 of fieldPosition) + ((item 1 of fieldSize) / 2), (item 2 of fieldPosition) + ((item 2 of fieldSize) / 2)}
    delay 0.1
    keystroke "a" using command down
    delay 0.05
    keystroke "v" using command down
  end tell
end pasteIntoWpsSearchField

on findWpsSearchField(rootElement)
  tell application "System Events"
    try
      set elementRole to role of rootElement
      if elementRole is "AXTextField" then
        return rootElement
      end if
    end try

    try
      repeat with childElement in UI elements of rootElement
        set matchedElement to my findWpsSearchField(childElement)
        if matchedElement is not missing value then return matchedElement
      end repeat
    end try
  end tell

  return missing value
end findWpsSearchField
`.trim();
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
