# Personaville v2 Production Cutover Plan

This is the documentation-only production cutover plan for promoting the approved Personaville v2 release to production. It is intentionally gated: do not execute the cutover until every prerequisite confirmation below is complete and recorded in the release issue or approval thread.

## Non-negotiable prerequisites

Production cutover must not begin until all of the following are confirmed:

- v2 preview has passed manual testing.
- Current production data has been backed up.
- v1.0.0 and later stable releases remain available through GitHub tags/releases.
- Migration report shows no data loss.
- Rollback instructions are documented.

If any prerequisite is missing, stop and keep the v1 production site unchanged.

## Production target and preservation rules

- Current stable production site: `https://tf-1031.github.io/Personaville-test/`.
- v2 preview site: `https://tf-1031.github.io/Personaville-v2-preview/`.
- Production promotion target: the existing production repository/site unless maintainers explicitly approve a repository rename or DNS/navigation change.
- Do not delete the v1 repository, v1 tags, v1 releases, or v1 release assets.
- Do not force-push over v1 release tags.
- Keep the v2 preview repository available until post-deployment smoke testing passes and maintainers approve archival or continued preview use.

## Roles and approvals

| Role | Responsibility |
| --- | --- |
| Release owner | Confirms all prerequisites, coordinates timing, and owns the final go/no-go decision. |
| Data owner | Produces the production backup and signs off on the migration report. |
| GitHub/repository maintainer | Performs branch protection, merge, tag, release, and GitHub Pages changes. |
| QA/manual tester | Executes the post-deployment smoke test and records results. |

## Files to copy or merge

Promote the approved v2 repository state into the production repository by copying or merging these paths from the approved v2 release commit:

| Path | Action | Notes |
| --- | --- | --- |
| `index.html` | Merge/copy | Main static entry point. |
| `components/` | Merge/copy | Shared header and runtime fragments. |
| `css/` | Merge/copy | Application and header styles. |
| `js/` | Merge/copy | Runtime application, rendering, database, publishing, editing, and header logic. |
| `database/persona-db.xlsx` | Replace with approved migrated production workbook | Must match the migration report and production backup lineage. |
| `database/persona-db.json` | Replace with approved generated JSON | Must be generated from the approved workbook and pass Database Health. |
| `assets/` | Merge/copy | Preserve required icons and hero image paths. Do not remove v1-only assets unless the release owner explicitly approves after smoke testing. |
| `audio/` | Merge/copy | Preserve the v2 mini-player audio file path. |
| `tests/` | Merge/copy | Keep automated regression coverage with the production repository. |
| `README.md` | Update/merge | Change from preview wording to production v2 wording during the production PR. |
| `MIGRATION.md` | Keep or merge | Retain migration evidence and data-loss verification notes. |
| `RELEASE_NOTES_v2_RC.md` | Convert or supersede | Use as source material for the `v2.0.0` GitHub release notes. |
| `docs/` | Merge/copy | Include this cutover plan and secure publishing documentation. |

Before merging, compare the approved v2 release commit to the production repository and list any production-only files that must be preserved. Do not blindly delete production-only files.

## Repository changes

1. Freeze production content changes during the cutover window.
2. Confirm the production repository has immutable tags/releases for `v1.0.0` and every later stable v1 release.
3. Create a production cutover branch from the current production default branch, for example `release/v2.0.0-cutover`.
4. Back up the current production branch tip by creating a tag such as `production-pre-v2-cutover-YYYYMMDD`.
5. Merge or copy the approved v2 files listed above into the production cutover branch.
6. Update production-facing documentation so it identifies the site as Personaville v2 rather than a v2 preview.
7. Commit the production cutover branch with a message such as `Promote Personaville v2.0.0 to production`.
8. Open a production repository PR and attach:
   - prerequisite confirmations,
   - backup location,
   - migration report,
   - data-loss verification summary,
   - rollback instructions,
   - smoke-test checklist.
9. Require review from the release owner and data owner before merge.
10. Merge using the repository's normal protected-branch workflow.
11. After merge and successful GitHub Pages deployment, create and push the annotated release tag `v2.0.0` from the exact production commit.
12. Create the GitHub Release `v2.0.0` and attach the release notes, migration report, and any approved backup manifest or checksum file that is safe to publish.

## GitHub Pages configuration changes

Use GitHub **Settings → Pages** in the production repository:

1. Confirm the source remains **Deploy from a branch** unless maintainers intentionally use a Pages workflow.
2. Select the production default branch, usually `main`, and folder `/`.
3. Save the configuration if it changed.
4. Wait for the Pages deployment to complete.
5. Confirm the production URL serves the v2 build.
6. If a custom domain is configured, do not change it unless a separate domain migration has been approved.
7. Do not point production traffic at the v2 preview repository as a shortcut unless the release owner explicitly approves that operational model.

## Backup procedure

Perform the backup before merging the production cutover PR:

