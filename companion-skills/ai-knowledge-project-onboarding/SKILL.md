---
name: ai-knowledge-project-onboarding
description: Generate or update an AI-friendly project knowledge entry under 30-projects from a source repository, using concise Obsidian-compatible project documentation and reusable templates.
---

# AI Knowledge Project Onboarding

Create a maintainable project knowledge entry without copying source code into the vault.

## Inputs

- An absolute source repository path.
- A vault output path under `30-projects/<project>`.

If either path cannot be discovered safely, ask once before writing.

## Output

Use the bundled templates to maintain these files:

- `index.md`
- `AGENTS.md`
- `architecture.md`
- `modules.md`
- `links.md`
- `env.md`
- `runbook.md`
- `database.md`

Keep `links.md` as a short hot entry. Put environment facts in `env.md`, executable procedures in `runbook.md`, and database structure in `database.md`.
Keep `AGENTS.md` within 3 KiB and `links.md` within 5 KiB. Read `AGENTS.md` and `links.md` by default; route to other files only as needed. Preserve actual file and directory paths in Markdown links instead of appending `.md` to every target. Record a branch as a dated observation or a repository default, never as an undated live checkout state.

## Workflow

1. Read the source repository metadata and existing documentation before scanning implementation directories.
2. Identify modules, entry points, data flows, external dependencies, build commands, and existing operational docs.
3. If the output already exists, update incrementally and preserve user-authored facts.
4. Use standard Markdown links inside the vault.
5. Run `scripts/validate_knowledge.py <vault-root>/30-projects/<project> --project <project>` after writing.

For a lightweight vault navigation check, run `scripts/validate_knowledge.py <vault-root> --all-projects --navigation-only`. This checks project index coverage, local entry links and byte limits without reading environment files or source code.

## Safety and portability

- Do not copy source trees, generated artifacts, logs, or dependency folders into the vault.
- Shared templates must contain placeholders, never real passwords, access tokens, internal hosts, jump hosts, or personal paths.
- Add sensitive local facts only when the user explicitly asks and the target repository policy permits it.
- Do not access remote servers, databases, or private services unless the user separately authorizes that operation.
