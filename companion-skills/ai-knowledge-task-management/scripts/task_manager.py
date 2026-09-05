#!/usr/bin/env python3
"""Manage active and archived tasks in an AI Knowledge Vault."""

from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from urllib.parse import quote, unquote


class TaskStatus(Enum):
    DOING = ("doing", "Doing")
    TODO = ("todo", "Todo")
    PENDING_RELEASE = ("pending_release", "Pending Release")
    WAITING = ("waiting", "Waiting")
    BACKLOG = ("backlog", "Backlog")
    DONE = ("done", "Done")

    @property
    def value_text(self) -> str:
        return self.value[0]

    @property
    def section(self) -> str:
        return self.value[1]

    @classmethod
    def parse(cls, raw: str) -> "TaskStatus":
        normalized = raw.strip().lower().replace("_", "-")
        aliases = {"pending": "pending-release", "release": "pending-release"}
        normalized = aliases.get(normalized, normalized)
        for item in cls:
            if normalized in {item.value_text.replace("_", "-"), item.section.lower().replace(" ", "-")}:
                return item
        allowed = ", ".join(item.value_text for item in cls)
        raise SystemExit(f"Unknown status: {raw}. Allowed: {allowed}")


class TaskType(Enum):
    GENERAL = ("general", "g")
    PROJECT = ("project", "p")
    WORKFLOW = ("workflow", "w")

    @property
    def value_text(self) -> str:
        return self.value[0]

    @property
    def prefix(self) -> str:
        return self.value[1]

    @classmethod
    def parse(cls, raw: str) -> "TaskType":
        normalized = raw.strip().lower()
        for item in cls:
            if normalized == item.value_text:
                return item
        allowed = ", ".join(item.value_text for item in cls)
        raise SystemExit(f"Unknown type: {raw}. Allowed: {allowed}")


class TaskStorage(Enum):
    BOARD = "board"
    ARCHIVE = "archive"


class TaskLinkKind(Enum):
    MARKDOWN = "markdown"
    WIKI = "wiki"


@dataclass
class BoardTask:
    task_id: str
    status: TaskStatus
    title: str
    block: str
    checked: bool
    link: str | None
    storage: TaskStorage
    link_kind: TaskLinkKind = TaskLinkKind.MARKDOWN


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str, dry_run: bool) -> None:
    if dry_run:
        if path.exists():
            old = read_text(path)
        else:
            old = ""
        print_diff(path, old, text)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(text)
            temporary.flush()
            os.fsync(temporary.fileno())
        temporary_path.chmod(mode)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def write_task_files(changes: dict[Path, str], dry_run: bool) -> None:
    originals = {path: read_text(path) if path.exists() else None for path in changes}
    changed = {path: content for path, content in changes.items() if content != originals[path]}
    if dry_run:
        for path, content in changed.items():
            print_diff(path, originals[path] or "", content)
        return
    attempted: list[Path] = []
    try:
        for path, content in changed.items():
            attempted.append(path)
            atomic_write_text(path, content)
    except OSError as error:
        rollback_errors: list[str] = []
        for path in reversed(attempted):
            try:
                original = originals[path]
                if original is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write_text(path, original)
            except OSError as rollback_error:
                rollback_errors.append(f"{path}: {rollback_error}")
        detail = "Rollback incomplete: " + "; ".join(rollback_errors) if rollback_errors else "All changed files restored"
        raise SystemExit(f"Task update failed: {error}. {detail}") from error


def print_diff(path: Path, old: str, new: str) -> None:
    diff = difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f"{path} (before)",
        tofile=f"{path} (after)",
    )
    print("".join(diff), end="")


def board_path(vault: Path) -> Path:
    return vault / "10-tasks" / "board.md"


def done_path(vault: Path) -> Path:
    return vault / "10-tasks" / "done.md"


def discover_vault() -> Path:
    starts = [Path.cwd(), Path(__file__).resolve().parent]
    seen: set[Path] = set()
    for start in starts:
        for candidate in [start, *start.parents]:
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if board_path(resolved).exists():
                return resolved
    return Path.cwd().resolve()


