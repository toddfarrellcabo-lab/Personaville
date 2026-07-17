# Personaville v2 Preview

Personaville v2 Preview is the repository-based development preview for the next Personaville release. It starts from the current stable Personaville v1.0/v1.1 application baseline and intentionally preserves the existing static, workbook-driven behavior while v2 work is staged separately from the stable v1 repository.

Preview site URL structure after GitHub Pages is enabled:

```text
https://tf-1031.github.io/Personaville-v2-preview/
```

Stable v1 site: https://tf-1031.github.io/Personaville-test/

## Repository purpose

- This repository is the v2 development preview only.
- The stable v1 `Personaville-test` repository and site should remain unchanged.
- Existing v1 functionality is retained here as the starting point: database import, validation, Personas, Export Cart, Admin, hero image, audio player, and publishing workflow.
- v2 editing, undo/redo, change review, and publishing-package workflows are staged for release-candidate validation in this preview setup.
- If this repository was created by cloning the stable v1 repository, it can preserve the full Git history. If it was created from an exported file copy instead, this preview begins from the v1.0/v1.1 baseline represented by this initial commit.


## v2 release-candidate preparation

Personaville v2 is now staged for release-candidate testing in this preview repository only. The stable v1 site must remain unchanged during RC validation. See [MIGRATION.md](MIGRATION.md) for the production v1 import procedure, data-loss checks, RC validation checklist, and rollback-to-v1 plan. See [RELEASE_NOTES_v2_RC.md](RELEASE_NOTES_v2_RC.md) for the current release-notes draft.

RC validation must include record-count comparison, representative pricing schedule comparison, modifier/disclaimer comparison, asset-path validation, full Database Health, read-only browsing, all editors, undo/redo, publishing package generation, Export Cart printing, and desktop/tablet/mobile review.

## Quick start

1. Open `index.html` from the published preview site, or preview locally with `python3 -m http.server 8000` and visit `http://localhost:8000/`.
2. Personaville automatically loads `database/persona-db.json`.
3. Use **Personas** to search/filter personas and add them to the **Export Cart**.
4. Use **Database** for Database Manager editing workflows, and use **Admin → Database Health** before publishing data updates.
5. Use **Admin → Publish Database** to upload an edited workbook and download a replacement JSON file.

> If `file://` blocks JSON loading during local preview, run a local static server instead of opening `index.html` directly.

## GitHub Pages setup

Configure GitHub Pages in the new `Personaville-v2-preview` repository:

1. Create the repository as `tf-1031/Personaville-v2-preview`.
2. Push this preview branch/repository content to GitHub.
3. In GitHub, open **Settings → Pages**.
4. Set **Source** to **Deploy from a branch**.
5. Select the default publishing branch, usually `main`, and the root folder `/`.
6. Save and wait for GitHub Pages to publish.
7. Confirm the site is available at `https://tf-1031.github.io/Personaville-v2-preview/`.

No custom domain is required for this preview URL.

## Primary navigation

- **View Personas** — the default view. Search by persona, speed, modifier, or Reference ID; filter by Pricing Set and Family Group; open persona details; and add matching personas to the Export Cart.
- **Data Explorer** — reviews working-copy changes and database records before export.
- **Export Cart** — shows selected personas, a single-persona preview fallback, print/PDF actions, and copy-summary behavior.
- **Database** — compact navigation label for **Database Manager**, the broader workspace for Persona Editor, View Personas, Export Cart, Data Explorer, workbook import/export, Database Health, Assets, Disclaimers, Modifiers, Publishing, and future Version History links.
- **Admin** — operational tools for overview metrics, Database Health, publishing, modifiers, assets, and settings.

## Hero and mini-player behavior

The shared header is loaded once from `components/header.html` into `#personaville-header-container`.

- On **Personas**, the header uses the full hero image from `assets/images/personaville-header.png`.
- On **Data Explorer**, **Export Cart**, **Database**, and **Admin**, the same header switches to compact mini-player mode.
- The audio element remains mounted across in-app navigation, so music continues until the user presses **Stop**.
- The Play/Stop button controls `audio/8bit-Personaville-loop.mp3`, updates `aria-pressed`, and exposes a polite status label.
- Missing hero or audio assets degrade gracefully and log warnings instead of blocking the application.

## Export Cart selection workflow

