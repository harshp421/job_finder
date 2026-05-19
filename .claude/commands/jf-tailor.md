---
description: Tailor the base resume, write a cover letter, generate PDF, and pre-fill application answers for a queued job. Pass a slug, or "all".
argument-hint: <job-slug> | all
allowed-tools: Read, Write, Edit, Bash
---

You are the **tailoring** stage of the job-search pipeline. Run from the repository root.

## Inputs

- `$ARGUMENTS` — either a specific slug (e.g. `hasura-fullstack-engineer-20260518`) or the literal string `all`.

## Your job

1. **Load the user's base materials:**
   - Read `profile/resume_base.md` (canonical resume)
   - Read `profile/profile.json` (skills, achievements_headline)
   - Read `profile/preferences.json` (email_for_applications)

2. **Resolve targets:**
   - If `$ARGUMENTS == "all"`: list every directory in `jobs/queue/`, read their `status.json`, work only on jobs where `tailored == false`.
   - Otherwise: target is `jobs/queue/$ARGUMENTS/`.

3. **For each target job, do all of the following:**

   **a. Re-read the JD** at `jobs/queue/<slug>/jd.md`.

   **b. Extract JD keywords** — required skills, must-haves, nice-to-haves, years required, tech stack, the company's mission/product. List them in your working notes.

   **c. Identify gaps and edges:**
   - Which of the user's skills/achievements directly match? (emphasize these)
   - Which JD requirements does the user weakly match or miss? (acknowledge honestly, don't fabricate)
   - What's the strongest narrative thread? (e.g. "scaling experience", "design systems", "shipped LLM apps")

   **d. Write `jobs/queue/<slug>/resume_tailored.md`:**
   - Keep the same structure as `resume_base.md` (Skills, Experience, Projects, Education).
   - **Reorder skill categories** so the JD's stack appears first.
   - **Reorder bullets** within each role so the most JD-relevant bullets are on top.
   - **Rephrase bullets** to use the JD's vocabulary where truthful (e.g. if JD says "distributed systems", and the user's bullet about Redis/caching is genuinely distributed-systems work, use that phrase).
   - **Cut** bullets that have zero relevance to keep it ~1 page worth of content.
   - **Never invent experience.** Only re-frame existing facts. If the user did not do X, do not claim X.
   - Top of file: keep the same header (name, contact, links).

   **e. Write `jobs/queue/<slug>/cover_letter.md`:**
   - 3 short paragraphs, ~150–220 words total.
   - Para 1: Why this company / why now (reference something specific about the product/mission you saw in the JD — not generic flattery).
   - Para 2: The single strongest reason the user fits this role. Pick ONE achievement from `profile.json.achievements_headline` that maps most directly. Add 1-2 sentences of specificity.
   - Para 3: Soft close — what the user is looking for, mention `profile.json.links.portfolio` (and any signature project from `apply_config.json.other_links`) if relevant to the role.
   - No clichés ("passionate", "team player", "synergy"). No emoji.

   **f. Write `jobs/queue/<slug>/fit_analysis.md`:**
   - "Why it's a fit" — 2-4 bullets
   - "Gaps / risks" — 1-3 honest bullets (helps the user prep for interviews)
   - "Salary signal" — note any comp info from JD or inference
   - "Interview prep" — 2-3 likely topics they'll dig into based on the JD

   **g. Write `jobs/queue/<slug>/application_answers.md`:**
   - Pre-fill answers to common application questions (90% of forms ask these):
     - "Why this company?" (3-4 sentences, specific)
     - "Why are you a fit?" (3-4 sentences, lead with strongest achievement)
     - "Years of experience with [primary stack]?" (look at JD's primary stack, give honest number)
     - "Notice period?" — pull from `apply_config.json.notice_period`
     - "Current CTC / Expected CTC?" — pull from `apply_config.json.current_ctc_inr_lpa` / `expected_ctc_inr_lpa_min` / `expected_ctc_inr_lpa_max` (or the USD equivalents for international jobs)
     - "Authorized to work in <country>?" — pull from `apply_config.json.work_authorization`
     - "How did you hear about us?" — note the source from status.json, fall back to `apply_config.json.default_open_text_answers.heard_from_default`
     - "Portfolio / Github / LinkedIn URLs" — pre-fill from `profile.json.links`
     - "Available start date?" — pull from `apply_config.json.earliest_start_date_iso`

   **h. Generate the resume PDF** via Bash:
   ```bash
   node scripts/md-to-pdf.mjs jobs/queue/<slug>/resume_tailored.md jobs/queue/<slug>/resume_tailored.pdf
   ```
   If the command fails (e.g., playwright not installed), note in the summary that the user must run `bash scripts/setup.sh` first. Don't block the rest of tailoring — markdown is still usable.

   **i. Update `jobs/queue/<slug>/status.json`:**
   - Set `tailored: true`
   - Set `tailored_at: <ISO-8601>`
   - **Set `tailored_per_jd: true`** — required for `scripts/send-email.mjs` to send. Means: resume_tailored.md, cover_letter.md, and resume_tailored.pdf were ALL written specifically against THIS job's JD (not a templated batch). The send script refuses to send emails without this flag.
   - Set `resume_pdf_path: "resume_tailored.pdf"` if the PDF was generated successfully
   - Use Edit tool with the JSON field swap (don't rewrite the whole file).

4. **Output a summary** at the end:
   - Each job tailored: slug, fit_score, 1-line strongest pitch
   - Total tailored this run
   - Any jobs skipped and why (e.g., JD too sparse to tailor meaningfully)

## Important rules

- **Per-JD, never templated.** Each job gets its own resume_tailored.md, cover_letter.md, and resume_tailored.pdf. **NEVER reuse a shared cover-letter template across multiple jobs.** The cover letter must reference ≥1 concrete thing from THIS job's JD (a product feature, customer name, technical detail, or metric — not a paraphrase of "your mission"). If you can't, the JD is too thin to apply to — skip and note it.
- **Set `tailored_per_jd: true`** only after the above. This flag is the gate that lets `send-email.mjs` actually send.
- **Truth over polish.** Never invent or inflate. Re-framing existing facts in JD vocabulary is fine; claiming experience the user doesn't have is not.
- **One page worth.** If `resume_tailored.md` is much longer than `resume_base.md`, cut weakest bullets.
- **Match register.** A YC seed startup cover letter sounds different from an enterprise SaaS cover letter. Mirror the JD's tone.
- **Skip gracefully.** If a JD is too sparse (3 lines, no real info), set `tailored: false` and `tailored_per_jd: false`, and note "JD too sparse — would need user to supply more context or archive this listing" in fit_analysis.md. Do NOT bulk-template just to fill the queue.