def slugify(title: str) -> str:
    text = title.strip().lower()
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:80] or "task"


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def completion_time_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def current_year_month() -> tuple[str, str]:
    now = datetime.now()
    return now.strftime("%Y"), now.strftime("%m")


def split_board_sections(text: str) -> tuple[str, dict[str, str], list[str]]:
    matches = list(re.finditer(r"^## (.+?)\s*$", text, flags=re.MULTILINE))
    if not matches:
        raise SystemExit("No board sections found")
    prefix = text[: matches[0].start()]
    sections: dict[str, str] = {}
    order: list[str] = []
    for index, match in enumerate(matches):
        name = match.group(1).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[name] = text[start:end]
        order.append(name)
    return prefix, sections, order


def join_board_sections(prefix: str, sections: dict[str, str], order: list[str]) -> str:
    output = [prefix.rstrip(), ""]
    for name in order:
        body = sections.get(name, "")
        output.append(f"## {name}")
        output.append(body.strip("\n"))
    return "\n".join(output).rstrip() + "\n"


def replace_section(text: str, section: str, new_body: str) -> str:
    pattern = re.compile(rf"^## {re.escape(section)}\s*$", flags=re.MULTILINE)
    match = pattern.search(text)
    if not match:
        raise SystemExit(f"Board section not found: {section}")
    next_match = re.search(r"^## .+?\s*$", text[match.end() :], flags=re.MULTILINE)
    end = match.end() + next_match.start() if next_match else len(text)
    return text[: match.end()] + new_body + text[end:]


def remove_task_block(section_body: str, block: str) -> str:
    updated = section_body.replace(block, "", 1)
    return re.sub(r"\n{4,}", "\n\n\n", updated)


def append_task_block(section_body: str, block: str) -> str:
    if section_body.strip():
        if section_body.endswith("\n\n"):
            return section_body + block + "\n"
        if section_body.endswith("\n"):
            return section_body + "\n" + block + "\n"
        return section_body + "\n\n" + block + "\n"
    separator = "" if section_body.endswith("\n") else "\n"
    return section_body + separator + block + "\n"


def parse_board_tasks(text: str) -> list[BoardTask]:
    _, sections, _ = split_board_sections(text)
    tasks: list[BoardTask] = []
    for section_name, body in sections.items():
        try:
            status = next(item for item in TaskStatus if item.section == section_name)
        except StopIteration:
            continue
        tasks.extend(parse_task_blocks(body, status, TaskStorage.BOARD))
    return tasks


def parse_done_tasks(text: str) -> list[BoardTask]:
    return parse_task_blocks(text, TaskStatus.DONE, TaskStorage.ARCHIVE)


