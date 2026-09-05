---
name: ai-knowledge-weekly-summary
description: Prepare a weekly work summary from an AI Knowledge Vault, using active tasks, completed-task archives, task entries, weekly notes, and local Git evidence.
---

# AI Knowledge Weekly Summary

Summarize verified work for a requested period without treating every Git change as report-worthy work.

## Sources

1. `10-tasks/board.md` for active and pending-release work.
2. `10-tasks/done.md` for completed work archived during the period.
3. Linked task entry files and `execution.md` for what actually changed.
4. Existing files under `60-其他/周报/`; preserve user-authored judgments.
5. Git history and symlink-target history as supporting evidence.

Use the linked task entry's `completed_at` as the primary completion date, interpreted in the user's time zone. Historical tasks without this field need dated execution or Git evidence; do not substitute `created`, file modification time, or the day of the summary. Keep uncertain completion dates explicit and exclude them from exact completed-task counts unless verified.

Use `scripts/collect_weekly_changes.py [vault-root] --since YYYY-MM-DD --until YYYY-MM-DD` to collect Git evidence. The script discovers the nearest vault when the path is omitted.
Resolve the script path relative to this skill folder. Follow the user's requested reporting period; without explicit dates, the script uses the current calendar week from Monday through today.

## Output

Write or update `60-其他/周报/YYYY-WW.md` with concise sections for delivered work, fixes, data or operational work, follow-ups, and risks. Distinguish completed work from work still in progress.

Do not commit or push unless the user requests it.
