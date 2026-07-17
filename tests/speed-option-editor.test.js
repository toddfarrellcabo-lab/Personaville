const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, fetch: async () => { throw new Error('fetch unused'); }, XLSX: null };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);

const raw = JSON.parse(fs.readFileSync('database/persona-db.json', 'utf8'));
context.applyRawDatabase(raw, {source: 'bundled', filename: 'database/persona-db.json'});
context.startEditingSession();

const persona = context.databaseState().personas.find(p => context.databaseState().speedOptions.some(s => s.PersonaID === p.PersonaID));
assert(persona, 'fixture should include a persona with speed options');
const source = context.databaseState().speedOptions.find(s => s.PersonaID === persona.PersonaID);
const originalKey = context.speedOptionKey(source);
assert(context.scheduleResolutionForSpeed(source).resolves, 'fixture speed should resolve pricing rows');
assert(context.pricingSummaryForSpeed(source).includes('$') || context.pricingSummaryForSpeed(source).includes('FREE'), 'pricing summary should describe attached pricing');

const duplicateKeyValidation = context.validateSpeedOptionDraft({...source, DisplayOrder: context.speedDisplayOrder(source)}, '');
assert(!duplicateKeyValidation.valid, 'new speed cannot reuse PersonaID + SpeedOption');
assert(duplicateKeyValidation.errors.SpeedOption, 'PersonaID + SpeedOption validation is reported');

const saved = context.saveSpeedOptionDraft({...source, DisplayOrder: context.speedDisplayOrder(source), DisplaySpeed: 'Edited Speed Label'}, originalKey);
assert.strictEqual(saved.DisplaySpeed, 'Edited Speed Label', 'speed option edits are saved');
assert.strictEqual(saved.SortOrder, Number(context.speedDisplayOrder(source)), 'DisplayOrder edits preserve v1 SortOrder JSON compatibility');

const copy = context.duplicateSpeedOption(context.speedOptionKey(saved));
assert.notStrictEqual(context.speedOptionKey(copy), context.speedOptionKey(saved), 'duplicate gets a unique PersonaID + SpeedOption key');
assert.strictEqual(copy.Active, 'FALSE', 'duplicate starts inactive for review');

context.setSpeedOptionActive(context.speedOptionKey(copy), true);
assert.strictEqual(context.databaseState().speedOptions.find(s => context.speedOptionKey(s) === context.speedOptionKey(copy)).Active, 'TRUE', 'activate updates speed option');
context.moveSpeedOption(context.speedOptionKey(copy), -1);
context.removeSpeedOption(context.speedOptionKey(copy));
assert(!context.databaseState().speedOptions.some(s => context.speedOptionKey(s) === context.speedOptionKey(copy)), 'remove deletes speed option from working copy');
context.runDatabaseHealth();
assert(Array.isArray(context.databaseState().health), 'Database Health can be run after speed option edits');

console.log('Speed Option Editor helpers validate, summarize, duplicate, activate, reorder, remove, and preserve JSON compatibility.');
