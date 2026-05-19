#!/usr/bin/env node
// scripts/auto-apply.mjs <slug> [--submit] [--headful]
//
// Auto-applies to a queued job using Playwright. Recognizes Greenhouse, Lever, Ashby;
// best-effort generic fill for unknown ATS.
//
// Modes:
//   default       — fill the form, screenshot as preview.png, do NOT click submit
//   --submit      — actually click submit (also enabled if apply_config.json has auto_submit:true)
//   --headful     — open a visible browser window (default: headless)
//
// Exit codes:
//   0  success (submitted, or filled in dry-run)
//   1  general failure
//   2  config not ready (TODO fields, missing resume PDF, etc.)
//   3  unsupported / blocked ATS
//   4  too many unhandled questions — skipped, marked for review

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SLUG = process.argv[2];
const FORCE_SUBMIT = process.argv.includes('--submit');
const HEADFUL = process.argv.includes('--headful') || process.env.HEADFUL === '1';

if (!SLUG) {
  console.error('Usage: node scripts/auto-apply.mjs <slug> [--submit] [--headful]');
  process.exit(1);
}

const queueDir = path.join(PROJECT_ROOT, 'jobs/queue', SLUG);
if (!existsSync(queueDir)) {
  console.error(`Slug not found in jobs/queue/: ${SLUG}`);
  process.exit(1);
}

// ── Load all inputs ─────────────────────────────────────────────────────────
const status = JSON.parse(await readFile(path.join(queueDir, 'status.json'), 'utf8'));
const cfg = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'profile/apply_config.json'), 'utf8'));
const coverLetter = await readFileSafe(path.join(queueDir, 'cover_letter.md'));
const answersDoc = await readFileSafe(path.join(queueDir, 'application_answers.md'));
const resumePdf = path.join(queueDir, 'resume_tailored.pdf');

if (status.status === 'applied') {
  console.log(`[${SLUG}] already applied — skipping`);
  process.exit(0);
}
if (!status.url) {
  console.error(`[${SLUG}] status.json missing 'url'`);
  process.exit(2);
}

// Block known-bad ATS
const blocked = (cfg.form_submission_safety?.skip_if_url_contains || []).find(s => status.url.includes(s));
if (blocked) {
  console.error(`[${SLUG}] URL matches blocked pattern '${blocked}' — leaving in queue for manual apply`);
  await patchStatus({ apply_method: 'manual-required', last_skip_reason: `blocked-domain:${blocked}` });
  process.exit(3);
}

// Validate config
const todos = findTodos(cfg);
if (todos.length) {
  console.error(`apply_config.json has unfilled TODO fields: ${todos.join(', ')}`);
  process.exit(2);
}

if (!existsSync(resumePdf)) {
  console.error(`Resume PDF missing: ${resumePdf}`);
  console.error(`Run: node scripts/md-to-pdf.mjs jobs/queue/${SLUG}/resume_tailored.md`);
  process.exit(2);
}

const ats = detectATS(status.url);
const willSubmit = FORCE_SUBMIT || cfg.auto_submit === true;

console.log(`[${SLUG}] ATS=${ats}  mode=${willSubmit ? 'SUBMIT' : 'DRY-RUN'}  url=${status.url}`);

// ── Pre-extract open-text answers from application_answers.md ──────────────
const answers = parseAnswersDoc(answersDoc, cfg);

// ── Launch browser ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: !HEADFUL });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1024 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

let unhandled = [];
let result = { ok: false, error: null };

