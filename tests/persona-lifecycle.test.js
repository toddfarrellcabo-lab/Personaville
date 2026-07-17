const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {TextEncoder, TextDecoder} = require('util');

const context = { console, fetch: async () => { throw new Error('fetch unused'); }, XLSX: null, TextEncoder, TextDecoder, Blob, Buffer };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);

const TEST_TODAY = '2026-07-16';
context.setPersonaCurrentDateProvider(() => TEST_TODAY);
const raw = JSON.parse(fs.readFileSync('database/persona-db.json', 'utf8'));
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});

// 1. Draft with no dates
assert.strictEqual(context.personaLifecycleStatus({Status:'Draft'}), 'Draft');
// 2. Future start → Scheduled
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', EffectiveStartDate:'2026-08-01'}), 'Scheduled');
// 3. Start today → Active
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', EffectiveStartDate:TEST_TODAY}), 'Active');
// 4. Blank end → indefinite
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', EffectiveStartDate:'2026-01-01', EffectiveEndDate:''}), 'Active');
// 5. End today → Active
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', EffectiveStartDate:'2026-01-01', EffectiveEndDate:TEST_TODAY}), 'Active');
// 6. After end → Expired
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', EffectiveEndDate:'2026-07-15'}), 'Expired');
// 7. Manual Inactive override
assert.strictEqual(context.personaLifecycleStatus({Status:'Active', LifecycleStatusOverride:'Inactive'}), 'Inactive');
// 15. Legacy active record without dates
const legacy = context.databaseState().personas.find(p => p.Status === 'Active' && !p.EffectiveStartDate && !p.EffectiveEndDate);
assert(legacy, 'fixture includes a legacy active persona');
assert.strictEqual(context.personaLifecycleStatus(legacy), 'Active', 'legacy active records without dates remain active');

// 8. End before start → error
let validation = context.validatePersonaDraft({...legacy, PersonaID:'PM_TEST_END', EffectiveStartDate:'2026-08-01', EffectiveEndDate:'2026-07-31'}, '');
assert.strictEqual(validation.valid, false);
assert.match(validation.errors.EffectiveEndDate, /before start/);

// 9. Replacement starts day after predecessor ends
context.startEditingSession();
const source = legacy.PersonaID;
const preview = context.createUpdatedPersonaVersion(source, '2026-08-01', false, 'Unit Test');
assert.strictEqual(preview.newDraft.SupersedesPersonaID, source, 'preview links replacement to source');
assert.strictEqual(preview.sourceAfter.EffectiveEndDate, '2026-07-31', 'preview suggests source end date one day earlier');
assert(!context.databaseState().personas.some(p => p.PersonaID === preview.newDraft.PersonaID), 'preview does not silently overwrite source or add draft');
const saved = context.createUpdatedPersonaVersion(source, '2026-08-01', true, 'Unit Test');
assert(saved.PersonaID !== source, 'confirmed replacement gets a new PersonaID');
assert.strictEqual(saved.SupersedesPersonaID, source, 'confirmed replacement stores SupersedesPersonaID');
assert.strictEqual(context.databaseState().personas.find(p => p.PersonaID === source).EffectiveEndDate, '2026-07-31', 'confirmed replacement updates source end date');

function lifecycleHealthFor(personas){
  const testRaw = JSON.parse(JSON.stringify(raw));
  testRaw['05_Personas'] = personas;
  context.applyRawDatabase(testRaw, {source:'bundled', filename:'lifecycle-health.json'});
  return context.runDatabaseHealth().find(row => row.Check === 'Persona lifecycle scheduling');
}
const base = {...legacy, FamilyGroup:legacy.FamilyGroup || 'FG', PricingSet:legacy.PricingSet || 'PS'};
// 10. Overlap warning/error
let health = lifecycleHealthFor([
  {...base, PersonaID:'PM_A', EffectiveStartDate:'2026-01-01', EffectiveEndDate:'2026-07-31', SupersedesPersonaID:''},
  {...base, PersonaID:'PM_B', EffectiveStartDate:'2026-07-15', EffectiveEndDate:'', SupersedesPersonaID:'PM_A'}
]);
assert.strictEqual(health.Status, 'BAD');
assert.match(health.Details, /overlapping effective date ranges/);
// 11. Missing supersedes target
health = lifecycleHealthFor([{...base, PersonaID:'PM_MISS', SupersedesPersonaID:'PM_NOPE'}]);
assert.match(health.Details, /target is missing/);
// 12. Self-superseding
health = lifecycleHealthFor([{...base, PersonaID:'PM_SELF', SupersedesPersonaID:'PM_SELF'}]);
assert.match(health.Details, /cannot reference itself/);
// 13. Circular chain
health = lifecycleHealthFor([
  {...base, PersonaID:'PM_C1', SupersedesPersonaID:'PM_C2'},
  {...base, PersonaID:'PM_C2', SupersedesPersonaID:'PM_C1'}
]);
assert.match(health.Details, /circular/);
// 14. Multiple open-ended active versions
health = lifecycleHealthFor([
  {...base, PersonaID:'PM_O1', EffectiveStartDate:'2026-01-01', EffectiveEndDate:'', SupersedesPersonaID:''},
  {...base, PersonaID:'PM_O2', EffectiveStartDate:'2026-02-01', EffectiveEndDate:'', SupersedesPersonaID:'PM_O1'}
]);
assert.match(health.Details, /open-ended active versions|overlapping effective date ranges/);