1. Go to **Personas**.
2. Apply at least one search or filter to display persona tiles.
3. Check **Add to Export Cart** on individual tiles, or use the compact bulk-selection toolbar on **Personas** to **Select All**, **Deselect All**, **Select Visible**, or **Deselect Visible**. Visible-only actions follow the current search, lifecycle, Pricing Set, Family Group, and other View Personas filters.
4. Use the toolbar count, **View Cart**, and **Clear Cart** controls to monitor or reset the shared Export Cart without leaving the filtered results.
5. The sticky Export Cart tray appears when one or more personas are selected.
6. Open **Export Cart** to review order and remove unwanted personas.
7. Use **Print All** or **Download / Save as PDF**. Both open the browser print dialog; choose a PDF destination when supported.
8. Use **Copy Summary** to copy selected persona names for quick sharing.

When no personas are selected, Export Cart displays an empty state and keeps a single-persona preview available once data is loaded.

## Admin subsections

- **Overview** — source banner and KPI cards for the loaded database.
- **Database Health** — workbook and browser-generated health checks, with expandable details for warning/error rows.
- **Publish Database** — Upload Workbook, Load Published Database, Download Updated JSON, build summary, and publishing instructions.
- **Modifiers** — active modifier records and their resolved icons.
- **Settings** — repository folder expectations and maintainer notes.

## Secure authenticated publishing design

Authenticated direct publishing is intentionally not implemented in the static Personaville app. The default publishing method remains the downloadable manual publishing package because it does not require storing GitHub credentials in repository files, browser storage, or public JavaScript. See [Secure GitHub Publishing Design for Personaville v2](docs/secure-github-publishing.md) for the evaluated GitHub App, OAuth, server-side publishing service, and GitHub Actions workflow dispatch options.

## Workbook export, import, review, and publishing workflow

Use this workflow when a Personaville workbook is exported, edited in Excel, and brought back for review.

1. In **Database Manager → Database Files**, use **Export Published Workbook** for a clean published snapshot or **Export Working Copy Workbook** to back up staged edits.
2. Edit the exported `.xlsx` in Excel, but preserve every worksheet name and column header exactly. Personaville imports by canonical sheet and header names and will not guess renamed tabs or columns.
3. Use **Import Workbook** in **Database Manager → Database Files** to select the edited Personaville `.xlsx`. Unsupported file types are rejected before parsing.
4. Review the import stages, validation errors, and per-collection summary before applying. Fix validation errors in Excel and re-import when needed.
5. If a dirty working copy already exists, choose **Cancel Import**, **Export Current Working Copy**, or explicitly **Replace Working Copy**. Merge is intentionally not offered for this release.
6. Before replacement, Personaville keeps a pre-import recovery snapshot. Use **Restore Pre-Import State** / **Undo Workbook Import** from the import panel if the imported working copy is not what you expected.
7. After applying, Database Health reruns and **Data Explorer / Review Changes** shows field-level differences. Publishing remains a separate explicit operation.
8. To publish approved changes, review Database Health, create/download the publishing package or updated JSON, replace repository files, and commit through GitHub. Imported workbooks never directly change the published snapshot.

Legacy **Admin → Publish Database → Upload Workbook** remains available for older JSON-generation workflows, but round-trip workbook editing should use Database Manager so changes are validated, summarized, recoverable, and persisted in the working copy before publishing.

## Database Health

Database Health combines workbook-provided rows from `12_DataHealth` with browser-generated checks from `js/database.js`. It reports counts and relationship issues such as missing disclaimers, broken persona/modifier joins, unresolved icons, duplicate schedule rows, overlapping months, invalid month labels, and missing pricing coverage.

Treat **BAD**, **ERROR**, and **FAIL** rows as release blockers unless a maintainer explicitly accepts the risk. Treat **WARN** rows as review-required.

## Folder structure

```text
Personaville-v2-preview/
├── index.html
├── README.md
├── ROADMAP.md
├── NEXT_STEPS.md
├── README.txt
├── components/
│   └── header.html
├── css/
│   ├── app.css
│   └── header.css
├── js/
│   ├── app.js
│   ├── database.js
│   ├── header.js
│   └── render.js
├── database/
│   ├── persona-db.xlsx
│   └── persona-db.json
├── assets/
│   ├── icons/
│   │   └── icon-*.png
│   └── images/
│       └── personaville-header.png
├── audio/
│   └── 8bit-Personaville-loop.mp3
└── tests/
    └── download-updated-json.test.js
```

## Asset paths

- Icons resolve relative to `assets/icons/` through `resolveIconPath()`.
- Workbook icon values may be bare filenames, `icons/icon-Standard.png`, or `assets/icons/icon-Standard.png`.
- The hero image path is `assets/images/personaville-header.png`.
- The audio path is `audio/8bit-Personaville-loop.mp3`.
- `database/persona-db.json` is fetched relative to the site root.

