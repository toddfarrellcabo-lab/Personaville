# Personaville v1.0

Personaville is a stable, static, workbook-driven offer database for reviewing market personas, checking database health, and exporting selected persona summaries. It runs directly from GitHub Pages or any static web server with no backend service.

## Quick start

1. Open `index.html` from the published site, or preview locally with `python3 -m http.server 8000` and visit `http://localhost:8000/`.
2. Personaville automatically loads `database/persona-db.json`.
3. Use **Personas** to search/filter personas and add them to the **Export Cart**.
4. Use **Admin → Database Health** before publishing data updates.
5. Use **Admin → Publish Database** to upload an edited workbook and download a replacement JSON file.

> If `file://` blocks JSON loading during local preview, run a local static server instead of opening `index.html` directly.

## Primary navigation

- **Personas** — the default view. Search by persona, speed, modifier, or Reference ID; filter by Pricing Set and Family Group; open persona details; and add matching personas to the Export Cart.
- **Export Cart** — shows selected personas, a single-persona preview fallback, print/PDF actions, and copy-summary behavior.
- **Manage** — a v1 placeholder that intentionally does not edit data. Editing, asset management, direct database editing, email export, and version history are v2 scope.
- **Admin** — operational tools for overview metrics, Database Health, publishing, modifiers, and settings.

## Hero and mini-player behavior

The shared header is loaded once from `components/header.html` into `#personaville-header-container`.

- On **Personas**, the header uses the full hero image from `assets/images/personaville-header.png`.
- On **Export Cart**, **Manage**, and **Admin**, the same header switches to compact mini-player mode.
- The audio element remains mounted across in-app navigation, so music continues until the user presses **Stop**.
- The Play/Stop button controls `audio/8bit-Personaville-loop.mp3`, updates `aria-pressed`, and exposes a polite status label.
- Missing hero or audio assets degrade gracefully and log warnings instead of blocking the application.

## Export Cart selection workflow

1. Go to **Personas**.
2. Apply at least one search or filter to display persona tiles.
3. Check **Add to Export Cart** on individual tiles, or use **Select All Visible** from Export Cart for the current filtered result set.
4. The sticky Export Cart tray appears when one or more personas are selected.
5. Open **Export Cart** to review order and remove unwanted personas.
6. Use **Print All** or **Download / Save as PDF**. Both open the browser print dialog; choose a PDF destination when supported.
7. Use **Copy Summary** to copy selected persona names for quick sharing.

When no personas are selected, Export Cart displays an empty state and keeps a single-persona preview available once data is loaded.

## Admin subsections

- **Overview** — source banner and KPI cards for the loaded database.
- **Database Health** — workbook and browser-generated health checks, with expandable details for warning/error rows.
- **Publish Database** — Upload Workbook, Load Published Database, Download Updated JSON, build summary, and publishing instructions.
- **Modifiers** — active modifier records and their resolved icons.
- **Settings** — repository folder expectations and maintainer notes.

## Upload Workbook and JSON publishing workflow

Use this workflow after editing `database/persona-db.xlsx`.

1. Open **Admin → Publish Database**.
2. Click **Upload Workbook** and choose the edited `.xlsx`/`.xls` workbook.
3. The workbook is parsed in-browser with SheetJS; no file is uploaded to a server.
4. Review build metrics and **Admin → Database Health**.
5. Click **Download Updated JSON**.
6. Replace `database/persona-db.json` in the repository with the downloaded file.
7. Commit the workbook and generated JSON together when the workbook changed.
8. Open a focused pull request and allow GitHub Pages to publish after merge.

## Database Health

Database Health combines workbook-provided rows from `12_DataHealth` with browser-generated checks from `js/database.js`. It reports counts and relationship issues such as missing disclaimers, broken persona/modifier joins, unresolved icons, duplicate schedule rows, overlapping months, invalid month labels, and missing pricing coverage.

Treat **BAD**, **ERROR**, and **FAIL** rows as release blockers unless a maintainer explicitly accepts the risk. Treat **WARN** rows as review-required.

## Folder structure

```text
Personaville/
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

The v1 audio player supports the bundled MP3 only. Replace `audio/8bit-Personaville-loop.mp3` with another compatible MP3 only if the filename and path stay the same or `components/header.html` is updated in the same release.

## Print and export behavior

- Printing is scoped to the Export Cart view.
- Browser print CSS hides navigation, filters, admin panels, the hero/player, action buttons, and empty states.
- Printable persona cards are sized for Letter portrait pages.
- `beforeprint` scales oversized cards to fit the printable card area; `afterprint` resets scaling.
- **Print All** and **Download / Save as PDF** intentionally call the same browser print workflow.
- Email export is not part of v1.

## Manage Coming Soon scope

The **Manage** page is informational in v1. It does not save edits or write to the workbook/JSON. The following are v2 items: persona editing, speed/pricing editing, modifier/disclaimer editing, asset upload/management, direct database editing, email export, and version history.

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
| Upload Workbook says SheetJS did not load | CDN unavailable or blocked | Connect to the internet, retry, or load the bundled JSON. |
| Icons show fallback text | Workbook icon filename is missing or asset path is wrong | Confirm the file exists under `assets/icons/` and rerun health checks. |
| Audio unavailable | MP3 path missing or browser could not play the file | Confirm `audio/8bit-Personaville-loop.mp3` exists and is served with an audio MIME type. |
| Export Cart is empty | No personas selected | Add personas from tile checkboxes or use Select All Visible after filtering. |
| Print includes unexpected browser headers/footers | Browser print settings | Disable headers/footers in the print dialog when producing PDFs. |
| JSON download disabled | No workbook has been uploaded in this browser session | Use Upload Workbook first. |

## Release process

1. Start from the latest `main` branch when a remote is configured.
2. Create a focused release branch.
3. Make documentation, data, or cleanup changes only; avoid new features for v1 stabilization.
4. Run checks:
   - `node tests/download-updated-json.test.js`
   - `node --check js/app.js && node --check js/database.js && node --check js/header.js && node --check js/render.js`
   - `python3 -m json.tool database/persona-db.json > /tmp/persona-db.json.validated`
   - icon/asset existence checks
   - browser smoke tests for navigation, selection/cart, print, mobile viewport, and console errors
5. Commit changes.
6. Open a PR titled `Finalize Personaville v1 documentation and cleanup`.
7. Merge after review and confirm the published GitHub Pages site loads the expected JSON.