def parse_task_blocks(text: str, status: TaskStatus, storage: TaskStorage) -> list[BoardTask]:
    tasks: list[BoardTask] = []
    starts = list(re.finditer(r"(?m)^- \[( |x|X)\] .*$", text))
    for index, start_match in enumerate(starts):
        start = start_match.start()
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        if storage == TaskStorage.ARCHIVE:
            heading = re.search(r"(?m)^## .+?\s*$", text[start_match.end():end])
            if heading:
                end = start_match.end() + heading.start()
        block = text[start:end].rstrip()
        first_line = start_match.group(0)
        id_match = re.search(r"\bid:([gpw]-\d+)\b", block)
        if not id_match:
            continue
        wiki_link = re.search(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", first_line)
        markdown_link = re.search(r"\[[^\]]+\]\(([^)]+)\)", first_line)
        link = wiki_link.group(1) if wiki_link else markdown_link.group(1) if markdown_link else None
        title = re.sub(r"^- \[[ xX]\]\s*", "", first_line).strip()
        title = re.sub(r"\s*(?:\[\[.*|\[[^\]]+\]\([^)]*\)).*$", "", title).strip()
        title = re.sub(r"\s+#task/\w+.*$", "", title).strip()
        tasks.append(
            BoardTask(
                task_id=id_match.group(1),
                status=status,
                title=title,
                block=block,
                checked=start_match.group(1).lower() == "x",
                link=link,
                storage=storage,
                link_kind=TaskLinkKind.WIKI if wiki_link else TaskLinkKind.MARKDOWN,
            )
        )
    return tasks


def read_all_tasks(vault: Path) -> list[BoardTask]:
    tasks = parse_board_tasks(read_text(board_path(vault)))
    archive = done_path(vault)
    if archive.exists():
        tasks.extend(parse_done_tasks(read_text(archive)))
    return tasks


def find_task(vault: Path, task_id: str) -> BoardTask:
    for task in read_all_tasks(vault):
        if task.task_id == task_id:
            return task
    raise SystemExit(f"Task not found: {task_id}")


def replace_frontmatter_value(content: str, key: str, value: str) -> str:
    if not content.startswith("---\n"):
        return content
    end = content.find("\n---", 4)
    if end == -1:
        return content
    frontmatter = content[:end]
    rest = content[end:]
    pattern = re.compile(rf"^{re.escape(key)}:[ \t]*.*$", re.MULTILINE)
    line = f"{key}: {value}"
    if pattern.search(frontmatter):
        frontmatter = pattern.sub(line, frontmatter, count=1)
    else:
        frontmatter += "\n" + line
    return frontmatter + rest


def frontmatter_fields(content: str) -> dict[str, str]:
    frontmatter = re.match(r"\A---\n(.*?)\n---(?:\n|$)", content, re.DOTALL)
    if not frontmatter:
        raise ValueError("Task entry requires frontmatter")
    return {
        field.group(1): field.group(2).strip().strip('"\'')
        for line in frontmatter.group(1).splitlines()
        if (field := re.match(r"^([\w-]+):[ \t]*(.*)$", line))
    }


def remove_frontmatter_value(content: str, key: str) -> str:
    end = content.find("\n---", 4)
    if not content.startswith("---\n") or end == -1:
        raise ValueError("Task entry requires frontmatter")
    frontmatter = re.sub(rf"(?m)^{re.escape(key)}:[^\n]*(?:\n|$)", "", content[:end])
    return frontmatter.rstrip("\n") + content[end:]


def resolve_task_entry(vault: Path, task: BoardTask) -> tuple[Path, str, dict[str, str]]:
    source = board_path(vault) if task.storage == TaskStorage.BOARD else done_path(vault)
    candidates = task_entry_candidates(vault, task.link or "", task.link_kind, source)
    path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if path is None:
        raise SystemExit(f"Task {task.task_id}: entry link cannot be resolved: {task.link!r}; no files changed")
    content = read_text(path)
    try:
        fields = frontmatter_fields(content)
    except ValueError as error:
        raise SystemExit(f"Task {task.task_id}: {error}: {path}; no files changed") from error
    if fields.get("id") != task.task_id:
        raise SystemExit(f"Task {task.task_id}: entry id mismatch at {path}; no files changed")
    TaskStatus.parse(fields.get("status", ""))
    return path, content, fields


def prepare_entry_status(task: BoardTask, content: str, fields: dict[str, str], status: TaskStatus) -> str:
    updated = replace_frontmatter_value(content, "status", status.value_text)
    if status == TaskStatus.DONE:
        # 历史已完成任务缺少日期时保持未知，避免重复完成时伪造完成时间。
        if task.status != TaskStatus.DONE and TaskStatus.parse(fields["status"]) != TaskStatus.DONE:
            updated = replace_frontmatter_value(updated, "completed_at", f'"{completion_time_text()}"')
    else:
        updated = remove_frontmatter_value(updated, "completed_at")
    return updated


def task_entry_candidates(vault: Path, link: str, link_kind: TaskLinkKind = TaskLinkKind.MARKDOWN, source_path: Path | None = None) -> list[Path]:
    raw = link.strip().strip("<>").split("#", 1)[0]
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        return []
    if not raw:
        return []
    raw = unquote(raw)
    base = vault if link_kind == TaskLinkKind.WIKI else (source_path or board_path(vault)).parent
    target = (base / raw).resolve()
    if target.suffix == ".md":
        return [target]
    return [Path(f"{target}.md"), target / "index.md", target / "AGENTS.md"]


def move_task(vault: Path, task_id: str, status: TaskStatus, dry_run: bool) -> None:
    board = board_path(vault)
    archive = done_path(vault)
    board_text = read_text(board)
    archive_text = read_text(archive) if archive.exists() else "# Tasks Done\n\n归档已完成事项，保留必要链接。\n"
    task = find_task(vault, task_id)
    entry_path, entry_content, fields = resolve_task_entry(vault, task)
    next_entry = prepare_entry_status(task, entry_content, fields, status)
    block = task.block
    block = re.sub(r"^- \[[ xX]\]", "- [x]" if status == TaskStatus.DONE else "- [ ]", block, count=1)
    changes: dict[Path, str] = {}

    if task.storage == TaskStorage.BOARD:
        _, sections, _ = split_board_sections(board_text)
        source_body = sections[task.status.section]
        next_board = replace_section(
            board_text,
            task.status.section,
            remove_task_block(source_body, task.block),
        )
        if status == TaskStatus.DONE:
            next_archive = append_done_archive(archive_text, block)
            changes[archive] = next_archive
        else:
            _, next_sections, _ = split_board_sections(next_board)
            target_body = append_task_block(next_sections.get(status.section, ""), block)
            next_board = replace_section(next_board, status.section, target_body)
        changes[board] = next_board
    else:
        if status == TaskStatus.DONE:
            next_archive = archive_text.replace(task.block, block, 1)
            changes[archive] = normalize_archive_spacing(next_archive)
        else:
            next_archive = normalize_archive_spacing(archive_text.replace(task.block, "", 1))
            _, sections, _ = split_board_sections(board_text)
            target_body = append_task_block(sections.get(status.section, ""), block)
            next_board = replace_section(board_text, status.section, target_body)
            changes[archive] = next_archive
            changes[board] = next_board

    if next_entry != entry_content:
        changes[entry_path] = next_entry
    write_task_files(changes, dry_run)


def append_done_archive(text: str, block: str) -> str:
    year_heading = f"## {datetime.now().year}"
    normalized = text.rstrip()
    heading_match = re.search(rf"(?m)^{re.escape(year_heading)}\s*$", normalized)
    if not heading_match:
        return f"{normalized}\n\n{year_heading}\n\n{block}\n"

    next_heading = re.search(r"(?m)^## .+?\s*$", normalized[heading_match.end():])
    insert_at = heading_match.end() + next_heading.start() if next_heading else len(normalized)
    before = normalized[:insert_at].rstrip()
    after = normalized[insert_at:].lstrip()
    return f"{before}\n\n{block}\n" + (f"\n{after}\n" if after else "")


def normalize_archive_spacing(text: str) -> str:
    without_empty_years = re.sub(
        r"(?ms)^## \d{4}\s*\n(?=\s*(?:## |\Z))",
        "",
        text,
    )
    return re.sub(r"\n{4,}", "\n\n\n", without_empty_years).rstrip() + "\n"


def scan_next_id(vault: Path, task_type: TaskType) -> str:
    pattern = re.compile(rf"\b{task_type.prefix}-(\d+)\b")
    max_id = 0
    for path in [board_path(vault), done_path(vault), *vault.glob("10-tasks/items/**/*.md"), *vault.glob("20-workflows/**/AGENTS.md"), *vault.glob("30-projects/*/inputs/**/*.md")]:
        if not path.exists() or not path.is_file():
            continue
        for match in pattern.finditer(read_text(path)):
            max_id = max(max_id, int(match.group(1)))
    return f"{task_type.prefix}-{max_id + 1}"


def yaml_string(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_.:/ -]+", value):
        return value
    return '"' + value.replace('"', '\\"') + '"'


def note_block(notes: list[str]) -> str:
    if not notes:
        return ""
    lines = ["  > [!note] 说明"]
    for note in notes:
        for line in note.splitlines():
            lines.append(f"  > - {line.strip()}" if line.strip() else "  > -")
    return "\n" + "\n".join(lines)


def make_board_line(task_id: str, task_type: TaskType, title: str, status: TaskStatus, link: str, due: str | None, source: str | None, created: str, notes: list[str]) -> str:
    checked = "x" if status == TaskStatus.DONE else " "
    parts = [f"- [{checked}] {title} [任务入口]({format_board_link(link)})"]
    if due:
        parts.append(f"due:{due}")
    if source:
        parts.append(source)
    parts.extend([f"#task/{task_type.value_text}", f"id:{task_id}", f"created:{created}"])
    return " ".join(parts) + note_block(notes)


def format_board_link(link: str) -> str:
    target = link if link.endswith(".md") else f"{link}.md"
    if target.startswith("10-tasks/"):
        target = target.removeprefix("10-tasks/")
    else:
        target = f"../{target}"
    return quote(target, safe="/")


def create_entry(vault: Path, task_id: str, task_type: TaskType, title: str, status: TaskStatus, projects: list[str], due: str | None, source: str | None, notes: list[str]) -> tuple[Path, str]:
    year, month = current_year_month()
    slug = slugify(title)
    created = now_text()
    if task_type == TaskType.GENERAL:
        rel = Path("10-tasks") / "items" / year / month / f"{task_id}-{slug}.md"
        link = str(rel.with_suffix(""))
        body = general_entry(task_id, title, status, created, due, source, notes)
    elif task_type == TaskType.PROJECT:
        if len(projects) != 1:
            raise SystemExit("Project task requires exactly one --project")
        rel = Path("30-projects") / projects[0] / "inputs" / year / month / f"{task_id}-{slug}" / "AGENTS.md"
        link = str(rel.with_suffix(""))
        body = project_entry(task_id, title, status, projects[0], created, due, notes, vault / rel, vault)
    else:
        rel = Path("20-workflows") / f"{task_id}-{slug}" / "AGENTS.md"
        link = str(rel.with_suffix(""))
        body = workflow_entry(task_id, title, status, projects, created, due, notes)
    return vault / rel, body


def create_support_files(entry_path: Path, task_type: TaskType, dry_run: bool) -> None:
    folder = entry_path.parent
    if task_type == TaskType.GENERAL:
        return
    files = {
        "overview.md": "# Overview\n\n## 背景\n\n- 待补充\n\n## 目标\n\n- 待补充\n",
        "execution.md": "# Execution\n\n## 执行记录\n\n- 待补充\n",
    }
    if task_type == TaskType.PROJECT:
        files["release-prep.md"] = "# Release Preparation\n\n- [ ] 目标分支已确认\n- [ ] 验证与回滚方案已确认\n"
    if task_type == TaskType.WORKFLOW:
        files["todo.md"] = "# Todo\n\n- [ ] 待补充\n"
        files["risk.md"] = "# Risks\n\n- 待补充\n"
        files["inputs/.gitkeep"] = ""
    for relative_path, content in files.items():
        path = folder / relative_path
        if not path.exists():
            write_text(path, content, dry_run)


def general_entry(task_id: str, title: str, status: TaskStatus, created: str, due: str | None, source: str | None, notes: list[str]) -> str:
    due_line = f"due: {due}\n" if due else ""
    source_line = f"source: {yaml_string(source)}\n" if source else ""
    task_notes = "\n".join(f"- {line}" for note in notes for line in note.splitlines() if line.strip()) or "- 待补充"
    return f"""---
id: {task_id}
type: general
status: {status.value_text}
title: {yaml_string(title)}
created: "{created}"
{due_line}{source_line}entry_type: general_task
---

# {title}

## AI 上下文根

本任务文件是通用待办上下文根；通用待办不默认进入源码开发。

## 任务说明

{task_notes}

## 执行结果

- 完成情况：
- 后续待办：
"""


def project_entry(task_id: str, title: str, status: TaskStatus, project: str, created: str, due: str | None, notes: list[str], entry_path: Path, vault: Path) -> str:
    due_line = f"due: {due}\n" if due else ""
    task_notes = "\n".join(f"- {line}" for note in notes for line in note.splitlines() if line.strip()) or "- 待补充"
    return f"""---
id: {task_id}
type: project
status: {status.value_text}
project: {project}
title: {yaml_string(title)}
created: "{created}"
{due_line}entry_type: project_input
---

# {title}

- 关联项目：[项目入口](../../../../index.md)
- 目标开发分支：待填写
- 创建时间：{created}

## AI 上下文根

本任务目录是 AI 开发上下文根；源码仓库不是本目录，必须从“源码定位”或关联项目 `links.md` 进入。

## 源码定位

- 源码仓库：待从关联项目 `links.md` 读取
- 目标模块：待填写
- 预计修改范围：待填写

## 最小必读资料

1. 本任务入口：`{entry_path}`。
2. 关联项目入口：`{vault}/30-projects/{project}/AGENTS.md`。
3. 关联项目链接：`{vault}/30-projects/{project}/links.md`。
4. 只读取与本任务直接相关的源码文件。

## 禁止读取

- 不递归扫描整个 vault。
- 不读取无关 workflow。
- 不读取无关项目 inputs。
- 不读取当前任务未引用的个人笔记或其他无关资料。

## AI 进入顺序

1. 读取本任务入口。
2. 如需开发，读取关联项目入口和项目链接。
3. 目标开发分支为 `待填写` 或为空时，先让用户补充，不要自行开发。

## 任务说明

{task_notes}

## 已确认事实

- 待补充

## 待确认问题

- 待补充

## 执行结果

- 修改文件：
- 验证方式：
- 风险：
- 后续待办：
"""


def workflow_entry(task_id: str, title: str, status: TaskStatus, projects: list[str], created: str, due: str | None, notes: list[str]) -> str:
    project_lines = "".join(f"  - {project}\n" for project in projects)
    project_block = f"project:\n{project_lines}" if projects else "project: []\n"
    due_line = f"due: {due}\n" if due else ""
    task_notes = "\n".join(f"- {line}" for note in notes for line in note.splitlines() if line.strip()) or "- 待补充"
    related = "、".join(
        f"[{project} AGENTS](../../30-projects/{project}/AGENTS.md)、[{project} links](../../30-projects/{project}/links.md)"
        for project in projects
    ) or "待补充"
    return f"""---
id: {task_id}
type: workflow
status: {status.value_text}
{project_block}title: {yaml_string(title)}
created: "{created}"
{due_line}entry_type: workflow
---

# {title}

## 当前任务
- 目标：{title}。
- 执行记录：[execution](execution.md)
- 需求与确认：[overview](overview.md)
- 待办：[todo](todo.md)
- 风险：[risk](risk.md)
- 规则：[任务路由](../../rules/task-routing.md)、[workflow](../../rules/workflow-policy.md)、[写回](../../rules/writeback.md)、[环境安全](../../rules/env-safety.md)

## 路由
- 上下文根：本目录，非源码仓库。
- 按需读取：`overview.md` 看需求和确认项；`todo.md` 看待办；`risk.md` 看风险；需要项目稳定知识时读关联项目入口；需要开发时再读相关源码。
- 源码仓库：待从关联项目 `links.md` 读取
- 目标分支：待填写
- 关联项目：{related}

## 任务说明

{task_notes}

## 门槛
- 继续开发前确认源码仓库当前分支。
- 目标开发分支为 `待填写` 或为空时，先让用户补充，不要自行开发。
"""


def create_task(args: argparse.Namespace) -> None:
    vault = args.vault
    task_type = TaskType.parse(args.type)
    status = TaskStatus.parse(args.status)
    if status == TaskStatus.DONE:
        raise SystemExit("New tasks cannot be created directly in done status")
    task_id = args.id or scan_next_id(vault, task_type)
    entry_path, entry_text = create_entry(vault, task_id, task_type, args.title, status, args.project, args.due, args.source, args.note)
    created_match = re.search(r'created: "?([^"\n]+)"?', entry_text)
    created = created_match.group(1) if created_match else now_text()
    link = str(entry_path.relative_to(vault).with_suffix(""))
    line = make_board_line(task_id, task_type, args.title, status, link, args.due, args.source, created, args.note)
    path = board_path(vault)
    text = read_text(path)
    _, sections, _ = split_board_sections(text)
    body = sections.get(status.section, "")
    updated = replace_section(text, status.section, append_task_block(body, line))
    write_text(path, updated, args.dry_run)
    write_text(entry_path, entry_text, args.dry_run)
    create_support_files(entry_path, task_type, args.dry_run)
    print(f"{'Would create' if args.dry_run else 'Created'} {task_id}: {entry_path}")


def list_tasks(args: argparse.Namespace) -> None:
    status = TaskStatus.parse(args.status) if args.status else None
    for task in read_all_tasks(args.vault):
        if status and task.status != status:
            continue
        print(f"{task.task_id}\t{task.status.value_text}\t{task.title}\t{task.link or ''}")


def find_tasks(args: argparse.Namespace) -> None:
    query = args.query.lower()
    for task in read_all_tasks(args.vault):
        haystack = f"{task.task_id} {task.title} {task.block}".lower()
        if query in haystack:
            print(f"{task.task_id}\t{task.status.value_text}\t{task.title}\t{task.link or ''}")


def update_task(args: argparse.Namespace) -> None:
    task = find_task(args.vault, args.task_id)
    entry, entry_content, _ = resolve_task_entry(args.vault, task)
    next_entry = entry_content
    for key, value in (("title", args.title), ("due", args.due), ("created", args.created), ("source", args.source)):
        if value:
            next_entry = replace_frontmatter_value(next_entry, key, yaml_string(value))
    path = board_path(args.vault) if task.storage == TaskStorage.BOARD else done_path(args.vault)
    text = read_text(path)
    block = task.block
    if args.title:
        block = re.sub(rf"(- \[[ xX]\]\s*){re.escape(task.title)}", rf"\1{args.title}", block, count=1)
    for key, value in (("due", args.due), ("created", args.created), ("id", None)):
        if value:
            if re.search(rf"\b{key}:[^\s]+", block):
                block = re.sub(rf"\b{key}:[^\s]+", f"{key}:{value}", block, count=1)
            else:
                block = block.split("\n", 1)[0] + f" {key}:{value}" + ("\n" + block.split("\n", 1)[1] if "\n" in block else "")
    if args.source:
        first, *rest = block.splitlines()
        if "wps:" in first:
            first = re.sub(r"wps:[^\s]+", args.source, first, count=1)
        else:
            first += f" {args.source}"
        block = "\n".join([first, *rest])
    updated = text.replace(task.block, block)
    write_task_files({path: updated, entry: next_entry}, args.dry_run)


def outside_fenced_code(content: str) -> str:
    lines: list[str] = []
    fence: str | None = None
    for line in content.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if marker:
            if fence is None:
                fence = marker.group(1)
                continue
            if marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence) and not marker.group(2).strip():
                fence = None
                continue
        if fence is None:
            lines.append(line)
    return "".join(lines)


