# Personaville Roadmap

Personaville v1 is now focused on stabilization: the static app loads the published JSON database, supports workbook-to-JSON publishing in the browser, validates database health, and exports selected personas through browser print/PDF workflows.

## v1 release baseline — completed

- Primary navigation finalized: **Personas**, **Export Cart**, **Manage**, and **Admin**.
- Full hero behavior on Personas and compact mini-player behavior on secondary views completed.
- Export Cart selection, selected-count tray, removal, print/PDF, and copy-summary workflows completed.
- Admin subsections completed: Overview, Database Health, Publish Database, Modifiers, and Settings.
- Upload Workbook and Download Updated JSON workflow completed for static publishing.
- Database Health details completed for workbook and browser-generated checks.
- Icon path resolution and missing-icon fallback behavior completed.
- Letter-oriented print/export CSS completed.
- Responsive layout reviewed for the v1 static experience.
- README updated as user guide and developer guide.

## v1 maintenance principles

- Keep Personaville static and GitHub Pages friendly.
- Treat the workbook as the editable source of truth and `database/persona-db.json` as the deployable artifact.
- Fix release-blocking health issues before publishing data updates.
- Prefer documentation and validation improvements over new UI scope during v1 maintenance.
- Do not remove code unless it is clearly unused and current behavior is covered.

## v2 release-candidate gate

Before v2 can replace any production experience, release-candidate testing must prove that the current production v1 database imports without data loss, record counts match, representative pricing schedules match, modifiers and disclaimers match, all asset paths resolve, Database Health has no blocking rows, read-only browsing works, all editors work, undo/redo works, publishing package generation works, Export Cart printing works, and desktop/tablet/mobile layouts are acceptable. Rollback remains the stable v1 site until an explicit promotion task replaces it.

## v2 roadmap

The following items are intentionally deferred from v1 to v2:

1. **Editing workspace hardening**
   - Continue RC testing for personas, speed options, pricing schedules, modifiers, relationships, disclaimers, and assets.
   - Keep form validation, change review, and undo/redo covered by automated and manual release checks.

2. **Asset management**
   - Upload, preview, replace, and audit icons/images from the app.
   - Manage audio and hero assets without manual repository edits.

3. **Direct database editing**
   - Provide safe direct JSON/database editing tools if the project moves beyond workbook-first maintenance.
   - Add stronger migration and rollback controls before enabling direct edits.

4. **Email export**
   - Convert the Export Cart into an email-ready workflow.
   - Add recipient/template controls only after export content is approved.

5. **Version history**
   - Show workbook/JSON version history, publish history, and previous release comparisons.
   - Add restore/rollback guidance after governance requirements are defined.

6. **Automated release tooling**
   - Optional CI checks for browser smoke tests, asset path validation, JSON validation, and workbook-to-JSON regeneration.
   - Optional vendoring strategy for SheetJS if offline rebuilds become required.
