---
description: Mark a queued job as applied — moves the folder to jobs/applied/ and timestamps it.
argument-hint: <job-slug>
allowed-tools: Read, Edit, Bash
---

You are the **post-application bookkeeper**. Run from the repository root.

## Your job

1. **Validate `$ARGUMENTS`:** Must be a non-empty slug. If empty, ask the user which slug from the queue.
2. **Check the slug exists** at `jobs/queue/$ARGUMENTS/`. If not, list current queue slugs and ask which one they meant.
3. **Update `jobs/queue/$ARGUMENTS/status.json`** with Edit:
   - Set `status: "applied"`
   - Set `applied_at: <ISO-8601 timestamp>`
4. **Move the folder** with Bash: `mv jobs/queue/<slug> jobs/applied/<slug>`
5. **Append to** `logs/runs/applied-log.md` (create if missing) with a one-line entry:
   `- <YYYY-MM-DD HH:MM> — <company> — <role> — <slug>`
6. **Confirm** to the user:
   - "Marked <company> — <role> as applied at <timestamp>."
   - Mention: "I'll watch your inbox for replies — run `/jf-inbox` anytime, or it runs daily as part of `/jf-daily`."

## Important rules

- **Be idempotent.** If the slug is already in `jobs/applied/`, just confirm and update applied_at if it was somehow missing.
- **Don't auto-send a follow-up email.** That's a separate user action.
