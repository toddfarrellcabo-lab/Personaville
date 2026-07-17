const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
  console,
  fetch: async () => { throw new Error('fetch is not used in this test'); },
  XLSX: null
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);

const workbookRaw = JSON.parse(fs.readFileSync('database/persona-db.json', 'utf8'));

assert.strictEqual(context.resolveIconPath('icon-Standard.png'), 'assets/icons/icon-Standard.png');
assert.strictEqual(context.resolveIconPath('assets/icons/icon-Standard.png'), 'assets/icons/icon-Standard.png');
assert.strictEqual(context.resolveIconPath('icons/icon-Standard.png'), 'assets/icons/icon-Standard.png');
assert.strictEqual(context.resolveIconPath('./assets/icons/icon-Standard.png'), 'assets/icons/icon-Standard.png');
assert.strictEqual(context.resolveIconPath('assets/icons/icons/icon-Standard.png'), 'assets/icons/icon-Standard.png');
assert.strictEqual(context.resolveIconPath('assets/icons/assets/icons/icon-Standard.png'), 'assets/icons/icon-Standard.png');
const correctedSchedule = workbookRaw['07_PricingSchedules'].find(row => row.ScheduleID === 'SCH_091');
assert(correctedSchedule, 'fixture should include SCH_091');
correctedSchedule.DisplayLabel = 'SCH_091 uploaded workbook correction';
correctedSchedule.Price = 91.91;

context.applyRawDatabase(workbookRaw, {source: 'workbook'});
context.startEditingSession();
const iconPersona = context.databaseState().personas[0];
const savedIconPersona = context.savePersonaDraft({...iconPersona, PromoIcon: 'assets/icons/icons/icon-Standard.png'}, iconPersona.PersonaID, 'Unit Test');
assert.strictEqual(savedIconPersona.PromoIcon, 'icon-Standard.png', 'Persona Editor saves normalized promotion icon filenames only');
const exported = JSON.parse(context.updatedDatabaseJson());
const exportedCorrection = exported['07_PricingSchedules'].find(row => row.ScheduleID === 'SCH_091');

assert.strictEqual(exportedCorrection.DisplayLabel, 'SCH_091 uploaded workbook correction');
assert.strictEqual(exportedCorrection.Price, 91.91);
assert.deepStrictEqual(Object.keys(exported), Object.keys(workbookRaw));
assert(!Object.prototype.hasOwnProperty.call(exported['05_Personas'][0], 'speeds'), 'download JSON should not include runtime persona fields');
assert(!Object.prototype.hasOwnProperty.call(exported['09_Icons'][0], 'ResolvedPath'), 'download JSON should not include runtime icon fields');
console.log('SCH_091 workbook correction appears in downloadable persona-db.json payload.');
