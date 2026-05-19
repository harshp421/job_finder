#!/usr/bin/env node
// scripts/send-email.mjs <slug> | --all
//
// Autonomously sends a tailored email application via SMTP (nodemailer).
// Reads:
//   - profile/apply_config.json  → from name, links
//   - jobs/queue/<slug>/status.json (must have apply_method:"email", apply_email)
//   - jobs/queue/<slug>/cover_letter.md → body (strips a leading "Subject:" line if present)
//   - jobs/queue/<slug>/resume_tailored.pdf  (preferred)
//     or  profile/resume_base.pdf            (fallback)
//
// On success:
//   - logs full send (messageId) into the job's status.json + applied-log
//   - moves jobs/queue/<slug>/ → jobs/applied/<slug>/
//
// Usage:
//   node scripts/send-email.mjs threatmark-backend-engineer-20260519
//   node scripts/send-email.mjs --all      # all email-apply jobs in queue with tailored:true
//   node scripts/send-email.mjs --dry-run --all   # show what would be sent, don't send
//
// Env (.env):
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
//   SMTP_FROM_NAME, SMTP_FROM_EMAIL, SMTP_BCC (optional)
//
// Exit codes:
//   0 success, 1 generic error, 2 config not ready, 3 no matching job

import 'dotenv/config';
import { readFile, writeFile, rename, appendFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ALL = argv.includes('--all');
const slugArg = argv.find(a => !a.startsWith('--'));

// ── SMTP setup ──────────────────────────────────────────────────────────────
const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter(k => !process.env[k] || /paste-your/i.test(process.env[k]));
if (missing.length) {
  console.error('SMTP env not configured. Missing or placeholder:', missing.join(', '));
  console.error('Copy .env.example → .env and fill in real values. See .env.example for Gmail App Password setup.');
  process.exit(2);
}
// Fallbacks: from-email defaults to SMTP_USER if not set
if (!process.env.SMTP_FROM_EMAIL) process.env.SMTP_FROM_EMAIL = process.env.SMTP_USER;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: String(process.env.SMTP_SECURE).toLowerCase() !== 'false', // default true (port 465)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Pick the apply list ─────────────────────────────────────────────────────
function jobsFromQueue() {
  const queueDir = path.join(PROJECT_ROOT, 'jobs/queue');
  if (!existsSync(queueDir)) return [];
  return readdirSync(queueDir)
    .filter(s => !s.startsWith('.'))
    .map(slug => ({ slug, dir: path.join(queueDir, slug) }));
}

let targets = [];
if (slugArg) {
  const dir = path.join(PROJECT_ROOT, 'jobs/queue', slugArg);
  if (!existsSync(dir)) {
    console.error(`Slug not in queue: ${slugArg}`);
    process.exit(3);
  }
  targets = [{ slug: slugArg, dir }];
} else if (ALL) {
  targets = jobsFromQueue();
} else {
  console.error('Usage: node scripts/send-email.mjs <slug> | --all   [--dry-run]');
  process.exit(1);
}

// Load apply config early to enforce quality gates
const cfg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'profile/apply_config.json'), 'utf8'));
const REQUIRE_PER_JD = cfg.require_per_jd_tailoring_for_email !== false; // default true
const MAX_PER_RUN = Number(cfg.max_email_applies_per_run ?? cfg.max_applies_per_run ?? 10);

// Filter to email-apply, tailored, not-yet-applied
const valid = [];
const skipped = [];
for (const t of targets) {
  const sp = path.join(t.dir, 'status.json');
  if (!existsSync(sp)) continue;
  const status = JSON.parse(await readFile(sp, 'utf8'));
  if (status.status === 'applied') {
    skipped.push(`${t.slug}: already applied`);
    continue;
  }
  if (status.apply_method !== 'email') {
    if (slugArg) skipped.push(`${t.slug}: apply_method=${status.apply_method} (not 'email')`);
    continue;
  }
  if (!status.apply_email) {
    skipped.push(`${t.slug}: missing apply_email`);
    continue;
  }
  if (!status.tailored && !slugArg) {
    skipped.push(`${t.slug}: not tailored yet`);
    continue;
  }
  // Quality gate: per-JD tailoring required (unless single-slug override)
  if (REQUIRE_PER_JD && !slugArg) {
    if (!status.tailored_per_jd) {
      skipped.push(`${t.slug}: tailored_per_jd=false (templated bulk apply blocked by require_per_jd_tailoring_for_email)`);
      continue;
    }
    const tailoredPdf = path.join(t.dir, 'resume_tailored.pdf');
    if (!existsSync(tailoredPdf)) {
      skipped.push(`${t.slug}: resume_tailored.pdf missing (per-JD PDF required)`);
      continue;
    }
  }
  valid.push({ ...t, status, statusPath: sp });
}

