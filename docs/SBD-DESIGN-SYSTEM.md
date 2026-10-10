# Systems by Design / FRC experience

The FRC remains a Morgan State University service. Systems by Design is identified as the system designer, not the pantry operator or the author of its source records.

## Visual contract

This application adapts the owner's current "The Firm" (V19) identity: white paper, fine slate rules, square controls, restrained blue, Source Serif 4 for display headings, Hanken Grotesk for text and numbers, and sparing JetBrains Mono labels. It uses the existing SBD loop mark. Morgan blue and orange remain in the client signature. No new logo, gradients, glass panels, animated counters or decorative icon tiles are introduced by this pass.

`shared/brand.ts` owns the signature, palette and typography tokens used by the workspace and the board-document renderer. `client/src/styles/sbd.css` replaces the previous glass presentation. The existing Google Fonts delivery is changed to the brand families using display=swap and system/Georgia fallbacks. The font service is optional; data and controls do not wait for it. This is not a claim that the fonts are bundled offline. The existing CSP allowlist is not expanded.

## Interaction and reporting

Navigation is grouped into Operate, Relationships and Review. Detail routes retain their parent navigation state. Mobile navigation closes after selection. A skip link reaches the workspace, touch controls have a 44px minimum on narrow staff screens, focus is visible, and reduced motion is respected. The old unimplemented Ctrl+E badge is removed rather than promising a keyboard shortcut that does not exist.

Reports retain their existing data filters, identifiers, permissions and CSV actions. The PDF action is visually primary. Its document is a separate editorial board briefing, not a screenshot of operational tables. It includes an impact overview, monthly visit bars, an operating picture, top distributed items, complete monthly ledgers and definitions. The chart shows at most 12 active months; ledgers retain every active month in bounded groups. Empty periods and missing measurements remain explicit. Print waits briefly for fonts and has a bounded fallback plus a manual print action. Item descriptions are free text and must still be reviewed before external sharing; this is not automatic anonymization of arbitrary input.

## Scope and verification

This pass changes the shared visual foundation, staff shell, report presentation and print template. It does not rewrite every screen's workflow or implement server-side history pagination. No database migration, production data rewrite, new runtime library or paid service is introduced. Existing unit, PostgreSQL and production-browser checks remain the release gates. Added regressions cover the brand contract, print data/escaping, empty and long periods, mobile navigation, keyboard access and actual PDF generation.

A generated example is illustrative, not live FRC performance. Reduced decorative rendering work is not a measured production speedup. Real performance limits, backup verification, physical hardware acceptance and legacy donor reconciliation remain as documented in the FRC audit.
