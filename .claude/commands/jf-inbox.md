---
description: Check Gmail for job-related replies (interviews, rejections, recruiter outreach) and surface a summary.
argument-hint: [optional: number of days back, default 3]
allowed-tools: Read, Write, Bash, mcp__claude_ai_Gmail__authenticate, mcp__claude_ai_Gmail__complete_authentication
---

You are the **inbox watcher**. Run from the repository root.

## Important caveat

For this command to give meaningful results, the Gmail MCP must be authenticated to the same address that the pipeline applies from (`preferences.json.email_for_applications`).

**On first run:** check which Gmail account is connected. If it's an address listed in `preferences.json.do_not_send_from` (e.g. a work email), or if it doesn't match `email_for_applications`, output a clear note to the user explaining how to reconnect to the right Gmail and stop. Do not fabricate results.

## Your job (once correctly authed)

1. **Determine lookback window** — `$ARGUMENTS` is days; default 3.

2. **Search Gmail** for messages within the window matching job-related signals:
   - From senders containing: `recruiter`, `talent`, `careers`, `hiring`, `hr`, `people`, `team@`, `noreply` from known ATS systems (greenhouse, lever, workable, ashby, smartrecruiters)
   - Subject containing: `application`, `interview`, `position`, `role`, `opportunity`, `next steps`, `follow up`, `update on your`, `regarding your`
   - List the matching message IDs, subjects, senders, and first 200 chars

3. **Classify each message** into:
   - **Interview request** — they want to schedule
   - **Recruiter outreach** — new inbound (not a reply to your app)
   - **Application acknowledged** — auto-confirmation, low priority
   - **Rejection** — closed loop
   - **Follow-up needed** — they asked a question
   - **Other / unclear**

4. **Cross-reference with applied jobs:**
   - List slugs in `jobs/applied/`
   - For each interview/rejection/follow-up: try to match the sender's company to an applied job's `company` field in status.json
   - If matched, update that job's status.json: append a `correspondence` array entry `{date, type, subject, snippet, gmail_message_id}`
   - If rejection: set `status: "rejected"` and move folder to `jobs/archived/`

5. **Write a digest** to `email/digest/<YYYY-MM-DD>.md`:

   ```markdown
   # Inbox digest — <date>

   ## Action needed (top of inbox)
   - [Interview] <Company> — <subject> — scheduled link: <if any>
   - [Follow-up] <Company> — they asked: "<question>"

   ## Inbound recruiter outreach
   - <Company> — <subject> — [reply or ignore?]

   ## Closed
   - [Rejected] <Company> — <role>

   ## Auto-confirmations (no action)
   - <count> messages

   ## Suggested next actions
   - <ordered list of specific things the user should do>
   ```

6. **Output the digest in the response** AND save to file.

## Important rules

- **Never auto-reply.** Surface, classify, suggest. The user writes the actual reply.
- **Never delete or archive Gmail messages.** Read-only.
- **Don't act on uncertain matches.** If a sender's company is unclear, leave the status alone and flag in the digest.
- **PII safety:** the digest may contain recruiter names/emails. That's fine — local file. Don't send this digest anywhere, and never commit `email/digest/` (already in `.gitignore`).
