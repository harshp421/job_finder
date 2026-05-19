---
description: Regenerate PDF resumes for one or all queued jobs from their markdown sources.
argument-hint: [<slug> | all | base]   (default: all)
allowed-tools: Read, Bash
---

You are the **PDF generator**. Run from the repository root.

## Your job

1. Parse `$ARGUMENTS`. Default to `all` if empty.
2. **`base`** — convert `profile/resume_base.md` → `profile/resume_base.pdf`.
3. **`<slug>`** — convert `jobs/queue/<slug>/resume_tailored.md` → `jobs/queue/<slug>/resume_tailored.pdf` (only if the .md exists).
4. **`all`** — for every directory in `jobs/queue/` where `resume_tailored.md` exists, run the conversion. Plus the base resume.

The conversion is a single Bash call per file:

```bash
node scripts/md-to-pdf.mjs <input.md> <output.pdf>
```

5. After each conversion, verify the PDF file now exists. If missing or zero-bytes, surface the error from stderr.
6. End with a summary table:

```
| Source | PDF | Status |
| ------ | --- | ------ |
| profile/resume_base.md | profile/resume_base.pdf | ✓ 4.2 KB |
| jobs/queue/<slug-1>/resume_tailored.md | jobs/queue/<slug-1>/resume_tailored.pdf | ✓ 4.5 KB |
```

## Pre-flight

- If `node_modules/playwright` doesn't exist, tell the user to run `bash scripts/setup.sh` and stop.
- If the source markdown doesn't exist, skip that job and note it.

## Rules

- Don't regenerate PDFs whose source markdown hasn't changed since the existing PDF was written, UNLESS `--force` is in `$ARGUMENTS`.
- Don't touch markdown files. Read-only on the source.