// 16. JSON round trip
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});
context.startEditingSession();
const jsonDraft = {...legacy, PersonaID:'PM_JSON_RT', Status:'Active', EffectiveStartDate:'2026-07-16', EffectiveEndDate:'', SupersedesPersonaID:legacy.PersonaID, LifecycleStatusOverride:''};
context.savePersonaDraft(jsonDraft, '', 'Unit Test');
const parsed = JSON.parse(context.updatedDatabaseJson());
const roundTrip = parsed['05_Personas'].find(p => p.PersonaID === 'PM_JSON_RT');
assert.strictEqual(roundTrip.EffectiveStartDate, '2026-07-16');
assert.strictEqual(roundTrip.EffectiveEndDate, '');
assert.strictEqual(roundTrip.SupersedesPersonaID, legacy.PersonaID);
assert.strictEqual(roundTrip.LifecycleStatusOverride, '');

// 17. Workbook import with columns (simulated normalized workbook rows)
context.applyRawDatabase({'05_Personas':[jsonDraft]}, {source:'workbook', filename:'unit.xlsx'});
assert.strictEqual(context.databaseState().loadedFromWorkbook, true);
assert.strictEqual(context.databaseState().personas[0].EffectiveStartDate, '2026-07-16');
assert.strictEqual(context.databaseState().personas[0].SupersedesPersonaID, legacy.PersonaID);

// 18. Publishing package includes fields
context.markDatabaseHealthReviewed();
const files = context.publishingPackageFiles({overrideHealthErrors:true});
const packageJson = JSON.parse(new TextDecoder().decode(files.find(file => file.path === 'database/persona-db.json').bytes));
assert('EffectiveStartDate' in packageJson['05_Personas'][0]);
assert('EffectiveEndDate' in packageJson['05_Personas'][0]);
assert('SupersedesPersonaID' in packageJson['05_Personas'][0]);
assert('LifecycleStatusOverride' in packageJson['05_Personas'][0]);

// 19. Undo/redo
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});
context.startEditingSession();
context.savePersonaDraft({...legacy, PersonaName:'Lifecycle Undo Name'}, legacy.PersonaID, 'Unit Test');
assert.strictEqual(context.databaseState().personas.find(p => p.PersonaID === legacy.PersonaID).PersonaName, 'Lifecycle Undo Name');
assert(context.undoLastEdit());
assert.notStrictEqual(context.databaseState().personas.find(p => p.PersonaID === legacy.PersonaID).PersonaName, 'Lifecycle Undo Name');
assert(context.redoLastEdit());
assert.strictEqual(context.databaseState().personas.find(p => p.PersonaID === legacy.PersonaID).PersonaName, 'Lifecycle Undo Name');

// 20. Refresh recalculates status with the injected date provider, not the real date.
const scheduled = {Status:'Active', EffectiveStartDate:'2026-07-17'};
assert.strictEqual(context.personaLifecycleStatus(scheduled), 'Scheduled');
context.setPersonaCurrentDateProvider(() => '2026-07-17');
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});
assert.strictEqual(context.personaLifecycleStatus(scheduled), 'Active');

console.log('Persona lifecycle scheduling covers date derivation, validation, version chains, imports/exports, undo/redo, and refresh recalculation.');
