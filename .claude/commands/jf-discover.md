---
description: Discover new jobs matching the profile from multiple public sources, score for fit, and add to the review queue.
argument-hint: [optional source name to restrict, e.g. "hn" or "wellfound"]
allowed-tools: Read, Write, Bash, WebSearch, WebFetch
---

You are the **job discovery** stage of an agentic job-search pipeline. Run from the repository root.

## Your job

1. **Load context:**
   - Read `profile/profile.json` (skills, target roles, anti-targets)
   - Read `profile/preferences.json` (locations, salary, discovery_sources, fit_score_thresholds, avoid companies)
   - List existing job slugs in `jobs/queue/`, `jobs/applied/`, `jobs/archived/` (Bash: `ls jobs/queue jobs/applied jobs/archived 2>/dev/null`) — these are your dedupe list

2. **Discover jobs.** If `$ARGUMENTS` is empty, search ALL sources in `discovery_sources`. If `$ARGUMENTS` is a source name like "hn", restrict to that source.

   **Pick the right fetcher per source** (this matters — wrong fetcher = empty results):
   - **Algolia JSON APIs (HN Who's Hiring, RemoteOK):** use `Bash` with `curl` + `python3` for JSON parsing. Examples:
     - HN search: `curl -s "https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&restrictSearchableAttributes=title&hitsPerPage=5"` — match the latest "Who is hiring?" thread by title (filter to current month), grab its `objectID`. NOTE: the search result `objectID` is the story root.
     - HN thread comments: `curl -s "https://hn.algolia.com/api/v1/items/<id>"` — each top-level child is one job post. Use python3 to filter by stack/location/seniority.
     - RemoteOK: `curl -s -A "Mozilla/5.0 job-finder" "https://remoteok.com/api"` (JSON array, skip first metadata entry).
   - **Static HTML pages (Hasjob, WeWorkRemotely, individual JD pages):** use the `WebFetch` tool — it works for SSR/static markup.
   - **JS-rendered pages (YC Work at a Startup, Wellfound, Ashby/Greenhouse boards, individual JD pages on React-app careers):** use `Bash` with `node scripts/scrape-page.mjs <url> --scroll --max-text 25000`. This launches headless Chromium and extracts rendered innerText + links.
     - Add `--wait <selector>` if specific content needs more time.
     - Add `--json` if you need structured `{url, title, text, links}` output.
     - **Wellfound is bot-protected** (Cloudflare detects headless Chromium) — expect mostly empty results. Skip with a note rather than fabricating.
   - **LinkedIn:** Use the URL template, but expect partial data — treat as supplementary only. Most LinkedIn listing pages are behind a login wall even with Playwright.
   - **WebSearch** as fallback for specific role+location combos when other sources are sparse.

3. **Filter aggressively.** For each candidate job:
   - SKIP if title contains avoid_seniority_labels (Senior, Staff, Lead, Manager, Intern, etc.)
   - SKIP if company name matches preferences.json `company_preferences.avoid`
   - SKIP if title/JD contains avoid_role_keywords (.NET, PHP, Wordpress, Salesforce, SAP, Java-only, etc.)
   - SKIP if location is incompatible (not remote, not in preferences locations list)
   - SKIP if slug already exists in queue/applied/archived

4. **Score fit (1-10)** for each survivor. Scoring rubric:
   - +3 if matches a target_role_bucket primary or strong fit
   - +2 if uses 3+ primary skills (TS, Node, React, Next.js, SvelteKit, Postgres, Redis)
   - +2 if remote OR in preferred locations
   - +1 if mentions a rare-skill match from `profile.json.skills.specialty` (LLMs, design systems, niche frameworks, etc. — whatever the user listed as their edge)
   - +1 if from a preferred company type (YC, Indian product co, AI startup)
   - -2 if requires 5+ years experience
   - -2 if heavy specialization the user lacks (anything not in `profile.json.skills`)
   - Clamp to [1, 10]

5. **Detect apply_method** for each survivor:
   - If the JD body contains a clear "send your resume to <email>" / "email careers@..." pattern → `apply_method: "email"`, extract `apply_email`
   - If URL matches `boards.greenhouse.io` or `greenhouse.io/jobs` → `apply_method: "greenhouse"`
   - If URL matches `jobs.lever.co` → `apply_method: "lever"`
   - If URL matches `jobs.ashbyhq.com` or `ashbyhq.com` → `apply_method: "ashby"`
   - If URL matches `workday.com`, `myworkdayjobs.com`, `taleo.net`, `icims.com`, `linkedin.com/jobs/view` → `apply_method: "manual-required"` (these are explicitly blocked from auto-apply)
   - Otherwise → `apply_method: "generic"` (Playwright will try a best-effort label match)

6. **For each job with fit >= preferences.fit_score_thresholds.auto_queue (default 7):**
   - Generate a slug: `<company>-<role>-<YYYYMMDD>` lowercase, hyphenated, alphanumeric only. Example: `hasura-fullstack-engineer-20260518`
   - Create directory `jobs/queue/<slug>/`
   - Write `jobs/queue/<slug>/jd.md` with the full JD (or as much as you could fetch), the URL, company, role, location, posted date, salary if shown
   - Write `jobs/queue/<slug>/status.json`:
     ```json
     {
       "slug": "<slug>",
       "company": "<company>",
       "role": "<role>",
       "url": "<url>",
       "location": "<location>",
       "fit_score": <score>,
       "fit_reasons": ["<reason1>", "<reason2>"],
       "status": "queued",
       "discovered_at": "<ISO-8601>",
       "source": "<source name>",
       "apply_method": "<email | greenhouse | lever | ashby | generic | manual-required>",
       "apply_email": "<recipient email if apply_method is email, else null>",
       "tailored": false,
       "applied_at": null
     }
     ```

7. **For jobs scored `candidate` (>= 5 but < auto_queue):**
   - Append to `logs/runs/candidates-<YYYY-MM-DD>.md` for user review (don't auto-queue)

8. **Skip silently for jobs < 5.**

9. **Write a summary** at the end of your response:
   - Total candidates examined per source
   - Number queued (with slugs + scores)
   - Number saved as candidates
   - Top 3 picks with one-line reason
   - Note any sources that failed (rate-limited, blocked, etc.)

## Important rules

- **Never invent jobs.** Only queue jobs you actually fetched and read. If a source is blocked or empty, say so.
- **Always dedupe** against existing slugs before writing.
- **Always validate URLs** are real (the canonical job page, not a search results page).
- **Be honest about scoring.** A 6 is fine — don't inflate to make the queue look full.
- **Do NOT call any paid API.** Public web pages and free APIs only.
- If a JD requires login to read, skip it or note "JD behind login wall — review at <url>" instead of fabricating content.

Start by loading profile and preferences, then proceed.
