#!/usr/bin/env node
// scripts/scrape-page.mjs <url> [flags]
//
// Renders a URL with Playwright headless Chromium and extracts text + links.
// Used by /jf-discover for JS-heavy sources that WebFetch cannot read:
//   - YC Work at a Startup (workatastartup.com)
//   - Wellfound (wellfound.com)
//   - Ashby job boards (jobs.ashbyhq.com/<company>)
//   - Greenhouse boards that lazy-render (some)
//
// Flags:
//   --wait <selector>     Wait for this CSS selector before extracting (default: networkidle only)
//   --scroll              Auto-scroll to bottom to trigger lazy load
//   --json                Output {url, title, text, links[]} as JSON (default: plain text with title)
//   --max-text <chars>    Truncate body text to this length (default: 25000)
//   --timeout <ms>        Total page-load timeout (default: 30000)
//   --headful             Show browser window (debug)
//
// Output:
//   stdout — rendered page text (or JSON with --json)
//   stderr — warnings/errors
//
// Exit:
//   0 success | 1 generic error | 2 nav timeout

import { chromium } from 'playwright';

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('-')) {
  console.error('Usage: scrape-page.mjs <url> [--wait <selector>] [--scroll] [--json] [--max-text <chars>] [--timeout <ms>] [--headful]');
  process.exit(1);
}
const url = args[0];

function flagValue(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const next = args[i + 1];
  if (!next || next.startsWith('--')) return def;
  return next;
}
const waitSelector = flagValue('--wait', null);
const doScroll = args.includes('--scroll');
const wantJson = args.includes('--json');
const maxText = Number(flagValue('--max-text', 25000));
const timeout = Number(flagValue('--timeout', 30000));
const headful = args.includes('--headful');

const browser = await chromium.launch({ headless: !headful });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    console.error(`[scrape-page] navigation failed: ${err.message}`);
    process.exit(2);
  }
  await page.waitForLoadState('networkidle', { timeout: Math.min(15000, timeout) }).catch(() => {});

  if (waitSelector) {
    try {
      await page.waitForSelector(waitSelector, { timeout: Math.min(20000, timeout) });
    } catch {
      console.error(`[scrape-page] warning: --wait selector '${waitSelector}' did not appear`);
    }
  }

  if (doScroll) {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let total = 0;
        const step = 700;
        const timer = setInterval(() => {
          const h = document.body.scrollHeight;
          window.scrollBy(0, step);
          total += step;
          if (total >= h + 1000) { clearInterval(timer); resolve(); }
        }, 250);
      });
    });
    await page.waitForTimeout(1500);
  }

  const title = (await page.title().catch(() => '')) || '';
  let text = await page.evaluate(() => document.body?.innerText || '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > maxText) text = text.slice(0, maxText) + '\n\n[...truncated]';

  if (wantJson) {
    const rawLinks = await page.$$eval('a[href]', as => as.map(a => ({
      href: a.href,
      text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 140),
    })).filter(l => l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('mailto:#')));
    const seen = new Set();
    const links = [];
    for (const l of rawLinks) {
      if (seen.has(l.href)) continue;
      seen.add(l.href);
      links.push(l);
    }
    process.stdout.write(JSON.stringify({ url, title, text, links }, null, 2) + '\n');
  } else {
    if (title) process.stdout.write(`# ${title}\n\n`);
    process.stdout.write(text + '\n');
  }
} catch (err) {
  console.error(`[scrape-page] ERROR: ${err.message}`);
  process.exit(1);
} finally {
  await browser.close();
}
