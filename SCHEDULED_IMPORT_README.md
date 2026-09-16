# Personaville Scheduled Import Patch

This build adds a non-destructive **Import as Scheduled Update** path to Database Manager.

## Behavior
- Existing Current/Active personas remain in the working database.
- Incoming personas are added as new persona versions.
- If an incoming PersonaID already exists, a new PM_### ID is assigned and `SupersedesPersonaID` points to the current record.
- Incoming speed options, pricing schedules, disclaimers and changed modifiers are duplicated/remapped so scheduled data does not mutate Current data.
- The selected effective date is applied when the incoming persona does not already have one.
- Scheduled imports receive `LifecycleStatusOverride = Scheduled`.
- The existing **Replace Working Copy** action remains available as a separate destructive workflow.
- Review Data Explorer and Database Health before publishing.

## Important
This is a v2 preview patch. Test with the v6 Current database and Q4 2026 v7 workbook before merging into the production GitHub branch.
