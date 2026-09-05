---
name: ai-knowledge-task-management
description: Manage tasks in an AI Knowledge Vault, including creating, listing, finding, moving, completing, reopening, updating, and deleting tasks backed by 10-tasks/board.md and 10-tasks/done.md.
---

# AI Knowledge Task Management

Use the bundled script for deterministic task-board edits. The active board is a lightweight scheduling view; completed task blocks live in the archive.

## Storage model

- Active tasks: `10-tasks/board.md`.
- Completed tasks: `10-tasks/done.md`, grouped by completion year.
- General task details: `10-tasks/items/YYYY/MM/`.
- Project task details: `30-projects/<project>/inputs/YYYY/MM/<task>/`.
- Workflow details: `20-workflows/<workflow>/`.
- Task entry frontmatter is the single source of status; keep the board/archive view synchronized and do not repeat a manual status line in the entry body. Canonical pending-release status is `pending_release` (the CLI also accepts `pending-release`).
- Newly completed tasks record `completed_at` as ISO 8601 with a timezone offset. Reopening removes it; completing again records the new completion time. Missing historical completion dates remain unknown and must not be invented.

Do not put execution logs or long context in the board. Use the task entry or `execution.md`.

## Script

The script discovers the nearest vault containing `10-tasks/board.md`. Pass `--vault` only when discovery is ambiguous.
Resolve `scripts/task_manager.py` relative to this skill folder, and run it from the target vault or pass `--vault <vault-root>` before the subcommand.

```bash
python3 scripts/task_manager.py list
python3 scripts/task_manager.py find "keyword"
python3 scripts/task_manager.py check
python3 scripts/task_manager.py create --type general --title "Follow up"
python3 scripts/task_manager.py move p-12 doing
python3 scripts/task_manager.py complete p-12
python3 scripts/task_manager.py move p-12 todo
python3 scripts/task_manager.py --dry-run delete p-12
```

Use `--dry-run` before deletion or when the requested change has a broad impact. New tasks cannot start in `done`; complete them explicitly so the archive remains auditable.

`check` is read-only and checks links, IDs, required metadata, status consistency, and completion dates. Missing historical completion dates are warnings. Markdown links resolve relative to the board/archive file and decode URL escapes; legacy Wiki links resolve from the vault root. Move/update operations validate the entry before changing files, prepare every changed file first, and restore original contents if writing fails. A rollback failure is reported explicitly.

## Safety

- Ask before choosing a project when ownership is unclear.
- Do not delete linked task files unless the user explicitly requests it.
- Preserve existing notes and links when moving between active and completed storage.
- Never overwrite unrelated task blocks.
