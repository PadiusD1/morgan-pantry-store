# Research-informed quality review

Reviewed October 9, 2026, America/New_York. Baseline release `f8bf09356b2aa9ad97fd98a6b525fc81763b5a2d` (PR #4). This is a bounded review of the FRC workflow and design releases, not a claim to have exhausted every topic or measured every production condition.

## Decision

Keep the functional repairs and the Systems by Design direction. The important next work is evidence quality: accessible and readable reporting, real operating performance, bounded data retrieval, permission checks, and demonstrated recovery. More decoration, more dependencies, or more skill invocations are not independent quality improvements.

The owner's shared knowledge already calls for automatic relevant skill use and purposeful final-artifact review. `AGENTS.md` makes that discipline discoverable in this project; `CLAUDE.md` points to the same owner. Private knowledge and skill bodies are not copied into this public repository. Availability and freshness must be checked per task.

## Findings and decisions

| Area | Evidence and interpretation | Decision / acceptance boundary |
| --- | --- | --- |
| Functional correctness | PR #3/#4 regressions cover donor readback, scanner versus typing, transactional stock/request behavior, dates and exports. This review did not re-audit every endpoint. | Preserve these fixes. Any further behavioral change needs a reproduced failure, regression, and database readback. |
| Brand and usability | The owner's current SBD guide supports the editorial identity. WAI and Vercel guidance support semantic controls, keyboard use, focus and responsive layout [1–3]. A brand guide does not prove that every user prefers a layout. | Keep the shared brand tokens and simplified navigation. Validate real tasks with staff; do not equate preference with conformance or measured usability. |
| Printed report | Programmatic inspection of the delivered sample and PR #4 CI PDF found 6.75pt explanatory text and no PDF structure tree. The previous screenshots and green browser tests did not establish print readability or tags. | Replace tiny screen-pixel print text with point-sized type, keep substantive explanations at 10pt, and re-render short/long/empty reports. Keep HTML available. Test tagged generation separately; browser Save-as-PDF remains browser-dependent. |
| Data visualization | Official government chart guidance supports selecting charts for the question, SVG quality, direct labels and equivalent data tables/downloads [4]. It does not prohibit every pie chart or endorse one brand style. | Retain native labeled bars and the weekly data table. Keep monthly scope explicit and the full CSV. Add an explicit pointer from the top-10 document view to the full board CSV. Never fabricate missing months or operational outcomes. |
| Performance | The previous release has a measured bundle/precache reduction, not measured faster staff service. Core Web Vitals are field/user-experience metrics [5]. | Target p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 across mobile and desktop. These are targets, not current FRC results. Measure API/save/export time as separate operational metrics. |
| Database scale | The earlier audit explicitly retains whole-history API loading. PostgreSQL requires deterministic ordering for stable LIMIT/OFFSET subsets and warns that skipped OFFSET rows still require work [6]. | Prioritize bounded history queries and server-side report aggregation after measuring actual payloads/query plans. Do not compute full-period totals from one page. Prefer a reviewed cursor strategy when appropriate; do not blindly substitute LIMIT for complete reporting. |
| Security and privacy | ASVS and OWASP authorization guidance cover application controls, not merely package advisories [7–8]. Hiding a UI button is not server-side authorization. | Keep role/denial tests, review object-level access and export/log exposure, and do not treat zero known runtime advisories as complete security. No new tracking of student/donor identities is introduced. |
| Recovery and cost | Supabase backup availability/retention is plan-dependent; database backups do not include Storage API objects [9]. The application's CSV/JSON exports are not complete restoration evidence. | Verify the actual plan, retention, and isolated restore. Define acceptable data loss and recovery time with the operator. Do not enable a paid tier or restore production in an audit. |
| Maintainability | The prior template combined content with a long embedded stylesheet. A separate stylesheet can have one clear owner without duplicating tokens. | Extract the document stylesheet and remove its old embedded copy. No new runtime library, database schema change, or external service is needed for these repairs. |

## Concrete scope of this correction

The document keeps the same `BoardReport` formulas, privacy boundaries and source data. Essential notes, table values and definitions use 10pt text. Secondary labels are at least 8pt. The template retains short reports together and moves interpretation to a separate sheet when the final monthly ledger is dense. This favors readability over an arbitrary three-page requirement. Top-10 views explicitly identify the full CSV as the complete item listing. The stylesheet has one owner at `shared/board-document-style.ts`.

New browser regressions cover print typography, horizontal containment, empty reports, ordinary reports, 12-month ledgers and 40-month histories. They request tagged PDF output and an outline from Playwright [10]. The tag-tree marker check proves the exporter emitted a structure tree; it does not prove correct tags/reading order throughout, screen-reader usability, or PDF/UA compliance [11]. Manual final-byte inspection remains necessary. The production print action uses the reader's browser; it is not replaced with a paid PDF service.

## Skill and knowledge application

The task used the owner's shared Office context and the existing correction about automatic relevant skills/purposeful quality. It applied `web-design-guidelines` with the current upstream rules, `document-design` and its print-typography reference for readable final pages, and the evidence-boundary guidance in `verification-before-completion`. Native PDF inspection measured final bytes instead of trusting an earlier summary. The installed PDF mechanics guidance covered extraction/render checks, not the design decision by itself.

This records actual guidance used, not a claim to have executed the owner's remote document kit or read the entire skill collection. Exact private source identifiers are retained in the conversation; public guidance refers to roles and methods without publishing private instructions. For future changes select the best-fitting available skill, verify its path/version and references, apply it, and keep a concrete receipt. Current evidence and owner instructions take precedence over stale notes.

## Next acceptance work, in order

1. Finish accessibility acceptance on actual staff workflows and exported files, including headings, zoom, portaled dialogs, screen readers, keyboard focus, and actual printer/browser output. Current automatic checks are bounded.
2. Measure real save/export latency, payload sizes, query cost and Core Web Vitals before a larger performance claim. Use aggregate, privacy-reviewed telemetry or authorized local diagnostics, not raw student records.
3. Review server-side history pagination/report aggregates and safe reconciliation of legacy donor links using production counts and an approved migration plan.
4. Demonstrate isolated recovery from the actual provider backup, including any stored objects. Keep the unsafe JSON restoration disabled.

These are acceptance priorities, not unattended jobs or a claim that account-level checks have been performed. A release receipt on the associated PR records final test counts, commit, visual review, deployment status and unresolved risks. Do not replace those receipts with historical counts in this document.

## Primary sources checked

[1] W3C WAI, Headings. https://www.w3.org/WAI/tutorials/page-structure/headings/

[2] W3C, Understanding WCAG 2.2 Target Size (Minimum) and Reflow. The AA target-size rule is 24 by 24 CSS pixels or qualifying exceptions; the project's 44px preference is not that legal/technical minimum. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html and https://www.w3.org/WAI/WCAG22/Understanding/reflow.html

[3] Vercel Labs, Web Interface Guidelines, current upstream rules. This is vendor guidance, not a substitute for W3C standards or task-specific testing. https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

[4] UK Government Analysis Function, Data visualisation: charts. https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/

[5] Google web.dev, Web Vitals, current documented metrics and field thresholds. https://web.dev/articles/vitals

[6] PostgreSQL, LIMIT and OFFSET. Current documentation was checked; the application integration suite uses PostgreSQL 17, not an automatic upgrade to the documentation's current major. https://www.postgresql.org/docs/current/queries-limit.html

[7] OWASP, Application Security Verification Standard project. Use the applicable stable requirements and record version at implementation time. https://owasp.org/projects/asvs

[8] OWASP, Authorization Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

[9] Supabase, Database Backups. Verify actual account entitlements rather than assuming them from documentation. https://supabase.com/docs/guides/platform/backups

[10] Playwright, page.pdf options, including tagged and outline. https://playwright.dev/docs/api/class-page#page-pdf

[11] W3C, PDF9, headings in a PDF structure tree and tests of actual tags. https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF9