1. Record the current production commit SHA and GitHub Pages configuration.
2. Create and push a pre-cutover tag from the current production commit:

   ```bash
   git fetch origin --tags
   git checkout main
   git pull --ff-only origin main
   git tag -a production-pre-v2-cutover-YYYYMMDD -m "Production backup before Personaville v2.0.0 cutover"
   git push origin production-pre-v2-cutover-YYYYMMDD
   ```

3. Download or archive the current production data files:
   - `database/persona-db.xlsx`
   - `database/persona-db.json`
4. Store the archived files in the approved backup location with the date, source commit SHA, and checksum values.
5. Export or screenshot the current GitHub Pages settings.
6. Confirm the backup can be restored by checking out the backup tag in a local clone and verifying the archived data files exist.
7. Record the backup location and checksum values in the release issue or approval thread.

## Migration and data-loss verification

Use the migration report as a release gate. It must show no data loss between production v1 and the approved v2 database.

Required evidence:

- row-count comparison for every migrated worksheet/dataset,
- identifier comparison for personas, speed options, pricing schedules, modifiers, relationships, disclaimers, and icons,
- representative pricing schedule comparison,
- modifier, disclaimer, and asset-path comparison,
- full Database Health output with no blocking `BAD`, `ERROR`, or `FAIL` rows,
- sign-off from the data owner.

If the report shows missing records, changed legal copy, unresolved assets, broken relationships, or blocking Database Health rows, stop the cutover and keep v1 in production.

## Release tag `v2.0.0`

Create the tag only after the production PR is merged and the deployed commit is known:

```bash
git fetch origin --tags
git checkout main
git pull --ff-only origin main
git tag -a v2.0.0 -m "Personaville v2.0.0 production release"
git push origin v2.0.0
```

Then create the GitHub Release named `Personaville v2.0.0` from tag `v2.0.0`. The release body should summarize the v2 production changes, link to the migration report, link to rollback instructions, and state that v1.0.0 and later stable releases remain available through existing GitHub tags/releases.

## Rollback procedure

Rollback must restore the last known-good v1 production state without deleting v2 history.

1. Announce rollback and stop further production changes.
2. Identify the pre-cutover tag, for example `production-pre-v2-cutover-YYYYMMDD`.
3. Create a rollback branch from the current production branch:

   ```bash
   git fetch origin --tags
   git checkout main
   git pull --ff-only origin main
   git checkout -b rollback/v2-to-v1
   git restore --source production-pre-v2-cutover-YYYYMMDD -- .
   git commit -m "Rollback production to pre-v2 state"
   git push origin rollback/v2-to-v1
   ```

4. Open and merge a rollback PR through the protected-branch workflow, or use the documented emergency process if production is severely impacted.
5. Confirm GitHub Pages still points to the production branch and root folder `/`.
6. Wait for Pages deployment to finish.
7. Run the rollback smoke test:
   - production URL loads,
   - `database/persona-db.json` loads,
   - persona search/filter works,
   - Export Cart works,
   - known v1 data records are present.
8. Do not delete the `v2.0.0` tag or release. If needed, mark the release notes with a rollback advisory and create a follow-up fix release.

## Post-deployment smoke test

Run this immediately after GitHub Pages reports a successful deployment:

1. Open `https://tf-1031.github.io/Personaville-test/` in a private/incognito browser session.
2. Hard refresh and confirm no stale v1 assets are served.
3. Confirm the application identifies as Personaville v2 in production-facing UI or documentation.
4. Confirm `database/persona-db.json` loads successfully.
5. Run **Admin → Database Health** and verify no blocking `BAD`, `ERROR`, or `FAIL` rows.
6. Search for several known production personas and open their details.
7. Verify representative flat, step, promotional, and price-lock pricing schedules.
8. Verify modifier icons, disclaimers, hero image, and audio player assets.
9. Add multiple personas to Export Cart.
10. Run **Print All** or **Download / Save as PDF** and confirm the browser print workflow opens.
11. Test desktop, tablet, and mobile viewport widths.
12. Record pass/fail results, browser, timestamp, deployed commit SHA, and tester name in the release issue.

If any smoke test fails, classify severity with the release owner. For production-blocking failures, execute the rollback procedure.

## Exact cutover sequence

1. Confirm all non-negotiable prerequisites are complete.
2. Freeze production changes.
3. Back up production branch, data files, and GitHub Pages settings.
4. Confirm v1 tags/releases remain available.
5. Prepare the production cutover branch.
6. Copy or merge the approved v2 files into the production cutover branch.
7. Update production wording and release notes.
8. Run automated tests and Database Health.
9. Open and approve the production cutover PR.
10. Merge the production cutover PR.
11. Confirm GitHub Pages deploys from the production branch root.
12. Run the post-deployment smoke test.
13. Tag the deployed production commit as `v2.0.0`.
14. Publish the GitHub Release `Personaville v2.0.0`.
15. Monitor production and keep rollback owners available through the agreed validation window.