## Audio files

The preview audio player supports the bundled MP3 only. Replace `audio/8bit-Personaville-loop.mp3` with another compatible MP3 only if the filename and path stay the same or `components/header.html` is updated in the same release.

## Print and export behavior

- Printing is scoped to the Export Cart view.
- Browser print CSS hides navigation, filters, admin panels, the hero/player, action buttons, and empty states.
- Printable persona cards are sized for Letter portrait pages.
- `beforeprint` scales oversized cards to fit the printable card area; `afterprint` resets scaling.
- **Print All** and **Download / Save as PDF** intentionally call the same browser print workflow.
- Email export is not implemented in this baseline preview task.

## Database Manager scope

The **Database Manager** page is the broader workspace for maintaining the Personaville database, not only persona records. The compact primary-navigation label is **Database**. Current tools include the Persona Editor, speed options, pricing schedule, modifier, relationship, disclaimer, and asset placeholders, with links ready to connect View Personas, Export Cart, Data Explorer, workbook import/export, Database Health, Assets, Publishing, and future Version History workflows. Existing internal `manage` view links remain supported for bookmark compatibility.

## Developer guide

### Runtime data flow

```text
database/persona-db.xlsx --Upload Workbook--> in-browser raw sheets
          │                                      │
          └--maintainer source                   ├--enhance relationships
                                                 ├--render Personas/Admin/Export Cart
                                                 └--Download Updated JSON

database/persona-db.json --fetch on load--------> same runtime DB state
```

### Important files

- `js/database.js` — global `DB`, workbook parsing, JSON loading, normalization, relationship enhancement, health checks, icon path resolution, and JSON serialization.
- `js/render.js` — KPI, filter, persona tile, detail, modifier, health, Export Cart, and print rendering.
- `js/app.js` — navigation, admin tabs, header loading, workbook upload, bundled JSON reload, print handlers, and download action wiring.
- `js/header.js` — hero/mini-player initialization and audio state.
- `css/app.css` — app layout, responsive behavior, cards, filters, Export Cart, health details, and print CSS.
- `css/header.css` — full hero and compact player styles.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Published database does not load locally | Browser blocked `fetch()` from `file://` | Run `python3 -m http.server 8000` and open `http://localhost:8000/`. |
| Hero image is missing | `assets/images/personaville-header.png` path changed or file missing | Restore the file or update `components/header.html`. |
| Audio does not play | Browser autoplay policy or missing MP3 | Press **Play** after user interaction and confirm `audio/8bit-Personaville-loop.mp3` exists. |
| Updated workbook changes are not reflected | JSON was not regenerated/replaced | Use **Admin → Publish Database → Download Updated JSON** and replace `database/persona-db.json`. |

## Date-based persona lifecycle scheduling

Personas may include `EffectiveStartDate`, `EffectiveEndDate`, `SupersedesPersonaID`, and `LifecycleStatusOverride` in `05_Personas`. Dates are browser-local calendar dates stored as `YYYY-MM-DD`; there are no times, cron jobs, server schedulers, GitHub automations, or timezone selectors. Blank end dates mean the persona remains effective indefinitely until ended, manually deactivated, or superseded.

Scheduled records must be published before their start date by replacing `database/persona-db.json` through the normal publishing workflow. GitHub Pages only serves the already-published static JSON; it does not activate records, run schedulers, or recalculate data on the server. Each browser derives status from its own local calendar date when the app loads, so users may need to refresh after midnight to see a scheduled record become active or an ended record expire. Users near midnight in different locations can briefly see different derived statuses because their browser-local dates differ. Exact coordinated go-live times require a future backend or service-side scheduler and are intentionally out of scope for this static app.

Legacy active records with no lifecycle dates remain active, and older JSON/workbooks continue to load without inventing dates. Workbook exports and publishing packages include lifecycle columns when present in the persona rows. Database Health and health exports include lifecycle findings for invalid date ranges, missing superseded targets, self-superseding records, circular replacement chains, overlapping effective ranges, and multiple open-ended active versions.

Use **Create Updated Version** to replace an existing persona. The editor duplicates the source as a new draft, generates a new `PersonaID`, sets `SupersedesPersonaID`, asks for the replacement start date, previews the new draft plus the suggested source end date (one day earlier), and requires confirmation before changing the source. The editor shows the derived lifecycle status as read-only explanatory text and warns about lifecycle conflicts before save; resolve critical lifecycle health failures before marking a release ready.
