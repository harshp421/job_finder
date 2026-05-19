# job_finder

**A fully-automated job-search pipeline driven by Claude Code.**

Discover jobs → tailor resume → generate PDF → auto-apply by email or web form → check your inbox for replies → produce a morning briefing. One slash-command: `/jf-daily`.

No paid APIs. No subscriptions beyond Claude Code itself. Your data stays local. The pipeline uses your own Claude Code session, public job-board scraping, your Gmail (via SMTP App Password), and a local headless Chromium for form-filling.

---

## What you get

- **11 Claude Code slash commands** that orchestrate discovery, tailoring, applying, archiving, and inbox triage.
- **Per-JD resume + cover letter** tailoring — every cover letter must reference something concrete from the job description, no bulk templates.
- **PDF generator** that converts your markdown resume into a clean, ATS-friendly PDF.
- **SMTP email-applier** for "send your resume to careers@…" style jobs.
- **Playwright form-filler** for Greenhouse / Lever / Ashby forms (with dry-run mode + safety rails).
- **Hard guardrails:** the pipeline refuses to submit to Workday / LinkedIn Easy Apply (ToS risk), refuses to send any form still containing unresolved `<TODO>` fields, and dry-runs every form before going live.

---

## Quick start

```bash
# 1. Clone
git clone <this-repo-url> job_finder
cd job_finder

# 2. Install (Node 18+ required; one-time ~200 MB Playwright Chromium download)
bash scripts/setup.sh

# 3. Copy templates and fill in your real details
cp profile/profile.example.json       profile/profile.json
cp profile/preferences.example.json   profile/preferences.json
cp profile/apply_config.example.json  profile/apply_config.json
cp profile/resume_base.example.md     profile/resume_base.md
cp .env.example                        .env

# 4. Edit each one (the .example files have inline <TODO> markers and docs)

# 5. Open this folder in Claude Code, then run:
/jf-daily
```

All files starting with `profile/profile.json`, `profile/preferences.json`, `profile/apply_config.json`, `profile/resume_base.*`, and `.env` are in `.gitignore` — your personal data never gets committed.

---

## What you need to fill in

There are exactly four files you edit (plus `.env` for SMTP).

### `profile/profile.json`

Who you are, what you want, what to avoid.

- **Identity:** name, email, phone, location, GitHub/LinkedIn/portfolio.
- **Skills:** primary / secondary / specialty / system-design / testing-devops buckets.
- **Achievements headline:** 4–6 punchy one-liners with numbers. These are what cover letters draw from.
- **Target role buckets:** named roles you'd say yes to, with keyword lists for matching.
- **Avoid lists:** seniority labels (Senior, Staff, Manager…) and role keywords (.NET, SAP, Wordpress…) you don't want surfaced.

### `profile/preferences.json`

Where you want to work and which boards to mine.

- **Locations:** preferred cities + whether you're open to remote / international remote.
- **Salary anchors:** min and target for your market (and USD equivalents for international).
- **Company preferences:** preferred + avoid lists.
- **Fit score thresholds:** the score (0–10) above which a job auto-queues for tailoring. Default 7.
- **Discovery sources:** HN, RemoteOK, WeWorkRemotely, Hasjob, YC Work at a Startup, Wellfound, Cuvette, Ashby/Greenhouse boards, LinkedIn. Each has a fetcher (`curl`, `WebFetch`, or `scripts/scrape-page.mjs`).

### `profile/apply_config.json`

The answers the pipeline auto-injects into every application form and cover letter.

