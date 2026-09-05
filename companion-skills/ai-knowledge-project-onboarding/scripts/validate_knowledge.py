#!/usr/bin/env python3
"""Validate generated project knowledge files for Obsidian-friendly structure."""

from __future__ import annotations

import argparse
import os
import re
import sys
from enum import IntEnum
from pathlib import Path
from urllib.parse import unquote, urlsplit


CORE_FILES = [
    "index.md",
    "AGENTS.md",
    "architecture.md",
    "modules.md",
    "links.md",
    "env.md",
    "runbook.md",
    "database.md",
]

NAV_LINKS = ["index", "AGENTS", "architecture", "modules", "links", "env", "runbook", "database"]
MARKDOWN_NAV = " | ".join(f"[{name}]({name}.md)" for name in NAV_LINKS)
WIKI_NAV = " | ".join(f"[[{name}]]" for name in NAV_LINKS)

LINKS_COLD_PATTERNS = [
    r"##\s*(环境详情|数据库连接|日志入口|缓存|消息队列|配置中心)",
    r"\b(mysql\s+-h|curl\s+|ssh\s+|bru\s+run|kubectl\s+)",
    r"(Host|用户名|密码|服务器地址|日志根目录|请求 ID|Trace ID)",
]


class EntryByteLimit(IntEnum):
    AGENTS = 3 * 1024
    LINKS = 5 * 1024


def validate_navigation(root: Path) -> list[str]:
    """只检查项目热入口，不读取源码或环境文件。"""
    errors: list[str] = []
    for name in ("AGENTS.md", "index.md", "links.md"):
        path = root / name
        if not path.is_file():
            errors.append(f"missing entry: {name}")
            continue
        content = read_text(path)
        limit = EntryByteLimit.AGENTS if name == "AGENTS.md" else EntryByteLimit.LINKS if name == "links.md" else None
        if limit is not None and len(content.encode("utf-8")) > limit:
            errors.append(f"{name} exceeds {int(limit)} bytes")
        errors.extend(validate_local_links(path, content))
    return errors


def validate_local_links(path: Path, content: str) -> list[str]:
    errors: list[str] = []
    fence: str | None = None
    for number, line in enumerate(content.splitlines(), 1):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if marker:
            current = marker.group(1)
            if fence is None:
                fence = current
            elif current[0] == fence[0] and len(current) >= len(fence) and not marker.group(2).strip():
                fence = None
            continue
        if fence is not None:
            continue
        line = re.sub(r"(`+).*?\1", "", line)
        if re.search(r"\[\[[^\]]+\]\]", line):
            errors.append(f"{path.name}:{number}: use standard Markdown links")
        for match in re.finditer(r"\[[^\]]*\]\((<[^>]+>|[^)]+)\)", line):
            raw = match.group(1).strip()
            raw = raw[1:-1] if raw.startswith("<") and raw.endswith(">") else re.sub(r'\s+[\"\x27].*$', '', raw)
            if raw.startswith("#") or urlsplit(raw).scheme:
                continue
            target = unquote(raw.split("#", 1)[0].split("?", 1)[0])
            if not target or "{{" in target or "<" in target:
                continue
            if not (path.parent / target).exists():
                errors.append(f"{path.name}:{number}: missing link target: {target}")
    return errors


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def line_count(text: str) -> int:
    return 0 if not text else text.count("\n") + (0 if text.endswith("\n") else 1)


