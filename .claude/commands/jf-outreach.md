---
description: Draft personalized cold outreach emails to founders/hiring managers at top-fit companies. Drafts only — user reviews before sending.
argument-hint: [optional: company name to target a specific company, otherwise picks from top-queue]
allowed-tools: Read, Write, Bash, WebSearch, WebFetch
---

You are the **cold outreach** stage. Run from the repository root.

## Your job

1. **Load context:**
   - Read `profile/profile.json`, `profile/preferences.json`, `profile/resume_base.md`
   - List existing drafts in `outreach/drafts/` and sent log `outreach/sent/log.md` (if exists) — for dedupe

2. **Pick targets:**
   - If `$ARGUMENTS` is a company name: target that company.
   - Otherwise: read top 5 jobs from `jobs/queue/` (by fit_score), AND consider any "candidate" companies from logs/runs/candidates-*.md. Also surface 2-3 companies from preferences.json `company_preferences.preferred` that don't currently have a queued job — these are speculative outreach.

3. **For each target company, research:**
   - WebFetch the company's homepage and About/Team page
   - WebSearch `<company> founder` or `<company> CEO` and `<company> hiring manager engineering` — find names
   - WebSearch `<company> blog` or LinkedIn previews — find something specific and recent (a launch, a blog post, a podcast appearance)
   - **Stop if you can't find:** (a) a specific human name, AND (b) something specific to reference. Generic outreach gets ignored — better to skip than send slop.

4. **Draft a cold email** to `outreach/drafts/<company>-<role-or-generic>-<YYYYMMDD>.md`. Format:

   ```markdown
   ---
   to: <name@company.com — if found; else "TBD (research recipient)">
   to_name: <Person Name>
   to_title: <Their title>
   from: <preferences.json:email_for_outreach_from>
   subject: <subject line>
   company: <Company>
   target_role: <role they might hire for>
   status: draft
   drafted_at: <ISO-8601>
   ---

   Hi <FirstName>,

   <Specific opening that references the recent thing you found — blog, launch, podcast, hiring goal. ONE sentence. Not flattery.>

   <Second paragraph: ONE relevant achievement from profile.json.achievements_headline that maps to their stage/problem. Specific number, specific tech. Not a wall.>

   <Third paragraph: clear ask. Either "are you hiring an [Engineer]?" if they have open roles, or "would you be open to a 15-min chat about [their specific problem]?" if speculative.>

   Portfolio: <profile.json:links.portfolio>
   GitHub: <profile.json:links.github>
   <One signature project line if relevant — e.g. an open-source library or product link from apply_config.json.other_links>

   Thanks,
   <profile.json:name first-name>
   ```

5. **Subject line rules:**
   - Lowercase, no clickbait, no emoji
   - Either: "<specific reference> + <quick ask>" OR "<company> + <role> — quick question"
   - Examples: "loved your serverless-pg blog — quick question on hiring", "full-stack engineer interested in <Company>"
   - Max ~50 chars

6. **Output a summary:**
   - For each draft: company, recipient (or "TBD"), subject line, file path
   - **Important reminder to user:** drafts are NOT sent. Open each, edit if needed, then send manually from the address in `preferences.json.email_for_outreach_from`.
   - Note any company you skipped and why (e.g., couldn't find a recipient, no specific reference to anchor the email).

## Important rules

- **Never auto-send.** Drafts only. If Gmail MCP is connected to an address listed in `preferences.json.do_not_send_from`, sending from there would be wrong. User sends manually from the address in `preferences.json.email_for_outreach_from`.
- **Never invent details about the company.** If you can't find the launch/blog/news, don't make one up. Skip the company.
- **One ask per email.** Don't combine "hiring?" + "feedback?" + "let's grab coffee?"
- **Don't dump the resume.** Three short paragraphs. The links speak for themselves.
- **Skip companies in preferences.json `company_preferences.avoid`.**
- **Dedupe:** if a draft already exists for the same company within the last 14 days, skip — note in summary.
