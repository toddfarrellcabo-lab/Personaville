# Personaville v2 Release-Candidate Migration Plan

This document prepares Personaville v2 for release-candidate testing while keeping the stable v1 site unchanged.

## Scope and safety rules

- v2 release-candidate testing happens only in the v2 preview repository/site.
- Do **not** replace, retarget, or overwrite the stable v1 `Personaville-test` GitHub Pages site during this task.
- Treat `database/persona-db.xlsx` as the editable source of truth and `database/persona-db.json` as the deployable artifact.
- Commit workbook and JSON changes together whenever production v1 data is re-imported.

## Production v1 import

1. Download the current production v1 workbook/JSON from the stable v1 repository or site.
2. Save the workbook as `database/persona-db.xlsx`.
3. Open v2 **Admin → Publish Database**.
4. Upload the workbook and review the generated build metrics.
5. Download the updated JSON and replace `database/persona-db.json`.
6. Run **Admin → Database Health** and resolve every `BAD`, `ERROR`, or `FAIL` row before RC sign-off.

### Current RC baseline

The v2 repository currently contains the migrated v1-shaped database artifact with these counts:

| Dataset | Count |
| --- | ---: |
| Personas (`05_Personas`) | 30 |
| Speed options (`06_SpeedOptions`) | 91 |
| Pricing schedule rows (`07_PricingSchedules`) | 174 |
| Modifiers (`04_Modifiers`) | 5 |
| Persona-modifier relationships (`10_PersonaModifiers`) | 51 |
| Disclaimers (`08_Disclaimers`) | 30 |
| Icons (`09_Icons`) | 6 |

A network attempt to fetch the production v1 JSON from `https://tf-1031.github.io/Personaville-test/database/persona-db.json` was blocked by the execution environment with `Tunnel connection failed: 403 Forbidden`, so this PR documents the import procedure and validates the checked-in migrated artifact. Before final RC approval, rerun the comparison from an environment that can access the production v1 site or repository.

## Data-loss verification checklist

Use this checklist after importing the latest production v1 database:

- Compare every worksheet row count between production v1 and v2 JSON.
- Confirm every production `PersonaID`, `SpeedOptionID`, `ScheduleID`, `ModifierID`, `DisclaimerID`, and `IconID` exists in v2.
- Compare representative pricing schedules across flat pricing, step pricing, 3 months free, and 3-year price lock promotions.
- Compare modifier names, statuses, icon references, and persona-modifier relationships.
- Compare disclaimer IDs and legal copy for representative personas.
- Validate all asset references resolve to files under `assets/icons/`, `assets/images/`, or `audio/`.
- Run full **Database Health** and keep the generated report with RC evidence.

## Representative pricing schedules to spot-check

- Flat pricing: one single-row schedule with 36-month coverage.
- Step pricing: one multi-row schedule with non-overlapping month ranges.
- 3 months free: one schedule with free months 1, 6, and 12 and paid gap rows.
- 3-year price lock: one schedule with full 36-month coverage.

For each schedule, compare `ScheduleID`, `ReferenceID`, `Sequence`, `StartMonth`, `EndMonth`, `DisplayLabel`, `Price`, `DisplayAsFree`, and `StrikeThroughPrice` against production v1.

## Functional RC test checklist

- Read-only browsing: load the site, search/filter personas, open persona details, and confirm no edit session is required.
- Editors: test persona, speed option, pricing schedule, modifier, relationship, disclaimer, and asset workflows in v2 only.
- Undo/redo: make an edit, undo it, redo it, then discard or publish through the v2 package workflow.
- Publishing package: run **Admin → Publish Database**, review Database Health, then generate the package.
- Export Cart and printing: add personas to the cart, print all, save as PDF, and verify dedicated print output.
- Responsive review: test desktop, tablet, and mobile widths before RC sign-off.

## Rollback to stable v1

Rollback is operationally simple because v2 must not replace v1 during RC testing:

1. Leave the stable v1 site at `https://tf-1031.github.io/Personaville-test/` untouched.
2. If v2 RC testing fails, stop sharing the v2 preview URL and continue using the stable v1 URL.
3. Revert or close unmerged v2 release-candidate PRs as needed.
4. If a v2 data package was prepared but not promoted, discard the package and keep the production v1 workbook/JSON as the source of truth.
5. If v2 was accidentally promoted, restore the stable v1 repository branch and GitHub Pages settings to the last known-good v1 commit, then invalidate any links that point users to the v2 preview.

## Lifecycle scheduling migration notes

Personaville v2 adds four optional lifecycle fields to `05_Personas`: `EffectiveStartDate`, `EffectiveEndDate`, `SupersedesPersonaID`, and `LifecycleStatusOverride`. Existing v1 records can be imported without these fields; active records with blank start and end dates continue to behave as active legacy records, while blank end dates on dated records mean the record remains effective indefinitely until an end date, manual inactive override, or replacement workflow changes it.

Workbook migration should add the same four columns to `05_Personas` when maintainers want scheduled behavior. Dates must be browser-local calendar dates in `YYYY-MM-DD` form, with no time values. JSON migration preserves these fields as plain persona-row properties, so rollback is straightforward: keep the previous production workbook/JSON, or remove the four lifecycle columns/properties if returning to a v1 workflow that does not understand them.

For replacements, use **Create Updated Version** instead of editing a published active row directly. The workflow creates a draft replacement with `SupersedesPersonaID` pointing to the predecessor, previews both records, sets the predecessor `EffectiveEndDate` to the day before the replacement `EffectiveStartDate`, and surfaces overlap, missing-target, self-superseding, circular-chain, and multiple-open-ended-version findings in Database Health before publishing.

Publishing packages include the lifecycle JSON fields, workbook columns when workbook export is available, health findings, and change summaries. If critical lifecycle health checks are `BAD`, `ERROR`, or `FAIL`, do not mark the release ready; resolve the data or document an explicit health override before packaging.
