---
description: Auto-apply to tailored jobs in the queue. Email-based jobs sent via Gmail, ATS forms via Playwright. Honors auto_submit and rate-limit settings.
argument-hint: [optional: single <slug> to apply to just one job]
allowed-tools: Read, Write, Edit, Bash, mcp__claude_ai_Gmail__authenticate, mcp__claude_ai_Gmail__complete_authentication
---

You are the **auto-apply** stage. Run from the repository root.

## Inputs
- `$ARGUMENTS` — optional slug. If given, apply only to that one job. If empty, batch-apply.

## Pre-flight (always do this)

1. **Read** `profile/apply_config.json`. If any field still contains `<TODO>`, list them, tell the user, and stop. Do not start applying.
2. **Read** `profile/preferences.json` for any overrides.
3. **Check** `node --version` via Bash. Need v18+. If missing or too old, instruct user to run `bash scripts/setup.sh` and stop.
4. **Check** `node_modules/playwright` exists. If not, instruct user to run `bash scripts/setup.sh` and stop.
5. **Check** Gmail MCP auth — call any harmless Gmail tool. If it fails, or if it's connected to an address listed in `preferences.json.do_not_send_from`, run `mcp__claude_ai_Gmail__authenticate` to start re-auth and tell the user to complete it in their browser. Continue with form-based applies; skip email-based ones with a note. (Most users won't need Gmail MCP at all — SMTP via `scripts/send-email.mjs` is the canonical send path. Gmail MCP only matters for `/jf-inbox` and `/jf-outreach`.)

## Build the apply list

- If `$ARGUMENTS` is a slug → apply list is `[<slug>]`.
- Else: list all `jobs/queue/<slug>/status.json` where `tailored == true` AND `status != "applied"`. Sort by fit_score descending.
- **Cap** the apply list to `apply_config.json.max_applies_per_run` (default 5). Note any skipped past the cap.

## For each job in the apply list

### Step 1 — Verify PDF exists
- Check `jobs/queue/<slug>/resume_tailored.pdf` exists.
- If missing: run `node scripts/md-to-pdf.mjs jobs/queue/<slug>/resume_tailored.md` via Bash. If still missing after, log and skip this job.

### Step 2 — Pick apply method from status.json `apply_method` field

- **`email`** — proceed to Email Apply (below)
- **`greenhouse` | `lever` | `ashby` | `generic`** — proceed to Playwright Apply (below)
- **`manual-required`** — log "manual apply required" and skip.
- **anything else / missing** — re-detect by URL pattern and JD content. If you can't classify, mark `apply_method: "manual-required"` in status.json and skip.

### Step 3a — Email Apply (SMTP via scripts/send-email.mjs)

**Preferred path: use the SMTP sender script.** It enforces the per-JD tailoring gate, the `max_email_applies_per_run` cap, attaches the PDF, sends HTML + plain-text multipart, BCCs the user's own inbox, and atomically marks `applied` + moves the folder + updates the log.

Pre-conditions enforced by the script:
- `apply_method: "email"` and `apply_email` set in `status.json`
- `tailored_per_jd: true` (set by `/jf-tailor` after writing JD-specific resume + cover letter)
- `jobs/queue/<slug>/resume_tailored.pdf` exists (not just the base resume)
- `.env` is configured with SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, etc. — see `.env.example`)

Command:
```bash
node scripts/send-email.mjs --all
```
Or for a single slug (bypasses per-JD gate as a deliberate single-job override):
```bash
node scripts/send-email.mjs <slug>
```
Dry-run preview without sending:
```bash
node scripts/send-email.mjs --all --dry-run
```

The script handles:
- SMTP auth verification before the first send
- Subject extracted from the `Subject:` line in `cover_letter.md` (if present), else `apply_subject_required`, else default
- HTML body via marked (markdown → proper `<p>/<ul>/<strong>` tags), plain-text fallback with markdown stripped
- Attachment named `<LastName>_<FirstName>_Resume.pdf` (built from `apply_config.json`)
- Cap of `max_email_applies_per_run` (default 10) — best fit_scores sent first, rest deferred
- Atomic move queue → applied + status.json update + log append per send

**Do NOT compose emails by hand or via Gmail MCP for routine sends** — use the script. The MCP path was an interim workaround when SMTP wasn't configured; with `.env` in place, SMTP is the canonical send channel.

### Step 3b — Playwright Apply

For form-based jobs, shell out to the script:

```bash
node scripts/auto-apply.mjs <slug>
```

(Add `--submit` to that command only if `apply_config.json.auto_submit == true`. The script also reads the config and self-toggles, but explicit is clearer.)

Wait for the script to complete. Read its stderr/stdout. Interpret exit code:
- **0** — success. If `auto_submit:true`, the script already moved the folder to `jobs/applied/`. If dry-run, the folder stays in queue with `preview.png` generated.
- **2** — config not ready (TODOs or missing PDF). Show the error to the user.
- **3** — blocked ATS (Workday / LinkedIn / etc.). Already marked as manual-required.
- **4** — too many unhandled questions. Marked for review, screenshot saved.
- **1** — generic error. Surface the error from stderr.

### Step 4 — Rate limit

Wait `apply_config.json.delay_seconds_between_applies` seconds (default 30) before the next job. Use Bash `sleep`. Skip the wait for the last job.

## After the apply loop

Write a summary to the response:

```
## Auto-apply summary — <date>

Submitted:
- <company> — <role> — via email → <recipient>
- <company> — <role> — via greenhouse → submitted.png

Dry-run filled (review needed):
- <company> — <role> — see jobs/queue/<slug>/preview.png

Skipped:
- <company> — <role> — blocked ATS (workday)
- <company> — <role> — too many unhandled questions (review jobs/queue/<slug>/too-many-unknowns.png)

Errors:
- <company> — <role> — <message>
```

Also surface:
- "Auto-submit was OFF — review the preview screenshots and flip `auto_submit: true` in profile/apply_config.json when ready."
  (only show this line if auto_submit was false)
- Remaining queue count.

## Hard rules

- **Never invent the recipient email** for email-applies. If you can't find it, mark manual-required.
- **Never bypass the TODO check.** If apply_config has TODOs, stop everything.
- **Never apply twice.** Always check `status: "applied"` first.
- **Never submit to blocked ATS** (Workday, LinkedIn, etc.) — these are in `apply_config.json.form_submission_safety.skip_if_url_contains`.
- **Don't lie about success.** If a Playwright run failed mid-form, say so — don't claim "submitted".
