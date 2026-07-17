const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function storage(){
  const data = new Map();
  return {getItem:key => data.has(key) ? data.get(key) : null, setItem:(key,value) => data.set(key, String(value)), removeItem:key => data.delete(key)};
}

const controls = new Map();
function control(id, value = ''){
  const node = {id, value, textContent:'', disabled:false, checked:false};
  controls.set(id, node);
  return node;
}
control('globalSearch');
control('lifecycleFilter', 'all');
control('personaSelectionCount');
['selectAllPersonas','deselectAllPersonas','selectVisiblePersonas','deselectVisiblePersonas','viewExportCart','clearPersonaCart','clearExportSelection','selectAllVisible'].forEach(id => control(id));

const checkedFamilies = [];
let pricing = '';
const context = {
  console,
  localStorage: storage(),
  document: {
    getElementById(id){ return controls.get(id) || null; },
    querySelector(selector){
      if(selector === 'input[name="pricingFilter"]:checked') return pricing ? {value:pricing} : null;
      return null;
    },
    querySelectorAll(selector){
      if(selector === '#familyFilter input[type="checkbox"]:checked') return checkedFamilies.map(value => ({value}));
      if(selector === '.select-persona input[type=\'checkbox\']') return [];
      return [];
    },
    createElement(tag){ return {tag, setAttribute(){}, appendChild(){}, addEventListener(){}, classList:{toggle(){}}, style:{}}; },
    createTextNode(text){ return {text}; },
    body:{classList:{toggle(){}}}
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/render.js', 'utf8'), context);
vm.runInContext(`
  renderPrintArea = function(){ renderExportCartList(); };
  renderExportCartList = function(){};
  renderExportCartTray = function(){};
  renderTiles = function(){ updatePersonaBulkSelectionToolbar(); };
  syncExportSelectionUI = function(){ updatePersonaBulkSelectionToolbar(); };
`, context);

const raw = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});
const total = vm.runInContext('DB.personas.length', context);
assert(total > 2, 'fixture should include enough personas for bulk tests');

context.selectAllPersonas();
assert.strictEqual(vm.runInContext('exportSelection.size', context), total, 'Select All selects every persona');
context.selectAllPersonas();
assert.strictEqual(vm.runInContext('[...exportSelection].length', context), total, 'repeated Select All does not create duplicates');
assert.match(controls.get('personaSelectionCount').textContent, new RegExp(`${total} of ${total} personas selected|${total} selected`), 'selected count updates immediately');

context.deselectAllPersonas();
assert.strictEqual(vm.runInContext('exportSelection.size', context), 0, 'Deselect All clears the cart');
assert.strictEqual(controls.get('viewExportCart').disabled, true, 'View Cart is disabled when empty');
assert.strictEqual(controls.get('clearPersonaCart').disabled, true, 'Clear Cart is disabled when empty');

const firstFamily = vm.runInContext('DB.personas[0].FamilyGroup', context);
checkedFamilies.splice(0, checkedFamilies.length, firstFamily);
const visibleIds = vm.runInContext('visiblePersonas().map(p => p.PersonaID)', context);
assert(visibleIds.length > 0 && visibleIds.length < total, 'family filter should create a smaller visible set');
context.selectAllVisiblePersonas();
assert.strictEqual(JSON.stringify(vm.runInContext('[...exportSelection].sort()', context)), JSON.stringify([...visibleIds].sort()), 'Select Visible selects only filtered results');
context.selectAllVisiblePersonas();
assert.strictEqual(vm.runInContext('exportSelection.size', context), visibleIds.length, 'repeated visible selection does not create duplicates');

const hiddenId = vm.runInContext('DB.personas.find(p => !visiblePersonas().some(v => v.PersonaID === p.PersonaID)).PersonaID', context);
vm.runInContext(`exportSelection.add(${JSON.stringify(hiddenId)})`, context);
context.deselectVisiblePersonas();
assert.strictEqual(vm.runInContext(`exportSelection.has(${JSON.stringify(hiddenId)})`, context), true, 'Deselect Visible preserves hidden selections');
assert.strictEqual(vm.runInContext('visiblePersonas().some(p => exportSelection.has(p.PersonaID))', context), false, 'Deselect Visible removes filtered results');

context.toggleExportPersona(visibleIds[0], true);
assert.strictEqual(vm.runInContext(`exportSelection.has(${JSON.stringify(visibleIds[0])})`, context), true, 'individual checkbox selection still works');
context.toggleExportPersona(visibleIds[0], false);
assert.strictEqual(vm.runInContext(`exportSelection.has(${JSON.stringify(visibleIds[0])})`, context), false, 'individual checkbox deselection still works');

context.clearExportSelection();
context.selectAllVisiblePersonas();
vm.runInContext('persistExportSelection(); exportSelection.clear(); restoreExportSelection();', context);
assert.strictEqual(vm.runInContext('exportSelection.size', context), visibleIds.length, 'cart state survives reload-style restoration through existing storage');

controls.get('globalSearch').value = 'no persona should match this search term';
context.renderTiles();
assert.strictEqual(controls.get('selectVisiblePersonas').disabled, true, 'empty-result state disables Select Visible');
assert.strictEqual(controls.get('deselectVisiblePersonas').disabled, true, 'empty-result state disables Deselect Visible');

console.log('Bulk persona selection controls update the shared Export Cart correctly.');
