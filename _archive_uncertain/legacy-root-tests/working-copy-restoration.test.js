const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function storage(initial={}){
  const data = {...initial};
  return {data, getItem:k => Object.prototype.hasOwnProperty.call(data,k) ? data[k] : null, setItem:(k,v) => { data[k]=String(v); }, removeItem:k => { delete data[k]; }, key:i => Object.keys(data)[i], get length(){ return Object.keys(data).length; }};
}
function makeContext(extra={}){
  const context = {console, TextEncoder, XLSX:null, localStorage:storage(), ...extra};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/database.js','utf8'), context);
  return context;
}
function loadPublished(context){
  const raw = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
  context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});
  return raw;
}
function countsMatchPublished(context){
  assert.deepStrictEqual(context.collectionCounts(context.activeDatabaseSnapshot()), context.collectionCounts(context.publishedDatabaseSnapshot()));
}

const published = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));

// 1. first-ever load with no storage.
{
  const context = makeContext();
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  countsMatchPublished(context);
  assert.strictEqual(context.editingChangeList().length, 0);
  assert.strictEqual(context.editingHasUnsavedChanges(), false);
}

// 2. reset followed by simulated reload.
{
  const shared = storage();
  let context = makeContext({localStorage:shared});
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  const edited = context.activeDatabaseSnapshot();
  edited['05_Personas'][0].PersonaName += ' reset test';
  context.updateWorkingCopy(edited, 'persona-save');
  context.resetWorkingCopyFromPublished();
  assert.strictEqual(context.editingChangeList().length, 0);
  context = makeContext({localStorage:shared});
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  countsMatchPublished(context);
  assert.strictEqual(context.editingChangeList().length, 0);
}

// 3. valid saved draft restores and only genuine changes appear.
{
  const shared = storage();
  let context = makeContext({localStorage:shared});
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  const original = context.activeDatabaseSnapshot()['05_Personas'][0].PersonaName;
  const edited = context.activeDatabaseSnapshot();
  edited['05_Personas'][0].PersonaName = `${original} draft`;
  context.updateWorkingCopy(edited, 'persona-save');
  context = makeContext({localStorage:shared});
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  const changes = context.editingChangeList();
  assert.strictEqual(context.activeDatabaseSnapshot()['05_Personas'][0].PersonaName, `${original} draft`);
  assert.strictEqual(changes.filter(c => c.field === 'PersonaName').length, 1);
  assert(!changes.some(c => c.kind === 'deleted record'));
}

// 4-7 invalid saved sessions are safely ignored.
for(const scenario of ['empty object','empty collections','malformed JSON','stale schema version']){
  const context = makeContext();
  loadPublished(context);
  const identity = context.databaseIdentityFor(context.databaseState().raw, 'database/persona-db.json');
  const key = context.editingSessionStorageKey(identity);
  const emptyCollections = {'05_Personas':[], '06_SpeedOptions':[], '07_PricingSchedules':[], '04_Modifiers':[], '08_Disclaimers':[]};
  if(scenario === 'empty object') context.localStorage.setItem(key, JSON.stringify({schemaVersion:'2', databaseIdentity:identity, workingRaw:{}}));
  if(scenario === 'empty collections') context.localStorage.setItem(key, JSON.stringify({schemaVersion:'2', databaseIdentity:identity, workingRaw:emptyCollections, commands:[]}));
  if(scenario === 'malformed JSON') context.localStorage.setItem(key, '{bad json');
  if(scenario === 'stale schema version') context.localStorage.setItem(key, JSON.stringify({schemaVersion:'1', databaseIdentity:identity, workingRaw:published}));
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  countsMatchPublished(context);
  assert.strictEqual(context.editingChangeList().length, 0, scenario);
  assert.strictEqual(context.editingHasUnsavedChanges(), false, scenario);
  assert(scenario === 'malformed JSON' || context.editingSessionState().notice.includes('invalid saved editing session'), scenario);
}

// 8. delayed published-data fetch does not diff before readiness and ends clean.
async function delayedFetchRegression(){
  let release;
  const delayed = new Promise(resolve => { release = () => resolve({ok:true, json:async () => published}); });
  const context = makeContext({fetch:() => delayed});
  const loading = context.loadBundledDatabase();
  assert.strictEqual(context.editingChangeList().length, 0);
  release();
  await loading;
  countsMatchPublished(context);
  assert.strictEqual(context.editingChangeList().length, 0);
}

// 9. one intentional edit reports exactly that changed field.
{
  const context = makeContext();
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  const edited = context.activeDatabaseSnapshot();
  edited['05_Personas'][0].PersonaName += ' one edit';
  context.updateWorkingCopy(edited, 'persona-save');
  const changes = context.editingChangeList();
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].field, 'PersonaName');
}

// 10. one intentional deletion reports exactly that deleted record.
{
  const context = makeContext();
  loadPublished(context);
  context.initializeEditingSessionFromPublished(context.databaseState().raw, {filename:'database/persona-db.json'});
  const edited = context.activeDatabaseSnapshot();
  edited['05_Personas'].splice(0, 1);
  context.updateWorkingCopy(edited, 'delete-persona');
  const changes = context.editingChangeList().filter(c => c.kind === 'deleted record');
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].sheet, '05_Personas');
}

delayedFetchRegression().then(() => {
  console.log('Working-copy restoration validates storage, reset/reload, startup counts, delayed fetch, and focused diffs.');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