def check_tasks(args: argparse.Namespace) -> None:
    """只读核查入口、状态和完成日期；历史缺失日期只报告，不推断。"""
    tasks = read_all_tasks(args.vault)
    seen: set[str] = set()
    errors: list[str] = []
    warnings: list[str] = []
    undated_done: list[str] = []
    for task in tasks:
        if task.task_id in seen:
            errors.append(f"{task.task_id}: duplicate task id")
        seen.add(task.task_id)
        try:
            path, content, fields = resolve_task_entry(args.vault, task)
        except SystemExit as error:
            errors.append(str(error))
            continue
        for key in ("id", "type", "status", "title", "created"):
            if not fields.get(key):
                errors.append(f"{task.task_id}: missing {key} in {path}")
        entry_status = TaskStatus.parse(fields["status"])
        if entry_status != task.status:
            errors.append(f"{task.task_id}: entry status {entry_status.value_text} differs from board/archive {task.status.value_text}")
        if fields["status"] != entry_status.value_text:
            warnings.append(f"{task.task_id}: noncanonical status {fields['status']!r}; use {entry_status.value_text}")
        if task.checked != (task.status == TaskStatus.DONE):
            errors.append(f"{task.task_id}: checkbox disagrees with task section")
        completed_at = fields.get("completed_at")
        if completed_at:
            try:
                completed = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                if completed.tzinfo is None:
                    warnings.append(f"{task.task_id}: completed_at has no timezone offset")
            except ValueError:
                errors.append(f"{task.task_id}: invalid completed_at {completed_at!r}")
            if entry_status != TaskStatus.DONE:
                errors.append(f"{task.task_id}: active task retains completed_at")
        elif entry_status == TaskStatus.DONE:
            undated_done.append(task.task_id)
        body = outside_fenced_code(content.split("\n---", 1)[1])
        if re.search(r"(?mi)^- 状态：[ \t]*(?:todo|doing|waiting|pending[ _-]release|done|backlog)[。.]?[ \t]*$", body):
            warnings.append(f"{task.task_id}: redundant manual status in entry body")
        if task.link_kind == TaskLinkKind.WIKI:
            warnings.append(f"{task.task_id}: legacy Wiki link; use relative Markdown")
    for message in errors:
        print(f"ERROR {message}")
    for message in warnings:
        print(f"WARN {message}")
    if undated_done:
        print(f"WARN {len(undated_done)} completed tasks have no recorded completion date; preserve unknown historical dates ({', '.join(undated_done[:5])}, ...)")
    print(f"Checked {len(tasks)} tasks: {len(errors)} errors, {len(warnings)} maintenance warnings, {len(undated_done)} undated completed tasks")
    if errors:
        raise SystemExit(1)


