#!/usr/bin/env node
// scripts/md-to-pdf.mjs <input.md> [output.pdf]
//
// Converts a markdown resume/cover-letter to a clean A4/Letter PDF using Playwright + HTML.
// Default output path: same dir, same basename, .pdf extension.
//
// Examples:
//   node scripts/md-to-pdf.mjs profile/resume_base.md
//   node scripts/md-to-pdf.mjs jobs/queue/<slug>/resume_tailored.md jobs/queue/<slug>/resume_tailored.pdf

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/md-to-pdf.mjs <input.md> [output.pdf]');
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`Input not found: ${input}`);
  process.exit(1);
}
const output = process.argv[3] || input.replace(/\.md$/, '.pdf');

const md = await readFile(input, 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Resume</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    color: #1a1a1a;
    padding: 0.45in 0.55in;
    line-height: 1.42;
  }
  h1 {
    font-size: 22pt;
    font-weight: 700;
    margin: 0 0 2px;
    letter-spacing: 0.4px;
    text-align: center;
  }
  h1 + p {
    text-align: center;
    margin: 0 0 12px;
    font-size: 10pt;
    color: #444;
  }
  h2 {
    font-size: 10.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.4px;
    border-bottom: 1px solid #333;
    padding-bottom: 3px;
    margin: 14px 0 6px;
  }
  h3 {
    font-size: 11pt;
    font-weight: 600;
    margin: 10px 0 0;
  }
  h3 + p em, h3 + p {
    font-size: 9.5pt;
    color: #555;
    margin: 0 0 4px;
    font-style: normal;
  }
  p { margin: 3px 0; }
  ul { margin: 3px 0 6px 16px; padding: 0; }
  li { margin: 2px 0; }
  a { color: #0a58ca; text-decoration: none; }
  strong { color: #000; }
  em { color: #555; font-style: italic; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 12px 0; }
  /* Reduce widows at page breaks */
  h2, h3 { break-after: avoid; page-break-after: avoid; }
  li, p  { break-inside: avoid; }
</style>
</head>
<body>
${body}
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: output,
    format: 'Letter',
    margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' },
    printBackground: true,
    preferCSSPageSize: false,
  });
  console.log(`✓ ${output}`);
} finally {
  await browser.close();
}
