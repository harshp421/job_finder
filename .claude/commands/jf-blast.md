---
description: Aggressive bulk cold-outreach. Mines deep HN "Who is hiring?" archives + speculative careers@ cold-outreach to known product cos. Per-JD tailored, auto-sends via SMTP. Use when you want VOLUME beyond what /jf-daily finds.
argument-hint: <count> [focus] | e.g. "20", "40 frontend", "20 backend", "25 ai"
allowed-tools: Read, Write, Edit, Bash, WebFetch, WebSearch, mcp__claude_ai_Gmail__search_threads
---

You are the **aggressive batch outreach** stage. Run from the repository root.

## What this command does (different from `/jf-daily`)

`/jf-daily` discovers what's **fresh** today on public boards and applies to it. That's right for routine maintenance but yields zero new applications when public boards haven't refreshed (which is most days — HN's "Who is hiring?" refreshes monthly, WWR weekly).

`/jf-blast` instead:

- **Mines the last several months of archived HN "Who is hiring?" threads** (look them up dynamically via the Algolia API, see Phase 2) for any post the user hasn't applied to yet
- **Goes deeper into existing threads** — looser filters, more "stretch" candidates
- **Adds speculative `careers@` cold-outreach** to product companies that don't post on HN but might still respond
- **Aggressively cold-emails** at a configurable volume (default 20, can go higher)
- **Per-JD tailors every single one** before sending (gate is enforced)

It's higher volume + higher noise (~30-40% bounce rate on speculative careers@) but the absolute number of real responses scales with volume.

## Arguments

- `$ARGUMENTS` — `<count> [focus]`
  - First token = number of applications to send. Default `20`. Hard cap `100` per run.
  - Second token (optional) = focus filter. One of: `frontend`, `backend`, `fullstack`, `ai`, `mern`, `senior`, `junior`, `india`, `remote`, or omitted for general. The filter is matched against the JD body and the user's `profile.json.target_role_buckets`.
  - Examples: `/jf-blast 30`, `/jf-blast 40 frontend`, `/jf-blast 25 backend remote`

## Phases

### Phase 1: Pre-flight (fail fast)

- Confirm `.env` exists with `SMTP_HOST/PORT/USER/PASS` set (real values, no placeholders).
- Confirm `node_modules/playwright` + `node_modules/nodemailer` exist.
- Confirm `profile/apply_config.json` has no TODOs.
- Confirm Gmail MCP is authenticated for inbox sweep (optional but useful for bounce tracking).
- Read the current `max_email_applies_per_run` from apply_config. **Temporarily bump it to the requested count** for this run (revert at the end).

### Phase 2: Deep discovery (different from /jf-daily Phase 1)

**Step 1 — Discover archived HN "Who is hiring?" threads and re-mine them:**

```bash
# Step 1a: find the last 6 months of "Ask HN: Who is hiring?" thread IDs via Algolia.
curl -s "https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&restrictSearchableAttributes=title&hitsPerPage=10" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(h['objectID'] for h in d['hits'] if 'Who is hiring' in h['title']))"

# Step 1b: for each thread ID found, fetch the comments tree:
curl -s "https://hn.algolia.com/api/v1/items/<thread-id>" > /tmp/hn_<thread-id>.json
```

Mine each thread with a Python filter that:

- Extracts the first email address from each comment body
- Filters for stack-match against `profile.json.skills.primary` + `target_role_buckets`, adjusted by `$ARGUMENTS` focus
- Skips seniority labels in `profile.json.avoid_seniority_labels` (unless `$ARGUMENTS` says `senior`)
- Skips already-applied (read all `status.json` in `jobs/queue/`, `jobs/applied/`, `jobs/archived/`)
- Skips known-bad emails (SEEKING WORK personal posts, sweat-equity, US-citizen-only posts when the user can't work in the US, etc.)
- Validates email format

**Step 2 — Add speculative careers@ cold-outreach** for ~20-40% of the batch:

- Build a list of `careers@<company>.com` from `preferences.json.company_preferences.preferred` plus any company you've recently seen on HN/WWR/Wellfound that looked promising.
- **Warning:** ~30-40% of these will bounce because big cos use Greenhouse/Lever ATS and don't monitor `careers@`. That's the tradeoff for volume.
- Low-bounce-risk: smaller startups, OSS-heavy cos, founder-led cos.
- High-bounce-risk: large product cos with a heavy ATS presence — they often filter `careers@` straight to /dev/null.
- Check `logs/runs/blast-*.md` from prior runs for companies that have bounced before, and avoid re-trying them this run.

**Step 3 — Combine + sort:** by fit-score (preferred locations > worldwide remote > onsite), then by JD richness (longer = more tailorable).

**Step 4 — Cap to `$ARGUMENTS` count.** Defer the rest.

### Phase 3: Per-JD tailor (every single one)

**Hard rule (same as /jf-tailor):** each cover letter must reference ≥1 concrete thing from THIS JD (a product feature, customer name, technical detail, metric, specific quote). No bulk templates.

For each job:

- Write `jobs/queue/<slug>/status.json` with `tailored_per_jd: true`
- Write `jobs/queue/<slug>/jd.md` (the original JD text)
- Write `jobs/queue/<slug>/cover_letter.md` (200-300 words, JD-specific hook + matching achievement from `profile.json.achievements_headline` + honest gap notes)
- Write `jobs/queue/<slug>/resume_tailored.md` (skills section reordered to match JD stack)
- Generate `jobs/queue/<slug>/resume_tailored.pdf` via `node scripts/md-to-pdf.mjs`

If the JD is too sparse to extract a concrete hook, set `tailored_per_jd: false` and surface in the briefing as "skipped — JD too sparse."

### Phase 4: Send (SMTP via send-email.mjs)

```bash
node scripts/send-email.mjs --all --dry-run    # preview first
node scripts/send-email.mjs --all              # send for real
```

The script's per-JD gate + cap will enforce quality. Watch the run output for failures.

### Phase 5: Restore cap + write log

```bash
# Restore max_email_applies_per_run to its previous value (typically 10)
```

Append to `logs/runs/blast-<YYYY-MM-DD>-<HHMM>.md`:

```markdown
# Blast — <YYYY-MM-DD> <HHMM>

Args: count=<n> focus=<focus>

## Sent (n)

| Company | Role | Recipient | Message-ID |
| ------- | ---- | --------- | ---------- |

## Cold-outreach (speculative careers@) — expect bounces

- careers@... → tracked

## Pool exhaustion notes

<which HN threads / sources were dry>

## Recommended next /jf-blast cadence

<e.g. "wait 3-5 days before next blast — pool needs to refresh">
```

## Hard rules

- **Never bypass the per-JD gate.** Bulk-templated cover letters set `tailored_per_jd: false` and the send script blocks them.
- **Never re-apply** to an email already in `jobs/applied/` or `jobs/queue/`. Check before queueing.
- **Be honest in covers about location/visa/YOE gaps** when stretching to senior/onsite roles.
- **Restore `max_email_applies_per_run` at the end of the run** to its previous value (typically 10) so `/jf-daily` keeps its conservative cap.
- **If pool is dry** (less than 5 new candidates after dedup + filter), surface that and stop — don't pad the batch with low-quality stretches.
- **Bounce-aware:** speculative `careers@` cold outreach to big product cos often has ~40% bounce rate. Read `logs/runs/blast-*.md` to avoid retrying known failures. Track new bounces in this run's blast log.

## When to use this vs alternatives

- **`/jf-daily`** — once a day, routine. Catches genuinely fresh posts + inbox sweep.
- **`/jf-blast N`** — when you want volume. Dig deep into archives + speculative cold outreach.
- **`/jf-outreach`** — when you want curated user-reviewed drafts to specific top-fit companies (existing command, drafts only).
- **`/jf-discover`** — search-only, no apply.
- **`/jf-apply`** — apply to whatever's tailored in the queue, no discovery.