try {
  await page.goto(status.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});

  // Two-step flow handling: some ATS show the JD on the landing page with an
  // "Apply for this job" button that reveals the form. Click it before filling.
  await clickApplyEntryIfPresent(page);

  if (ats === 'greenhouse')      unhandled = await fillGreenhouse(page);
  else if (ats === 'lever')      unhandled = await fillLever(page);
  else if (ats === 'ashby')      unhandled = await fillAshby(page);
  else                           unhandled = await fillGeneric(page);

  const cap = cfg.form_submission_safety?.skip_if_more_than_n_unknown_questions ?? 3;
  if (unhandled.length > cap) {
    console.error(`[${SLUG}] ${unhandled.length} unhandled questions (cap=${cap}) — refusing to submit`);
    console.error(`  Unhandled: ${unhandled.join(' | ')}`);
    await page.screenshot({ path: path.join(queueDir, 'too-many-unknowns.png'), fullPage: true });
    await patchStatus({ last_skip_reason: 'too-many-unhandled-questions', unhandled_questions: unhandled });
    result = { ok: false, error: 'too-many-unhandled' };
    process.exitCode = 4;
  } else {
    const shotName = willSubmit ? 'pre-submit.png' : 'preview.png';
    await page.screenshot({ path: path.join(queueDir, shotName), fullPage: true });

    if (!willSubmit) {
      console.log(`[${SLUG}] DRY-RUN ok — review ${shotName} before flipping auto_submit:true`);
      result = { ok: true, error: null };
    } else {
      const submitted = await clickSubmit(page);
      if (!submitted) throw new Error('submit button not found');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.screenshot({ path: path.join(queueDir, 'submitted.png'), fullPage: true });
      await markApplied();
      console.log(`[${SLUG}] ✅ submitted`);
      result = { ok: true, error: null };
    }
  }
} catch (err) {
  result = { ok: false, error: err.message };
  console.error(`[${SLUG}] ERROR: ${err.message}`);
  try { await page.screenshot({ path: path.join(queueDir, 'error.png'), fullPage: true }); } catch {}
  await patchStatus({ last_error: err.message, apply_attempts: (status.apply_attempts || 0) + 1 });
  process.exitCode = 1;
} finally {
  await browser.close();
}

// ════════════════════════════════════════════════════════════════════════════
//   ATS-specific fillers
// ════════════════════════════════════════════════════════════════════════════

async function fillGreenhouse(page) {
  const unhandled = [];
  await typeIfExists(page, 'input#first_name', cfg.first_name);
  await typeIfExists(page, 'input#last_name', cfg.last_name);
  await typeIfExists(page, 'input#email', cfg.email);
  await typeIfExists(page, 'input#phone', cfg.phone);

  // Resume upload (multiple variants)
  await uploadFile(page, ['input[type=file]#resume', 'input[type=file][name*=resume]', 'input[type=file][aria-label*=resume i]'], resumePdf);

  // Cover letter (some Greenhouse forms have a textarea)
  await typeIfExists(page, 'textarea[name*=cover_letter]', coverLetter);

  // Custom question blocks: .field, .application-question
  const blocks = await page.locator('div.field, div.application-question, fieldset').all();
  for (const block of blocks) {
    const labelEl = block.locator('label, legend').first();
    const label = ((await labelEl.textContent().catch(() => '')) || '').trim();
    if (!label) continue;
    const handled = await fillBlockByLabel(page, block, label);
    if (!handled) unhandled.push(label.replace(/\s+/g, ' ').slice(0, 60));
  }
  return unhandled;
}

async function fillLever(page) {
  const unhandled = [];
  await typeIfExists(page, 'input[name=name]', cfg.full_name);
  await typeIfExists(page, 'input[name=email]', cfg.email);
  await typeIfExists(page, 'input[name=phone]', cfg.phone);
  await typeIfExists(page, 'input[name=org]', cfg.current_employer);
  await typeIfExists(page, 'input[name=urls\\[LinkedIn\\]], input[name="urls[LinkedIn]"]', cfg.linkedin);
  await typeIfExists(page, 'input[name=urls\\[GitHub\\]], input[name="urls[GitHub]"]',  cfg.github);
  await typeIfExists(page, 'input[name=urls\\[Portfolio\\]], input[name="urls[Portfolio]"]', cfg.portfolio);

  await uploadFile(page, ['input[type=file][name=resume]', 'input[type=file]#resume-upload-input', 'input[type=file]'], resumePdf);

  // Lever custom cards
  const cards = await page.locator('ul.application-additional > li, div.application-question').all();
  for (const card of cards) {
    const label = ((await card.locator('label, .application-label').first().textContent().catch(() => '')) || '').trim();
    if (!label) continue;
    const handled = await fillBlockByLabel(page, card, label);
    if (!handled) unhandled.push(label.slice(0, 60));
  }
  return unhandled;
}