def validate_project(root: Path, project: str | None, max_lines: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not root.exists() or not root.is_dir():
        errors.append(f"knowledge directory does not exist: {root}")
        return errors, warnings

    errors.extend(validate_navigation(root))

    for filename in CORE_FILES:
        path = root / filename
        if not path.exists():
            errors.append(f"missing core file: {filename}")
            continue
        if not path.is_file():
            errors.append(f"core path is not a file: {filename}")
            continue
        text = read_text(path)
        lines = line_count(text)
        if lines > max_lines:
            errors.append(f"{filename} has {lines} lines, exceeds {max_lines}")
        if filename == "AGENTS.md" and not all(f"]({name}.md)" in text for name in ("index", "links")):
            errors.append("AGENTS.md missing index/links navigation")
        elif filename not in ("index.md", "AGENTS.md") and MARKDOWN_NAV not in text and WIKI_NAV not in text:
            errors.append(f"{filename} missing navigation line")

    index_path = root / "index.md"
    if index_path.exists() and index_path.is_file():
        index_text = read_text(index_path)
        if project and f"#project/{project}" not in index_text:
            errors.append(f"index.md missing #project/{project} tag")
        for name in NAV_LINKS[1:]:
            markdown_link = f"]({name}.md)"
            wiki_link = f"[[{name}]]"
            if markdown_link not in index_text and wiki_link not in index_text:
                errors.append(f"index.md missing link to {name}.md")

    links_path = root / "links.md"
    if links_path.exists() and links_path.is_file():
        links_text = read_text(links_path)
        if "## 源码仓库" not in links_text and "## 源码路径" not in links_text and "## 源码目录" not in links_text:
            warnings.append("links.md missing source repository/path section")
        if "源码项目" not in links_text and "源码根目录" not in links_text:
            warnings.append("links.md missing source project path")
        if line_count(links_text) > 120 or len(links_text.encode("utf-8")) > 5 * 1024:
            warnings.append("links.md is large; keep it as a hot entry and move cold details to env.md/runbook.md")
        for pattern in LINKS_COLD_PATTERNS:
            if re.search(pattern, links_text):
                warnings.append("links.md appears to contain environment/command cold information; move it to env.md or runbook.md")
                break

    env_path = root / "env.md"
    if env_path.exists() and env_path.is_file():
        env_text = read_text(env_path)
        for heading in ("## 环境概览", "## 外部依赖", "## 日志入口", "## 数据库连接"):
            if heading not in env_text:
                warnings.append(f"env.md missing {heading}")

    runbook_path = root / "runbook.md"
    if runbook_path.exists() and runbook_path.is_file():
        runbook_text = read_text(runbook_path)
        for heading in ("## 构建", "## 运行", "## 验证", "## 排查"):
            if heading not in runbook_text:
                warnings.append(f"runbook.md missing {heading}")

    agents_path = root / "AGENTS.md"
    if agents_path.exists() and agents_path.is_file():
        agents_text = read_text(agents_path)
        if "## AI 进入项目规则" not in agents_text and "## AI 阅读建议" not in agents_text:
            warnings.append("AGENTS.md missing AI entry/read guidance section")

    database_path = root / "database.md"
    if database_path.exists() and database_path.is_file():
        database_text = read_text(database_path)
        for heading in ("## 表结构来源", "## 核心表索引", "## 常用导出场景"):
            if heading not in database_text:
                errors.append(f"database.md missing {heading}")

    for child in root.iterdir():
        if child.is_symlink() and not child.exists():
            errors.append(f"broken symlink: {child.name} -> {os.readlink(child)}")

    return errors, warnings


def validate_projects_index(projects_root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    index_path = projects_root / "index.md"

    if not index_path.exists():
        errors.append(f"missing projects index: {index_path}")
        return errors, warnings

    index_text = read_text(index_path)
    project_dirs = sorted(
        child.name
        for child in projects_root.iterdir()
        if child.is_dir() and (child / "index.md").exists()
    )
    linked_projects = set(re.findall(r"\[\[([^]/\n|]+)/index(?:\|[^\]]+)?\]\]", index_text))
    linked_projects.update(
        match.rstrip("/").split("/")[-2]
        for match in re.findall(r"\]\(([^)]+/index\.md)\)", index_text)
        if len(match.rstrip("/").split("/")) >= 2
    )

    for project in project_dirs:
        if project not in linked_projects:
            errors.append(f"30-projects/index.md missing project entry: {project}")

    for project in sorted(linked_projects):
        if project not in project_dirs:
            errors.append(f"30-projects/index.md links missing project directory: {project}")

    if not project_dirs:
        warnings.append(f"no project directories found under {projects_root}")

    return errors, warnings


def validate_vault(root: Path, max_lines: int, navigation_only: bool = False) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    projects_root = root / "30-projects" if (root / "30-projects").is_dir() else root

    index_errors, index_warnings = validate_projects_index(projects_root)
    errors.extend(index_errors)
    warnings.extend(index_warnings)

    if root != projects_root:
        root_entry = root / "AGENTS.md"
        if root_entry.is_file() and root_entry.stat().st_size > EntryByteLimit.AGENTS:
            errors.append("AGENTS.md exceeds 3072 bytes")
    projects_index = projects_root / "index.md"
    if projects_index.is_file():
        errors.extend(validate_local_links(projects_index, read_text(projects_index)))

    for project_dir in sorted(child for child in projects_root.iterdir() if child.is_dir()):
        if not (project_dir / "index.md").exists():
            continue
        if navigation_only:
            project_errors, project_warnings = validate_navigation(project_dir), []
        else:
            project_errors, project_warnings = validate_project(project_dir, project_dir.name, max_lines)
        errors.extend(f"{project_dir.name}: {item}" for item in project_errors)
        warnings.extend(f"{project_dir.name}: {item}" for item in project_warnings)

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated project knowledge.")
    parser.add_argument("knowledge_dir", help="Path to generated knowledge directory")
    parser.add_argument("--project", help="Expected project name for #project/<name> tag")
    parser.add_argument("--all-projects", action="store_true", help="Validate 30-projects index and every project directory")
    parser.add_argument("--navigation-only", action="store_true", help="Only check entry links, entry size and project index; do not read environment files")
    parser.add_argument("--max-lines", type=int, default=200, help="Maximum lines per core file")
    args = parser.parse_args()

    root = Path(args.knowledge_dir).expanduser().resolve()
    if args.all_projects:
        errors, warnings = validate_vault(root, args.max_lines, args.navigation_only)
    elif args.navigation_only:
        errors, warnings = validate_navigation(root), []
    else:
        errors, warnings = validate_project(root, args.project, args.max_lines)

    print_report(errors, warnings)
    return 1 if errors else 0


def print_report(errors: list[str], warnings: list[str]) -> None:
    if errors:
        print("ERRORS:")
        for item in errors:
            print(f"- {item}")
    if warnings:
        print("WARNINGS:")
        for item in warnings:
            print(f"- {item}")
    if not errors and not warnings:
        print("OK: knowledge directory passed validation")
    elif not errors:
        print("OK: validation passed with warnings")


if __name__ == "__main__":
    sys.exit(main())
