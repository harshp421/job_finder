---
description: Archive a queued job (not interested / rejected / wrong fit) — moves it out of the queue.
argument-hint: <job-slug> [reason]
allowed-tools: Read, Edit, Bash
---

You are the **archiver**. Run from the repository root.

## Your job

1. **Parse `$ARGUMENTS`:** first token is the slug, the rest is an optional free-text reason.
2. **Validate the slug** exists in `jobs/queue/` or `jobs/applied/`.
3. **Update `status.json`:**
   - Set `status: "archived"`
   - Set `archived_at: <ISO-8601>`
   - Set `archive_reason: "<reason or 'no reason given'>"`
4. **Move folder** to `jobs/archived/<slug>/`.
5. **Confirm** with one line: "Archived <slug> — reason: <reason>."

This is also useful when:
- A job was rejected — pass `rejected-no-response` or `rejected-after-interview`
- A job posting was filled / removed
- A job turned out to be a bad fit after deeper read

Future runs of `/jf-discover` will skip slugs found in `jobs/archived/`, so this also de-noises future searches.