async function fillAshby(page) {
  const unhandled = [];
  // Ashby fields tend to use [aria-label] or [data-testid]. We iterate inputs and look up labels.
  const fields = await page.locator('input:not([type=hidden]), textarea, select').all();
  for (const f of fields) {
    const tagName = await f.evaluate(el => el.tagName.toLowerCase());
    const type = (await f.getAttribute('type') || tagName).toLowerCase();
    const label = await findAssociatedLabel(f);
    if (!label) continue;
    if (type === 'file') {
      if (/resume|cv/i.test(label)) await f.setInputFiles(resumePdf).catch(() => {});
      continue;
    }
    const handled = await fillFieldByLabel(f, type, label);
    if (!handled) unhandled.push(label.slice(0, 60));
  }
  return unhandled;
}

async function fillGeneric(page) {
  // Best-effort: same as Ashby — iterate inputs and look up labels.
  return fillAshby(page);
}

// ════════════════════════════════════════════════════════════════════════════
//   Field-fill helpers
// ════════════════════════════════════════════════════════════════════════════

async function fillBlockByLabel(page, blockLocator, label) {
  const input = blockLocator.locator('input:not([type=hidden]), textarea, select').first();
  if (await input.count() === 0) return true; // nothing fillable here, skip silently
  const tagName = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  const type = (await input.getAttribute('type').catch(() => null)) || tagName;
  return fillFieldByLabel(input, type, label);
}

