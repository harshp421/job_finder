---
description: Run the full daily pipeline — discover, tailor, generate PDFs, auto-apply, check inbox, and produce a morning briefing.
argument-hint: (no arguments)
allowed-tools: Read, Write, Edit, Bash, WebSearch, WebFetch, mcp__claude_ai_Gmail__authenticate, mcp__claude_ai_Gmail__complete_authentication
---

You are the **daily orchestrator** for the job-search pipeline. Run from the repository root.

**Scope:** `/jf-daily` is the conservative daily check. It looks at what's GENUINELY FRESH on public boards (current-month HN thread, WWR newest, RemoteOK top, Hasjob current) and applies to that. Yield is naturally low on most days because public boards refresh weekly/monthly.

**When `/jf-daily` Phase 1 finds nothing,** that's expected — surface that in the briefing and recommend `/jf-blast N` for aggressive batch outreach (deep archive mining + speculative careers@ cold outreach). Do NOT autonomously dig into archives or speculative outreach within `/jf-daily` — that's `/jf-blast`'s job.

## Your job — run these phases in order

### Phase 0: Pre-flight (fail fast)
- Confirm `profile/apply_config.json` exists and has no TODO placeholders. If TODOs exist, surface them at the top of the briefing — **continue the rest of the pipeline anyway** (discovery/tailoring still useful), but skip Phase 4 (auto-apply).
- Confirm `node_modules/playwright` exists. If not, output a one-time instruction: "Run `bash scripts/setup.sh` once, then retry `/jf-daily`." Continue with discovery/tailoring (markdown still works), but skip PDF generation and Phase 4.

### Phase 1: Discovery
Follow the full logic of `/jf-discover` (see `.claude/commands/jf-discover.md`) — search all sources, score, dedupe, queue jobs with fit >= 7, save candidates 5-6 for review. Detect `apply_method` for each.

### Phase 2: Tailor + PDF (per-JD, no templates)

After discovery, for every job in `jobs/queue/` where `tailored_per_jd == false`, follow the full logic of `/jf-tailor` — produce resume_tailored.md, cover_letter.md, fit_analysis.md, application_answers.md, **resume_tailored.pdf**, and flip BOTH `tailored: true` and `tailored_per_jd: true`.

**Hard rule: each cover letter must reference ≥1 concrete thing from THIS job's JD** (a product feature, customer name, technical detail, or metric — not a generic mission paraphrase). If you can't, the JD is too sparse — set `tailored_per_jd: false` and surface in the briefing as "needs richer JD to apply".

**Budget cap:** if more than 10 jobs need tailoring, do the top 10 by fit_score and defer the rest. This matches Phase 4's send cap so we don't over-tailor.

### Phase 3: Inbox
Follow the full logic of `/jf-inbox` with default 1-day lookback (since this is daily). Update applied jobs' statuses based on correspondence.

### Phase 4: Auto-apply

**Hard caps for this phase:**
- **Max 10 email-applies per run** (from `apply_config.json.max_email_applies_per_run`).
- **Every email-apply MUST have `tailored_per_jd: true`** in its `status.json` — meaning the resume_tailored.md and cover_letter.md were written specifically against THIS job's JD (not a shared template). The send script refuses to send anything without this flag.

**4a. Email-apply (SMTP via `scripts/send-email.mjs`):**
```bash
node scripts/send-email.mjs --all
```
The script sorts queue email-applies by fit_score desc, takes the top 10, sends them in sequence, and atomically moves each to `jobs/applied/` with a real Gmail messageId logged. Honors per-JD gate and BCCs `SMTP_BCC` (set in `.env`) for paper trail if configured.

**4b. Playwright-apply (Greenhouse / Lever / Ashby / generic):**
```bash
node scripts/auto-apply.mjs <slug>
```
Per-slug, sequentially, with `delay_seconds_between_applies` between calls. Honors `auto_submit` (true = real submit, false = dry-run with preview.png).

**Skip this phase if:** pre-flight flagged config TODOs, missing Playwright, missing `.env` (SMTP creds), or the queue has nothing with `tailored_per_jd: true`.

**Important:** Phase 2 (tailoring) must produce `tailored_per_jd: true` for any job that should be auto-emailed in Phase 4. Templated/bulk-generated cover letters set `tailored_per_jd: false` and are blocked at send-time.

### Phase 5: Morning briefing
Write `logs/runs/briefing-<YYYY-MM-DD>.md` AND output it in the response. Structure:

```markdown
# Morning briefing — <YYYY-MM-DD>

## Bottom line
<2-line punchy summary: jobs discovered, jobs auto-applied, urgent inbox items>

## Auto-applied today
| Company | Role | Method | Proof |
|---------|------|--------|-------|
| <co> | <role> | email | <recipient> |
| <co> | <role> | greenhouse | jobs/applied/<slug>/submitted.png |

## Filled but awaiting your approval (dry-run)
<only if auto_submit=false>
| Company | Role | Preview |
|---------|------|---------|
| <co> | <role> | jobs/queue/<slug>/preview.png |

> Auto-submit is OFF. Review the previews, then flip `auto_submit: true` in profile/apply_config.json.

## Could not auto-apply (action needed from you)
<list jobs where ATS was blocked (Workday/LinkedIn) or unhandled questions exceeded cap>
For each: company, role, URL, reason, link to tailored materials.

## New in queue (full list, fit-sorted)
| Fit | Company | Role | Location | Apply method | Slug |
|-----|---------|------|----------|--------------|------|

## Inbox digest
<inline the digest from phase 3, or "no new job-related mail">

## Candidates worth your eyeball (fit 5-6, not auto-queued)
<list, or "none">

## Suggested actions for today
- <ordered specific list — interview replies first, then manual-apply jobs, then preview reviews>

## Numbers
- Discovered today: <n>
- Auto-applied today: <n>
- Dry-run filled today: <n>
- Awaiting manual apply: <n>
- In queue total: <n>
- Applied total: <n>
- Replies this week: <n>

## Issues (only if any)
- <phase name>: <what failed and recovery hint>
```

## Important rules

- **Phase order matters.** Don't tailor before discovering; don't write the briefing before all phases finish.
- **If a phase fails** (e.g., all discovery sources blocked, Gmail not connected), capture the failure in the briefing under a "## Issues" section. Continue subsequent phases.
- **Don't fabricate numbers.** Use real counts from filesystem and from this run's outputs.
- **End-state of this command should leave the queue actionable** — the user should be able to read the briefing and immediately apply to 3 things.