- **Identity + links** (duplicates from `profile.json` so forms can pull from one place).
- **Notice period / start date / current + expected salary.**
- **Work authorization** per country (Yes / No — needs sponsorship).
- **US EEO demographics** (optional — set every field to "Prefer not to disclose" if you'd rather).
- **Default open-text answers** for "why this company", "biggest accomplishment", "why leaving", etc.
- **`auto_submit`** (boolean) — **starts OFF**. Forms get filled and screenshotted as `preview.png` but NOT submitted until you flip it on.
- **Safety guardrails:** blocked ATS list (Workday/LinkedIn/etc.), max unhandled-questions cap, required-PDF check.

### `profile/resume_base.md`

Your canonical resume in markdown. The tailorer reads this, then reorders / rewords bullets to match each JD's vocabulary before generating per-job PDFs.

### `.env`

SMTP credentials. Gmail App Password recommended — see comments in `.env.example`.

---

## How a daily run goes

```
/jf-daily
```

Runs five phases in order:

1. **Discover** — scrapes the discovery sources configured in `preferences.json`, scores each job 0–10 against your profile, drops low-fit posts, queues high-fit ones into `jobs/queue/<slug>/`.
2. **Tailor** — for each newly-queued job, writes `resume_tailored.md`, `cover_letter.md`, `fit_analysis.md`, `application_answers.md`, then generates `resume_tailored.pdf`.
3. **Inbox** — sweeps your Gmail (1-day window) for interview / rejection / recruiter messages, updates statuses, writes a digest.
4. **Auto-apply** — sends email-applies via SMTP (`scripts/send-email.mjs`), runs Playwright on Greenhouse/Lever/Ashby forms (`scripts/auto-apply.mjs`). Skips Workday/LinkedIn. Honors the `auto_submit` flag.
5. **Briefing** — writes `logs/runs/briefing-<date>.md` with everything that happened, what needs your attention, and the queue state.

If `auto_submit` is still `false` (default), every form gets filled + screenshotted but not submitted. Review the `preview.png` files for the first run or two before flipping it on.

---

## All commands

| Command | What it does |
|---|---|
| **`/jf-daily`** | The one command. Full pipeline. |
| `/jf-discover [source]` | Just discovery — all sources or one named source. |
| `/jf-tailor <slug \| all>` | Tailor resume + cover letter + answers, generate PDF. |
| `/jf-pdf [slug \| all \| base]` | Regenerate PDFs from markdown. |
| `/jf-apply [slug]` | Auto-apply to tailored jobs in the queue. |
| `/jf-queue [filter]` | Browse the review queue. |
| `/jf-mark-applied <slug>` | Mark a job as applied (if you applied manually). |
| `/jf-archive <slug> [reason]` | Drop a job out of the queue. |
| `/jf-outreach [company]` | Draft personalized cold emails (you review & send). |
| `/jf-inbox [days]` | Check Gmail for interview/rejection/recruiter messages. |
| `/jf-blast <count> [focus]` | Aggressive bulk outreach when boards are dry — mines HN archives + speculative `careers@`. |

---

## Coverage: what gets auto-applied vs skipped

| Apply method | Auto-submitted? | Approx. share of jobs |
|---|---|---|
| Email (`careers@…`, HN "Who's Hiring") | ✅ Yes, via SMTP | ~30% |
| Greenhouse standard form | ✅ Yes, via Playwright | ~25% |
| Lever standard form | ✅ Yes, via Playwright | ~10% |
| Ashby standard form | ✅ Best-effort | ~5% |
| Generic / unknown ATS | ⚠️ Best-effort, may skip | ~15% |
| **Workday / Taleo / iCIMS / SuccessFactors** | ❌ Skipped — too brittle | ~10% |
| **LinkedIn Easy Apply** | ❌ Skipped — ToS / ban risk | ~5% |
| reCAPTCHA / login walls | ❌ Skipped | ~5% |

Expect **~70% true auto-apply coverage**. The other 30% stays in `jobs/queue/` with tailored materials ready — you click through manually in ~30 seconds each.

---

## Folder layout

```
job_finder/
├── profile/
│   ├── *.example.{json,md}     # templates committed to the repo
│   ├── profile.json            # YOUR data, gitignored
│   ├── preferences.json        # YOUR data, gitignored
│   ├── apply_config.json       # YOUR data, gitignored
│   └── resume_base.md (+ .pdf) # YOUR data, gitignored
├── jobs/
│   ├── queue/<slug>/           # discovered & tailored, awaiting/in-progress apply
│   │   ├── jd.md
│   │   ├── status.json
│   │   ├── resume_tailored.md  (+ .pdf)
│   │   ├── cover_letter.md
│   │   ├── fit_analysis.md
│   │   ├── application_answers.md
│   │   └── preview.png         (dry-run) OR submitted.png (live)
│   ├── applied/<slug>/         # already submitted
│   └── archived/<slug>/        # rejected / not a fit
├── outreach/drafts/            # cold-email drafts (you review & send)
├── email/digest/               # daily inbox summaries
├── logs/runs/                  # briefings + applied log
├── scripts/
│   ├── setup.sh                # one-time installer
│   ├── md-to-pdf.mjs           # markdown → PDF
│   ├── auto-apply.mjs          # Playwright form-filler
│   ├── send-email.mjs          # SMTP applier
│   └── scrape-page.mjs         # headless Chromium scraper for JS-rendered boards
└── .claude/commands/           # all the /jf-* slash commands
```

---

## Safety rails

The auto-applier refuses to submit if:

- Any required field in `apply_config.json` still has `<TODO>`.
- The tailored resume PDF is missing.
- The form has more than `skip_if_more_than_n_unknown_questions` (default 3) unhandled fields.
- The URL matches a blocked ATS (`workday.com`, `taleo.net`, `icims.com`, `successfactors.com`, `linkedin.com/jobs/view`).
- `auto_submit` is `false` (dry-run — fills the form, screenshots, doesn't click).

The SMTP sender refuses to send if:

- `tailored_per_jd: true` is not set in `status.json` (i.e. the cover letter is templated, not per-JD).
- The tailored PDF doesn't exist.
- More than `max_email_applies_per_run` (default 5–10) sends have already happened in this run.

Every successful submission leaves either a `submitted.png` (form) or a Gmail messageId (email) in the job folder for proof.

---

## Tuning knobs

`profile/apply_config.json`:
- `auto_submit` — flip to `true` once you trust the previews
- `max_applies_per_run` — default 5
- `max_email_applies_per_run` — default 5–10
- `delay_seconds_between_applies` — default 30 (avoids rate-limiting)
- `form_submission_safety.skip_if_more_than_n_unknown_questions` — raise to be more permissive

`profile/preferences.json`:
- `fit_score_thresholds.auto_queue` — lower from 7 to queue more borderline jobs
- `company_preferences.avoid` — names that slip past discovery
- `discovery_sources` — comment out sources that fail consistently

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/jf-daily` says "node_modules/playwright not found" | Run `bash scripts/setup.sh` |
| `/jf-daily` says "config has TODO fields" | Open `profile/apply_config.json`, find every `<TODO>`, fill them in |
| Auto-apply produces only `preview.png`, never `submitted.png` | `auto_submit` is `false` — flip to `true` once you've verified previews |
| SMTP sender errors out about placeholder password | You didn't replace `paste-your-...` in `.env`. Use a real Gmail App Password. |
| `/jf-inbox` reports wrong Gmail | Reconnect Gmail MCP in Claude Code settings to the same address you apply from |
| Playwright submit fails on a specific site | Check `error.png` in the job folder. Site layout has a quirk. Job stays in queue for manual apply. |
| Too many "too-many-unknowns" skips | Raise `skip_if_more_than_n_unknown_questions` in `apply_config.json`, or add common questions to the matcher in `scripts/auto-apply.mjs` |

---

## Manual override

You can always apply by hand:

1. Open `jobs/queue/<slug>/` in your editor.
2. Copy from `cover_letter.md`, attach `resume_tailored.pdf`, refer to `application_answers.md` for form questions.
3. Submit at the URL in `status.json`.
4. Run `/jf-mark-applied <slug>` so the pipeline knows.

---

## Requirements

- macOS / Linux / WSL (Chromium-via-Playwright is happiest there)
- Node 18+
- [Claude Code](https://claude.ai/code) (CLI or VS Code extension)
- A Gmail account with 2FA + App Password (or any other SMTP provider)

---

## Honest caveats

- **Job boards rate-limit.** Wellfound is bot-protected (Cloudflare) and usually returns empty. The pipeline notes this rather than fabricating data.
- **Workday and LinkedIn Easy Apply are intentionally skipped.** Workday's multi-step custom flows break too often to auto-submit reliably; LinkedIn Easy Apply violates their ToS and risks account bans.
- **Cold `careers@` outreach bounces ~30–40% of the time** at large product companies. `/jf-blast` tracks bounces in its log so you don't retry known failures.
- **You should read what the pipeline drafts before turning on `auto_submit`.** It's good, not perfect. The dry-run safety net exists for a reason.

---

## License

Use it however you want. No warranty.