// Apply max-per-run cap (sort by fit_score desc so we send the best first)
valid.sort((a, b) => (b.status.fit_score || 0) - (a.status.fit_score || 0));
const capped = valid.slice(0, MAX_PER_RUN);
const deferred = valid.slice(MAX_PER_RUN);

if (!capped.length) {
  console.error('No matching email-apply jobs ready to send.');
  if (skipped.length) {
    console.error('Skipped:');
    for (const s of skipped) console.error(`  - ${s}`);
  }
  console.error(`\nGate: require_per_jd_tailoring_for_email=${REQUIRE_PER_JD}, max_email_applies_per_run=${MAX_PER_RUN}`);
  console.error('Override either by setting in profile/apply_config.json, or pass a single slug to send-email.mjs to bypass the per-JD gate for that one job.');
  process.exit(3);
}

console.log(`Sending ${capped.length} email-apply job(s) (max_email_applies_per_run=${MAX_PER_RUN}, per-JD gate=${REQUIRE_PER_JD}):`);
for (const v of capped) console.log(`  ✓ ${v.slug} → ${v.status.apply_email}  (fit=${v.status.fit_score})`);
if (deferred.length) {
  console.log(`\nDeferred (over cap, will send next run):`);
  for (const v of deferred) console.log(`  · ${v.slug} → ${v.status.apply_email}`);
}
if (skipped.length) {
  console.log(`\nSkipped (gate / state):`);
  for (const s of skipped) console.log(`  · ${s}`);
}

// ── Verify SMTP connection once before sending ──────────────────────────────
if (!DRY_RUN) {
  try {
    await transporter.verify();
    console.log(`SMTP OK (${process.env.SMTP_HOST}:${process.env.SMTP_PORT})`);
  } catch (err) {
    console.error(`SMTP verify failed: ${err.message}`);
    console.error('Common causes: wrong app password, 2FA not enabled, or SMTP_USER mismatch.');
    process.exit(1);
  }
}

