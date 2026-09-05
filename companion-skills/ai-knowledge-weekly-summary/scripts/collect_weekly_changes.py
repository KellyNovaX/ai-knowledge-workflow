#!/usr/bin/env python3
"""Collect weekly git changes from a knowledge repo and symlink target repos."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any


def run_git(cwd: Path, args: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def git_root(path: Path) -> Path | None:
    cwd = path if path.is_dir() else path.parent
    code, out, _ = run_git(cwd, ["rev-parse", "--show-toplevel"])
    return Path(out).resolve() if code == 0 and out else None


def rel_to_repo(repo: Path, path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(repo))
    except ValueError:
        return "."


def git_log(repo: Path, since: str, until: str | None, pathspec: str | None = None) -> str:
    args = ["log", "--date=short", "--pretty=format:%h %ad %an %s", "--name-status", f"--since={since}"]
    if until:
        args.append(f"--until={until}")
    if pathspec:
        args.extend(["--", pathspec])
    code, out, err = run_git(repo, args)
    if code != 0:
        return f"ERROR: {err}"
    return out


def git_status(repo: Path, pathspec: str | None = None) -> str:
    args = ["status", "--short"]
    if pathspec:
        args.extend(["--", pathspec])
    code, out, err = run_git(repo, args)
    if code != 0:
        return f"ERROR: {err}"
    return out


def find_symlinks(root: Path, project_filter: str | None) -> list[Path]:
    result: list[Path] = []
    for base, dirs, files in os.walk(root):
        base_path = Path(base)
        dirs[:] = [d for d in dirs if d not in {".git", ".obsidian", ".trash"}]
        for name in [*dirs, *files]:
            path = base_path / name
            if not path.is_symlink():
                continue
            rel = str(path.relative_to(root))
            target = os.readlink(path)
            if project_filter and project_filter not in rel and project_filter not in target:
                continue
            result.append(path)
    return sorted(result)


def collect(root: Path, since: str, until: str | None, project_filter: str | None) -> dict[str, Any]:
    root = root.resolve()
    data: dict[str, Any] = {
        "knowledge_root": str(root),
        "since": since,
        "until": until,
        "knowledge_repo": None,
        "symlink_repos": [],
        "weekly_files": [],
    }

    repo = git_root(root)
    if repo:
        data["knowledge_repo"] = {
            "repo": str(repo),
            "path": rel_to_repo(repo, root),
            "log": git_log(repo, since, until, rel_to_repo(repo, root)),
            "status": git_status(repo, rel_to_repo(repo, root)),
        }

    weekly_dir = root / "60-其他" / "周报"
    if weekly_dir.exists():
        for path in sorted(weekly_dir.glob("*.md")):
            if not project_filter or project_filter in path.name or project_filter in path.read_text(encoding="utf-8", errors="ignore"):
                data["weekly_files"].append(str(path))

    seen: set[tuple[str, str]] = set()
    for link in find_symlinks(root, project_filter):
        target = link.resolve()
        target_repo = git_root(target)
        if not target_repo:
            data["symlink_repos"].append({
                "link": str(link),
                "target": str(target),
                "error": "target is not inside a git repository",
            })
            continue
        pathspec = rel_to_repo(target_repo, target)
        key = (str(target_repo), pathspec)
        if key in seen:
            continue
        seen.add(key)
        data["symlink_repos"].append({
            "link": str(link),
            "target": str(target),
            "repo": str(target_repo),
            "path": pathspec,
            "log": git_log(target_repo, since, until, pathspec),
            "status": git_status(target_repo, pathspec),
        })
    return data


def print_markdown(data: dict[str, Any]) -> None:
    print(f"# Weekly Change Evidence\n")
    print(f"- knowledge_root: `{data['knowledge_root']}`")
    print(f"- since: `{data['since']}`")
    if data.get("until"):
        print(f"- until: `{data['until']}`")

    print("\n## Knowledge Repo")
    repo = data.get("knowledge_repo")
    if not repo:
        print("- Not a git repository")
    else:
        print(f"- repo: `{repo['repo']}`")
        print(f"- path: `{repo['path']}`")
        print("\n### Committed Changes\n")
        print("```text")
        print(repo.get("log") or "(none)")
        print("```")
        print("\n### Uncommitted Changes\n")
        print("```text")
        print(repo.get("status") or "(none)")
        print("```")

    print("\n## Symlink Target Repos")
    if not data["symlink_repos"]:
        print("- No symlink target repositories found")
    for item in data["symlink_repos"]:
        print(f"\n### {item['link']}")
        print(f"- target: `{item['target']}`")
        if item.get("error"):
            print(f"- error: {item['error']}")
            continue
        print(f"- repo: `{item['repo']}`")
        print(f"- path: `{item['path']}`")
        print("\nCommitted changes:")
        print("```text")
        print(item.get("log") or "(none)")
        print("```")
        print("\nUncommitted changes:")
        print("```text")
        print(item.get("status") or "(none)")
        print("```")

    print("\n## Weekly Files")
    if data["weekly_files"]:
        for path in data["weekly_files"]:
            print(f"- `{path}`")
    else:
        print("- (none)")


def default_week_range() -> tuple[str, str]:
    """Return Monday through today; explicit CLI dates override this default."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat(), today.isoformat()


def discover_vault() -> Path:
    starts = [Path.cwd(), Path(__file__).resolve().parent]
    seen: set[Path] = set()
    for start in starts:
        for candidate in [start, *start.parents]:
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if (resolved / "10-tasks" / "board.md").exists():
                return resolved
    return Path.cwd().resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect weekly changes from an AI Knowledge Vault and symlink targets.")
    parser.add_argument("knowledge_root", nargs="?", type=Path, default=discover_vault())
    default_since, default_until = default_week_range()
    parser.add_argument("--since", default=default_since,
                        help=f"Start date (default: Monday {default_since})")
    parser.add_argument("--until", default=default_until,
                        help=f"End date (default: today {default_until})")
    parser.add_argument("--project", help="Only include symlinks or weekly files matching this project name")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown")
    args = parser.parse_args()

    root = args.knowledge_root.expanduser()
    if not root.exists() or not root.is_dir():
        print(f"knowledge root does not exist: {root}", file=sys.stderr)
        return 1

    data = collect(root, args.since, args.until, args.project)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print_markdown(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
