# Personaville v2 Release Notes Draft

## Release-candidate purpose

Personaville v2 is ready for release-candidate testing in the preview environment. This RC keeps the stable v1 site unchanged while validating migrated production data, editing workflows, publishing packages, Export Cart printing, and responsive browsing.

## Highlights

- Preserves the static GitHub Pages deployment model.
- Keeps workbook-to-JSON publishing as the safe data promotion path.
- Adds v2 editing coverage for personas, speed options, pricing schedules, modifiers, relationships, disclaimers, and assets.
- Supports undo/redo and change review before publishing.
- Generates a publishing package with updated JSON, health report, change summary, release-notes draft, manifest, and publishing instructions.

## RC validation status

- Checked-in migrated database counts: 30 personas, 91 speed options, 174 pricing schedule rows, 5 modifiers, 51 persona-modifier relationships, 30 disclaimers, and 6 icons.
- Database Health currently reports no blocking `BAD`, `ERROR`, or `FAIL` rows for the checked-in artifact.
- Automated editor, undo/redo, publishing package, Export Cart print, and JSON compatibility tests pass in the local Node-based suite.
- Final production-v1 comparison must be rerun from an environment with access to the stable v1 database, because this execution environment could not fetch the v1 JSON from GitHub Pages.

## Known RC guardrails

- Do not replace the stable v1 site as part of RC testing.
- Do not publish edited v2 data without reviewing Database Health.
- Do not store GitHub credentials in static app code, local storage, or repository files.

## Rollback

Continue using the stable v1 site if RC issues are found. Because v2 is tested separately, rollback means leaving v1 untouched, withdrawing the v2 preview/release candidate, and discarding any unpromoted v2 publishing packages.

## 2026-09-16 — Persona Library bulk selection + workbook review view
- Fixed **Select All** so active Persona Library filters (including Lifecycle = Scheduled) constrain bulk selection.
- Filtered **Deselect All** now removes only the currently filtered result set; unfiltered Deselect All still clears the cart.
- Bulk toolbar now shows the scoped count (for example, **Select All 30**) when filters are active.
- Working-copy and published workbook exports now generate a **Persona Master** review worksheet with one row per persona/flyer.
- Persona Master keeps **Pricing Set** separate from standalone modifiers and includes lifecycle, dates, offer slots, equipment/symmetrical flags, and disclaimer copy.
- Persona Master is a generated review sheet and is ignored during workbook re-import so it cannot create duplicate relational data.