const results = [];
for (const v of capped) {
  try {
    const result = await sendOne(v);
    results.push({ slug: v.slug, ok: true, ...result });
  } catch (err) {
    console.error(`[${v.slug}] ERROR: ${err.message}`);
    results.push({ slug: v.slug, ok: false, error: err.message });
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n— Send summary —');
for (const r of results) {
  if (r.ok) console.log(`  ✅ ${r.slug} → ${r.to}  (id=${r.messageId})`);
  else console.log(`  ❌ ${r.slug}  ${r.error}`);
}

process.exit(results.some(r => !r.ok) ? 1 : 0);

// ════════════════════════════════════════════════════════════════════════════

async function sendOne(v) {
  const { slug, dir, status } = v;

  // 1. Resolve resume PDF
  const tailoredPdf = path.join(dir, 'resume_tailored.pdf');
  const basePdf = path.join(PROJECT_ROOT, 'profile/resume_base.pdf');
  let pdfPath;
  if (existsSync(tailoredPdf)) pdfPath = tailoredPdf;
  else if (existsSync(basePdf)) pdfPath = basePdf;
  else throw new Error(`No resume PDF found (looked at ${tailoredPdf} and ${basePdf})`);

  // 2. Read cover letter
  const coverPath = path.join(dir, 'cover_letter.md');
  if (!existsSync(coverPath)) throw new Error('cover_letter.md missing');
  const coverRaw = await readFile(coverPath, 'utf8');

  // 3. Extract subject (from cover letter "Subject:" line, else from status, else default)
  let subject;
  let body = coverRaw;
  const subjectMatch = coverRaw.match(/^Subject:\s*(.+)$/m);
  if (subjectMatch) {
    subject = subjectMatch[1].trim();
    body = coverRaw.replace(/^Subject:\s*.+\n+/m, '').trim();
  } else if (status.apply_subject_required) {
    subject = status.apply_subject_required;
  } else {
    subject = `Application — ${status.role || 'Engineering Role'} — ${cfg.full_name}`;
  }

  // 4. Render body — HTML (via marked) + clean plain-text fallback
  const html = renderHtmlEmail(body);
  const text = renderPlainText(body);

  // 5. Compose
  const from = `"${process.env.SMTP_FROM_NAME || cfg.full_name}" <${process.env.SMTP_FROM_EMAIL || cfg.email}>`;
  const bcc = process.env.SMTP_BCC || undefined;

  const mail = {
    from,
    to: status.apply_email,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `${cfg.last_name || 'Candidate'}_${cfg.first_name || 'Resume'}_Resume.pdf`,
        path: pdfPath,
        contentType: 'application/pdf',
      },
    ],
    headers: {
      'X-Sent-By': 'job_finder/send-email.mjs',
    },
  };
  if (bcc) mail.bcc = bcc;

  console.log(`\n[${slug}] → ${status.apply_email}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Attach:  ${path.relative(PROJECT_ROOT, pdfPath)}`);

  if (DRY_RUN) {
    console.log('  DRY-RUN — not sending');
    return { to: status.apply_email, subject, messageId: 'dry-run' };
  }

  const info = await transporter.sendMail(mail);
  console.log(`  ✅ sent (messageId=${info.messageId})`);

  // 5. Mark applied + move folder
  await markApplied(v, { to: status.apply_email, subject, messageId: info.messageId, pdfUsed: path.relative(PROJECT_ROOT, pdfPath) });

  return { to: status.apply_email, subject, messageId: info.messageId };
}

async function markApplied(v, sendInfo) {
  const { slug, dir, status } = v;
  const now = new Date().toISOString();

  status.status = 'applied';
  status.applied_at = now;
  status.apply_recipient = sendInfo.to;
  status.apply_subject = sendInfo.subject;
  status.apply_smtp_message_id = sendInfo.messageId;
  status.apply_pdf_used = sendInfo.pdfUsed;
  await writeFile(path.join(dir, 'status.json'), JSON.stringify(status, null, 2));

  // Move queue/<slug> → applied/<slug>
  const appliedDir = path.join(PROJECT_ROOT, 'jobs/applied', slug);
  // Ensure no clobber
  if (existsSync(appliedDir)) {
    console.warn(`  ⚠ applied/${slug} already exists — keeping job in queue/`);
  } else {
    await rename(dir, appliedDir);
  }

  // Append to log
  const logLine = `- ${now.slice(0, 16).replace('T', ' ')} — ${status.company} — ${status.role} — ${slug} — smtp-email (${sendInfo.to})\n`;
  await appendFile(path.join(PROJECT_ROOT, 'logs/runs/applied-log.md'), logLine);
}

// ── Email rendering ─────────────────────────────────────────────────────────

function renderHtmlEmail(markdownBody) {
  // marked → HTML for paragraphs, lists, links, bold/italic
  marked.setOptions({ breaks: false, gfm: true });
  const inner = marked.parse(markdownBody);

  // Lightweight, mail-client-safe wrapper. Inline styles (Gmail/Outlook friendly).
  // System font stack mirrors how a normal person's email client would render.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#ffffff;">
<tr><td align="left" style="padding:0;">
<div style="
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: #202124;
  max-width: 640px;
  padding: 0 8px;
">
${inner.trim()}
</div>
</td></tr>
</table>
</body>
</html>`;
}

function renderPlainText(markdownBody) {
  // Strip markdown so plain-text clients see clean prose, not raw "**" markers.
  return markdownBody
    .replace(/\*\*(.+?)\*\*/g, '$1')          // bold
    .replace(/__(.+?)__/g, '$1')              // bold alt
    .replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1$2$3') // italic (avoid stars in middle)
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // links
    .replace(/^\s*[-*]\s+/gm, '• ')           // bullets
    .replace(/\n{3,}/g, '\n\n')               // collapse extra blanks
    .trim();
}
