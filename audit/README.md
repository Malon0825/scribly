# Scribly UI audit snapshot

Start with [report.md](report.md). The report contains 44 findings, coverage of all 20 trigger categories, proposed repairs and a retest plan. The JSON ledgers retain each check's evidence and verification limits; screenshots and logs support the browser observations.

Evidence was collected October 4, 2026 against version 1.3.12, commit `0d3fa69d168402f8bb7740547003be1aff03fcc0`, and consolidated October 5. These are historical findings about that revision, not proof that each issue remains in subsequent work. Recheck the affected implementation before fixing a finding, especially when using the main checkout's newer uncommitted features.

This audit did not change application code. The corrected specs are audit-local adapters for stale source-test assumptions; original and adapted results are reported separately. Native Windows, screen-reader and performance unknowns remain explicitly unverified.

To regenerate the documents from this folder, run `node audit/consolidate.mjs` followed by `node audit/render-report.mjs` from the repository root. The renderer uses the checkout path for clickable file links. Set `AUDIT_LINK_ROOT` to another checkout's absolute path when preparing the report for that checkout. Transient Playwright output is excluded from version control.
