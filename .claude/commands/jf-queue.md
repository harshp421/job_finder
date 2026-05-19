---
description: Show the review queue — all queued jobs sorted by fit score with their materials.
argument-hint: [optional: untailored | tailored | top | all] (default all)
allowed-tools: Read, Bash
---

You are the **queue browser**. Run from the repository root.

## Your job

1. **List queue contents:** Run `ls jobs/queue/` to get all slugs.
2. **Read each `status.json`** and aggregate.
3. **Filter by `$ARGUMENTS`:**
   - `untailored` — only jobs where `tailored == false`
   - `tailored` — only jobs where `tailored == true`
   - `top` — only top 5 by fit_score
   - `all` or empty — show all
4. **Sort by fit_score descending**, then by discovered_at descending.

## Output format (markdown)

```
# Job Review Queue (<count> total, <count> ready to apply)

## Ready to apply (tailored)

| Fit | Company | Role | Location | Source | Slug |
|-----|---------|------|----------|--------|------|
| 9 | Hasura | Full Stack Engineer | Remote (India) | wellfound | hasura-fullstack-engineer-20260518 |
...

## Awaiting tailoring

| Fit | Company | Role | Location | Source | Slug |
...
```

Then for each **tailored** job, output a compact card with clickable file links:

```
### <Company> — <Role>  (fit: <score>/10)
- **URL:** <job_url>
- **Apply with:**
  - [Tailored resume](jobs/queue/<slug>/resume_tailored.md)
  - [Cover letter](jobs/queue/<slug>/cover_letter.md)
  - [Application answers](jobs/queue/<slug>/application_answers.md)
  - [Fit analysis](jobs/queue/<slug>/fit_analysis.md)
- **Next:** Apply at the URL, then run `/jf-mark-applied <slug>`
```

At the end, output 3 tips:
- "Run `/jf-tailor all` to tailor any untailored jobs."
- "Run `/jf-mark-applied <slug>` after you submit."
- "Run `/jf-archive <slug>` to remove a job you don't want."

## Important rules

- **Don't fabricate.** If `jobs/queue/` is empty, say so cleanly and suggest running `/jf-discover`.
- **Don't read the full JDs** — just metadata from `status.json`. Keep this fast.
- All file paths in output should be **relative** so the VS Code extension renders them clickable.
