const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {console, fetch: async () => { throw new Error('fetch unused'); }};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);

const raw = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});

const report = context.healthExportPayload('report');
assert.match(report.filename, /^Personaville-Health-Report-\d{8}-\d{4}\.csv$/);
assert(report.text.startsWith('\ufeffSeverity,Section,Check,PersonaID,PersonaName,SpeedOptionID,SpeedOption,ScheduleID,ReferenceID,ModifierID,DisclaimerID,AssetPath,Message,ExistingValue,ExpectedValue,SuggestedAction'), 'CSV export uses the required UTF-8 Excel header');
assert(!report.text.includes('12_DataHealth'), 'CSV export excludes stale workbook health summaries');

const warnings = context.healthExportPayload('warnings');
assert.match(warnings.filename, /^Personaville-Health-Warnings-\d{8}-\d{4}\.csv$/);
assert(!warnings.text.split('\r\n').slice(1).some(line => line && !line.startsWith('WARN,')), 'warnings export only includes WARN rows');

const errors = context.healthExportPayload('errors');
assert.match(errors.filename, /^Personaville-Health-Errors-\d{8}-\d{4}\.csv$/);
assert.strictEqual(errors.count, 0, 'checked-in live working copy has no error export findings');

const log = context.healthExportPayload('log');
assert.match(log.filename, /^Personaville-Health-Log-\d{8}-\d{4}\.txt$/);
assert(log.text.includes('Generated:'), 'log includes generated time');
assert(log.text.includes('Source: database/persona-db.json'), 'log includes source');
assert(log.text.includes('Version:'), 'log includes version');
assert(log.text.includes('Dirty state:'), 'log includes dirty state');
assert(log.text.includes('Counts:'), 'log includes counts');

console.log('Health exports use live working-copy findings, required filenames, CSV headers, and log metadata.');