async function fillFieldByLabel(field, type, label) {
  const answer = matchAnswerByLabel(label);
  if (answer === null) return false;

  try {
    if (type === 'select-one' || type === 'select') {
      // Try select by exact label, then by partial match
      const opts = await field.locator('option').all();
      let matched = false;
      for (const opt of opts) {
        const txt = ((await opt.textContent()) || '').trim();
        if (txt.toLowerCase() === String(answer).toLowerCase()) {
          await field.selectOption({ label: txt });
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (const opt of opts) {
          const txt = ((await opt.textContent()) || '').trim().toLowerCase();
          if (txt.includes(String(answer).toLowerCase())) {
            await field.selectOption({ label: (await opt.textContent()).trim() });
            matched = true;
            break;
          }
        }
      }
      return matched;
    }
    if (type === 'checkbox' || type === 'radio') {
      // For radio groups, try the option that matches our answer
      // (Caller should pass us the radio input directly; we click it if answer is truthy)
      if (typeof answer === 'boolean') {
        if (answer) await field.check({ force: true }).catch(() => {});
        return true;
      }
      return true;
    }
    if (type === 'textarea') {
      await field.fill(String(answer));
      return true;
    }
    // text-like
    await field.fill(String(answer));
    return true;
  } catch {
    return false;
  }
}

function matchAnswerByLabel(rawLabel) {
  const label = rawLabel.toLowerCase().replace(/\*\s*$/, '').trim();

  // Standard contact
  if (/^first\s*name/.test(label)) return cfg.first_name;
  if (/^last\s*name/.test(label) || /^surname/.test(label)) return cfg.last_name;
  if (/^(full\s*)?name$/.test(label)) return cfg.full_name;
  if (/email/.test(label)) return cfg.email;
  if (/phone|mobile|contact number/.test(label)) return cfg.phone;
  if (/linkedin/.test(label)) return cfg.linkedin;
  if (/github/.test(label)) return cfg.github;
  if (/portfolio|personal\s*website|website/.test(label)) return cfg.portfolio;

  // Location / employer
  if (/current\s*(company|employer)/.test(label)) return cfg.current_employer;
  if (/current\s*(title|role|position)/.test(label)) return cfg.current_title;
  if (/(city|location).*resid|where.*based|current\s*location/.test(label)) return cfg.location_city;
  if (/country/.test(label)) return cfg.location_country;
  if (/state|province/.test(label)) return cfg.location_state;

  // Comp / availability
  if (/current.*(salary|ctc|compensation)/.test(label)) return `${cfg.current_ctc_inr_lpa} LPA`;
  if (/(expected|desired|target).*(salary|ctc|compensation)/.test(label))
    return `${cfg.expected_ctc_inr_lpa_min}-${cfg.expected_ctc_inr_lpa_max} LPA (negotiable)`;
  if (/notice\s*period/.test(label)) return cfg.notice_period;
  if (/(start\s*date|when can you start|availability|available to start|earliest start)/.test(label)) return cfg.start_date;
  if (/years?.*experience|how many years|^experience/.test(label)) return String(cfg.experience_years);

  // Work authorization
  if (/authorized.*work.*(united states|us|usa|america)/.test(label)) return 'No';
  if (/authorized.*work.*(india)/.test(label)) return 'Yes';
  if (/authorized.*work/.test(label)) return 'No';
  if (/(require|need).*(visa|sponsorship)/.test(label)) return 'Yes';
  if (/sponsorship/.test(label)) return 'Yes';

  // Demographics
  if (/gender/.test(label)) return cfg.demographics_us_eeo.gender;
  if (/race|ethnicity/.test(label)) return cfg.demographics_us_eeo.race_or_ethnicity;
  if (/hispanic|latino/.test(label)) return cfg.demographics_us_eeo.hispanic_or_latino;
  if (/veteran/.test(label)) return cfg.demographics_us_eeo.veteran_status;
  if (/disability|disabled/.test(label)) return cfg.demographics_us_eeo.disability_status;
  if (/nationality/.test(label)) return cfg.nationality;

  // Source
  if (/hear about us|how did you find|find this/.test(label)) return cfg.default_open_text_answers.heard_from_default;

  // Open-text (use parsed answers)
  if (/why.*(this\s*)?(company|us|here|join)/.test(label)) return answers.why_this_company;
  if (/why.*(you|are you).*(fit|good|great|right)/.test(label)) return answers.why_you_are_a_fit;
  if (/(tell us|describe).*(yourself|background)/.test(label)) return answers.why_you_are_a_fit;
  if (/biggest.*(achievement|accomplishment)|proud/.test(label)) return cfg.default_open_text_answers.biggest_accomplishment;
  if (/why.*(leaving|leave|change|new)/.test(label)) return cfg.default_open_text_answers.why_leaving_current;

  return null;
}

async function typeIfExists(page, selector, value) {
  if (!value) return false;
  const el = page.locator(selector).first();
  if (await el.count() === 0) return false;
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.fill(String(value)).catch(() => {});
  return true;
}

async function uploadFile(page, selectors, filePath) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) continue;
    try { await el.setInputFiles(filePath); return true; } catch {}
  }
  return false;
}

async function findAssociatedLabel(field) {
  // Try aria-label
  const aria = await field.getAttribute('aria-label').catch(() => null);
  if (aria) return aria.trim();
  // Try aria-labelledby
  const labelledby = await field.getAttribute('aria-labelledby').catch(() => null);
  if (labelledby) {
    const ref = await field.page().locator(`#${labelledby}`).first().textContent().catch(() => null);
    if (ref) return ref.trim();
  }
  // Try <label for=id>
  const id = await field.getAttribute('id').catch(() => null);
  if (id) {
    const lab = await field.page().locator(`label[for="${id}"]`).first().textContent().catch(() => null);
    if (lab) return lab.trim();
  }
  // Try placeholder
  const ph = await field.getAttribute('placeholder').catch(() => null);
  if (ph) return ph.trim();
  // Try name attribute as last resort
  const name = await field.getAttribute('name').catch(() => null);
  if (name) return name.replace(/_/g, ' ').trim();
  return null;
}

