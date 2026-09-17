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

const publishedRaw = JSON.parse(fs.readFileSync('database/persona-db.json', 'utf8'));
context.applyRawDatabase(publishedRaw, {source: 'bundled', filename: 'database/persona-db.json'});

const originalPublishedName = context.publishedDatabaseSnapshot()['05_Personas'][0].PersonaName;
context.startEditingSession();
assert.strictEqual(context.editingSessionState().isEditing, true, 'startEditingSession should activate editing');
assert.strictEqual(context.editingHasUnsavedChanges(), false, 'new edit session should start clean');

const changedRaw = context.activeDatabaseSnapshot();
changedRaw['05_Personas'][0].PersonaName = `${originalPublishedName} edited`;
context.updateWorkingCopy(changedRaw, 'test-change', {sheet: '05_Personas'});

assert.strictEqual(context.editingHasUnsavedChanges(), true, 'working-copy mutation should be dirty');
assert.strictEqual(context.databaseState().personas[0].PersonaName, `${originalPublishedName} edited`, 'active database should read from working copy');
assert.strictEqual(context.publishedDatabaseSnapshot()['05_Personas'][0].PersonaName, originalPublishedName, 'published database should remain unchanged');
assert(Object.values(context.editingSessionState().recordStates).includes('modified'), 'changed record should be marked modified');
assert.strictEqual(context.editingSessionState().commands.length, 1, 'snapshot command should be recorded for future undo/redo');

context.discardWorkingChanges();
assert.strictEqual(context.editingHasUnsavedChanges(), false, 'discard should return to last saved/downloaded snapshot');
assert.strictEqual(context.databaseState().personas[0].PersonaName, originalPublishedName, 'discard should restore working copy');

const changedAgain = context.activeDatabaseSnapshot();
changedAgain['05_Personas'][0].PersonaName = 'temporary reset test';
context.updateWorkingCopy(changedAgain, 'test-change');
context.resetWorkingCopyFromPublished();
assert.strictEqual(context.editingHasUnsavedChanges(), false, 'reset from published should leave clean working copy');
assert.strictEqual(context.databaseState().personas[0].PersonaName, originalPublishedName, 'reset should restore published data into working copy');
assert.strictEqual(context.publishedDatabaseSnapshot()['05_Personas'][0].PersonaName, originalPublishedName, 'published data should still be unchanged after reset');

console.log('Editing session architecture keeps published data safe while tracking dirty working-copy changes.');
