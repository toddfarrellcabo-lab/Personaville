const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { console, window:{}, document:{}, Audio:function(){}, fetch(){} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js','utf8'), context);
context.applyRawDatabase(JSON.parse(fs.readFileSync('database/persona-db.json','utf8')), {source:'bundled', filename:'database/persona-db.json'});

const modifier = context.saveModifierDraft({ModifierID:context.nextSafeModifierID(), ModifierName:'Test Modifier', Category:'Ratecard Modifier', IconFile:'icon-Standard.png', Active:'TRUE', Description:'Test description'}, '');
assert(modifier.ModifierID, 'modifier can be created');
context.setModifierActive(modifier.ModifierID, false);
assert.strictEqual(context.databaseState().modifiers.find(row => row.ModifierID === modifier.ModifierID).Active, 'FALSE', 'modifier can be deactivated');

const personaID = context.databaseState().personas[0].PersonaID;
context.savePersonaModifierDraft({PersonaID:personaID, ModifierID:modifier.ModifierID, DisplayOrder:99, Active:'TRUE'}, '');
assert.throws(() => context.savePersonaModifierDraft({PersonaID:personaID, ModifierID:modifier.ModifierID, DisplayOrder:100, Active:'TRUE'}, ''), /already exists/, 'duplicate PersonaID + ModifierID relationships are blocked');
assert(context.modifierRelationships(modifier.ModifierID).some(row => row.PersonaID === personaID), 'modifier usage lists linked personas');
assert(Array.isArray(context.expectedModifierWarningsForPersona(personaID)), 'expected modifier warnings are available');
context.removePersonaModifier(personaID, modifier.ModifierID);
assert(!context.databaseState().personaModifiers.some(row => row.PersonaID === personaID && row.ModifierID === modifier.ModifierID), 'persona modifier relationship can be removed');

const originalDisclaimer = context.databaseState().disclaimers[0];
const copy = context.duplicateDisclaimer(originalDisclaimer.DisclaimerID);
assert.notStrictEqual(copy.DisclaimerID, originalDisclaimer.DisclaimerID, 'disclaimer can be duplicated');
assert.strictEqual(copy.DisclaimerText, originalDisclaimer.DisclaimerText, 'duplicating preserves legal copy exactly');
assert(context.personasUsingDisclaimer(originalDisclaimer.DisclaimerID).length > 0, 'linked personas can be inspected for disclaimers');
assert(Array.isArray(context.missingDisclaimerRelationships()), 'missing disclaimer relationships can be validated');
context.saveDisclaimerDraft({...copy, DisclaimerText:copy.DisclaimerText + ' Test suffix.'}, copy.DisclaimerID);
assert(context.databaseState().disclaimers.find(row => row.DisclaimerID === copy.DisclaimerID).DisclaimerText.endsWith(' Test suffix.'), 'full disclaimer text can be edited without rewriting');

const health = context.runDatabaseHealth();
assert(Array.isArray(health), 'Database Health runs after modifier and disclaimer edits');
console.log('Modifier, persona modifier relationship, and disclaimer editor helpers create, edit, validate duplicates, preserve legal copy, and run health.');