async function clickSubmit(page) {
  const candidates = [
    'button[type=submit]:not([disabled])',
    'input[type=submit]:not([disabled])',
    'button:has-text("Submit application"):not([disabled])',
    'button:has-text("Submit Application"):not([disabled])',
    'button:has-text("Submit"):not([disabled])',
    'button:has-text("Apply now"):not([disabled])',
    'button:has-text("Apply"):not([disabled])',
    'button:has-text("Send application"):not([disabled])',
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).last();
    if (await btn.count() === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
//   Utilities
// ════════════════════════════════════════════════════════════════════════════

function detectATS(url) {
  const u = url.toLowerCase();
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse.io')) return 'greenhouse';
  if (u.includes('jobs.lever.co') || u.includes('lever.co')) return 'lever';
  if (u.includes('ashbyhq.com') || u.includes('jobs.ashby')) return 'ashby';
  return 'generic';
}

async function clickApplyEntryIfPresent(page) {
  // Workable, some Greenhouse boards, and many custom ATS show a JD with an
  // "Apply for this job" CTA that reveals the form on the next page or panel.
  // If the page has zero standard form fields but has such a button, click it.
  const hasAnyInput = await page.locator('input[type=email], input[type=text], textarea').count();
  if (hasAnyInput >= 2) return false; // form is already present

  const ctas = [
    'a:has-text("Apply for this job")',
    'button:has-text("Apply for this job")',
    'a:has-text("Apply now")',
    'button:has-text("Apply now")',
    'a:has-text("Apply for this position")',
    'button:has-text("Apply for this position")',
    'a.application-cta',
    'a.apply-button',
  ];
  for (const sel of ctas) {
    const cta = page.locator(sel).first();
    if (await cta.count() === 0) continue;
    if (!(await cta.isVisible().catch(() => false))) continue;
    await cta.scrollIntoViewIfNeeded().catch(() => {});
    await cta.click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500); // animation / iframe load
    return true;
  }
  return false;
}

function parseAnswersDoc(doc, cfg) {
  // Application_answers.md is divided by ## headers. Find body by heading.
  const defaults = cfg.default_open_text_answers;
  const result = {
    why_this_company: defaults.why_this_company,
    why_you_are_a_fit: defaults.why_you_are_a_fit,
  };
  if (!doc) return result;
  const sections = doc.split(/^##\s+/m).slice(1);
  for (const s of sections) {
    const [heading, ...rest] = s.split('\n');
    const body = rest.join('\n').trim();
    const h = heading.toLowerCase();
    if (/why.*company/.test(h)) result.why_this_company = stripTodos(body) || result.why_this_company;
    else if (/why.*fit/.test(h)) result.why_you_are_a_fit = stripTodos(body) || result.why_you_are_a_fit;
  }
  return result;
}

function stripTodos(s) {
  if (/<\s*TODO/i.test(s)) return null;
  return s;
}

function findTodos(cfg) {
  const todos = [];
  const stack = [['', cfg]];
  while (stack.length) {
    const [keypath, node] = stack.pop();
    if (typeof node === 'string' && /<\s*TODO/i.test(node)) todos.push(keypath);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('_')) continue;
        stack.push([keypath ? `${keypath}.${k}` : k, v]);
      }
    }
  }
  return todos;
}

async function readFileSafe(p) {
  try { return await readFile(p, 'utf8'); } catch { return ''; }
}

async function patchStatus(patch) {
  Object.assign(status, patch);
  await writeFile(path.join(queueDir, 'status.json'), JSON.stringify(status, null, 2));
}

async function markApplied() {
  status.status = 'applied';
  status.applied_at = new Date().toISOString();
  status.apply_method = `playwright-${ats}`;
  status.apply_screenshot = 'submitted.png';
  await writeFile(path.join(queueDir, 'status.json'), JSON.stringify(status, null, 2));
  const appliedDir = path.join(PROJECT_ROOT, 'jobs/applied', SLUG);
  await mkdir(path.dirname(appliedDir), { recursive: true });
  await rename(queueDir, appliedDir);
}