def delete_task(args: argparse.Namespace) -> None:
    task = find_task(args.vault, args.task_id)
    path = board_path(args.vault) if task.storage == TaskStorage.BOARD else done_path(args.vault)
    text = read_text(path)
    if task.storage == TaskStorage.BOARD:
        _, sections, _ = split_board_sections(text)
        updated_body = remove_task_block(sections[task.status.section], task.block)
        updated = replace_section(text, task.status.section, updated_body)
    else:
        updated = normalize_archive_spacing(text.replace(task.block, "", 1))
    write_text(path, updated, args.dry_run)
    print(f"{'Would remove' if args.dry_run else 'Removed'} {args.task_id} from {task.storage.value}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=discover_vault(), help="AI knowledge vault root")
    parser.add_argument("--dry-run", action="store_true", help="Print diffs without writing")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create a task and board entry")
    create.add_argument("--type", required=True, choices=[item.value_text for item in TaskType])
    create.add_argument("--title", required=True)
    create.add_argument("--status", default=TaskStatus.TODO.value_text)
    create.add_argument("--project", action="append", default=[])
    create.add_argument("--due")
    create.add_argument("--source")
    create.add_argument("--note", action="append", default=[])
    create.add_argument("--id")
    create.set_defaults(func=create_task)

    move = subparsers.add_parser("move", help="Move task to another status")
    move.add_argument("task_id")
    move.add_argument("status")
    move.set_defaults(func=lambda args: move_task(args.vault, args.task_id, TaskStatus.parse(args.status), args.dry_run))

    complete = subparsers.add_parser("complete", help="Move task to Done")
    complete.add_argument("task_id")
    complete.set_defaults(func=lambda args: move_task(args.vault, args.task_id, TaskStatus.DONE, args.dry_run))

    update = subparsers.add_parser("update", help="Update board metadata")
    update.add_argument("task_id")
    update.add_argument("--title")
    update.add_argument("--due")
    update.add_argument("--source")
    update.add_argument("--created")
    update.set_defaults(func=update_task)

    delete = subparsers.add_parser("delete", help="Remove task from board")
    delete.add_argument("task_id")
    delete.set_defaults(func=delete_task)

    list_cmd = subparsers.add_parser("list", help="List tasks")
    list_cmd.add_argument("--status")
    list_cmd.set_defaults(func=list_tasks)

    find = subparsers.add_parser("find", help="Find tasks by keyword")
    find.add_argument("query")
    find.set_defaults(func=find_tasks)

    check = subparsers.add_parser("check", help="Read-only task entry, status, link, and completion-date checks")
    check.set_defaults(func=check_tasks)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.vault = args.vault.expanduser().resolve()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
