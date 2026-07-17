const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function fakeXlsx(){
  const encode_cell = ({r,c}) => `${String.fromCharCode(65+c)}${r+1}`;
  const decode_range = ref => { const [, sc, sr, ec, er] = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/); return {s:{c:sc.charCodeAt(0)-65,r:Number(sr)-1},e:{c:ec.charCodeAt(0)-65,r:Number(er)-1}}; };
  const aoa_to_sheet = aoa => { const sheet={__aoa:aoa}; aoa.forEach((row,r)=>row.forEach((v,c)=>{ sheet[encode_cell({r,c})]={v,t:typeof v==='number'?'n':'s'}; })); sheet['!ref']=aoa.length?`A1:${encode_cell({r:aoa.length-1,c:Math.max(0,...aoa.map(r=>r.length-1))})}`:'A1:A1'; return sheet; };
  const sheet_to_json = (sheet, opts={}) => { const aoa=sheet.__aoa||[]; if(opts.header===1) return aoa; const [headers=[],...rows]=aoa; return rows.filter(row=>row.some(v=>String(v??'').trim()!=='')).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??'']))); };
  const book_new = () => ({SheetNames:[],Sheets:{}});
  const book_append_sheet = (wb,sheet,name) => { wb.SheetNames.push(name); wb.Sheets[name]=sheet; };
  const write = wb => Buffer.from(JSON.stringify(wb));
  return {utils:{aoa_to_sheet,sheet_to_json,book_new,book_append_sheet,encode_cell,decode_range},write,read:buf=>JSON.parse(Buffer.from(buf).toString())};
}
const context = {console, fetch: async()=>{throw new Error('unused')}, XLSX: fakeXlsx(), TextEncoder, TextDecoder, Buffer, localStorage:{data:{},getItem(k){return this.data[k]||null},setItem(k,v){this.data[k]=v},removeItem(k){delete this.data[k]}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js','utf8'), context);
const published = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
context.applyRawDatabase(published, {source:'bundled', filename:'database/persona-db.json'});
context.initializeEditingSessionFromPublished(published, {filename:'database/persona-db.json', restoreSaved:false});
function workbookFromRaw(raw){ context.XLSX.write.last=''; context.databaseWorkbookBytes('working', {date:new Date('2026-07-17T00:00:00Z')}); return JSON.parse(context.XLSX.write.last); }
context.XLSX.write = wb => { context.XLSX.write.last = JSON.stringify(wb); return Buffer.from(context.XLSX.write.last); };
let book = workbookFromRaw(published);
let state = context.prepareWorkbookImportFromWorkbook(book, 'clean.xlsx');
assert.strictEqual(state.status, 'ready');
Object.values(state.summary).forEach(s => assert.strictEqual(s.added+s.changed+s.removed, 0, 'clean round trip has zero data changes'));
assert.strictEqual(state.changes.length, 0, 'clean round trip has zero field changes');
assert.strictEqual(state.summary['05_Personas'].totalAfter, published['05_Personas'].length);

book.Sheets['05_Personas'].__aoa[1][book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaName')] += ' Edited';
state = context.prepareWorkbookImportFromWorkbook(book, 'edit.xlsx');
assert.strictEqual(state.summary['05_Personas'].changed, 1, 'one persona edit detected');
assert.strictEqual(state.changes.some(c => c.field === 'PersonaName'), true);

const personaRow = [...book.Sheets['05_Personas'].__aoa[1]];
personaRow[book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaID')] = 'UNIT_NEW';
book.Sheets['05_Personas'].__aoa.push(personaRow);
state = context.prepareWorkbookImportFromWorkbook(book, 'add.xlsx');
assert.strictEqual(state.summary['05_Personas'].added, 1, 'added persona detected');

book = workbookFromRaw(published);
const removedPersonaId = book.Sheets['05_Personas'].__aoa[1][book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaID')];
book.Sheets['05_Personas'].__aoa.splice(1,1);
for(const sheetName of ['06_SpeedOptions','10_PersonaModifiers']){
  const h = book.Sheets[sheetName].__aoa[0];
  const idx = h.indexOf('PersonaID');
  book.Sheets[sheetName].__aoa = [h, ...book.Sheets[sheetName].__aoa.slice(1).filter(row => row[idx] !== removedPersonaId)];
}
state = context.prepareWorkbookImportFromWorkbook(book, 'remove.xlsx');
assert.strictEqual(state.summary['05_Personas'].removed, 1, 'removed persona detected');
assert.throws(()=>context.applyPreparedWorkbookImport({replaceWorkingCopy:true}), /proposes deletions/);
context.applyPreparedWorkbookImport({replaceWorkingCopy:true, confirmDeletions:true});
assert.notDeepStrictEqual(context.activeDatabaseSnapshot(), published, 'import applies to working copy');
assert.strictEqual(context.publishedDatabaseSnapshot()['05_Personas'].length, published['05_Personas'].length, 'published snapshot count unchanged');
context.restorePreImportState();
assert.strictEqual(context.activeDatabaseSnapshot()['05_Personas'].length, published['05_Personas'].length, 'pre-import restore works');

book = workbookFromRaw(published);
book.Sheets['07_PricingSchedules'].__aoa[1][book.Sheets['07_PricingSchedules'].__aoa[0].indexOf('Price')] = 123.45;
state = context.prepareWorkbookImportFromWorkbook(book, 'price.xlsx');
assert.strictEqual(state.summary['07_PricingSchedules'].changed, 1, 'pricing value change detected');

book = workbookFromRaw(published);
book.Sheets['08_Disclaimers'].__aoa[1][book.Sheets['08_Disclaimers'].__aoa[0].indexOf('DisclaimerText')] = 'Exact disclaimer text edit.';
state = context.prepareWorkbookImportFromWorkbook(book, 'disclaimer.xlsx');
assert.strictEqual(state.changes.some(c => c.sheet === '08_Disclaimers' && c.field === 'DisclaimerText'), true);

book = workbookFromRaw(published);
book.Sheets['05_Personas'].__aoa[1][book.Sheets['05_Personas'].__aoa[0].indexOf('EffectiveStartDate')] = '2026-02-03';
state = context.prepareWorkbookImportFromWorkbook(book, 'date.xlsx');
assert.strictEqual(state.changes.some(c => c.field === 'EffectiveStartDate' && c.after === '2026-02-03'), true, 'date-only edit does not shift');

book = workbookFromRaw(published);
book.Sheets['05_Personas'].__aoa[2][book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaID')] = book.Sheets['05_Personas'].__aoa[1][book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaID')];
assert.strictEqual(context.prepareWorkbookImportFromWorkbook(book, 'dup.xlsx').status, 'invalid');

book = workbookFromRaw(published);
book.Sheets['10_PersonaModifiers'].__aoa[1][book.Sheets['10_PersonaModifiers'].__aoa[0].indexOf('PersonaID')] = 'NO_SUCH';
assert.strictEqual(context.prepareWorkbookImportFromWorkbook(book, 'broken.xlsx').status, 'invalid');

book = workbookFromRaw(published);
delete book.Sheets['05_Personas']; book.SheetNames = book.SheetNames.filter(n => n !== '05_Personas');
assert.strictEqual(context.prepareWorkbookImportFromWorkbook(book, 'missing.xlsx').status, 'invalid');

book = workbookFromRaw(published);
book.Sheets['05_Personas'].__aoa[0][book.Sheets['05_Personas'].__aoa[0].indexOf('PersonaID')] = 'Persona Id';
assert.strictEqual(context.prepareWorkbookImportFromWorkbook(book, 'header.xlsx').status, 'invalid');
assert.throws(()=>context.validateWorkbookFile({name:'bad.csv', size:1}), /Unsupported file type/);
assert.throws(()=>context.XLSX.read(Buffer.from('not json')), /Unexpected token|JSON/);

book = workbookFromRaw(published);
const dirty = context.activeDatabaseSnapshot(); dirty['05_Personas'][0].PersonaName += ' Dirty'; context.updateWorkingCopy(dirty, 'dirty');
state = context.prepareWorkbookImportFromWorkbook(book, 'dirty.xlsx');
assert.strictEqual(context.workbookImportRequiresDirtyDecision(), true, 'dirty working copy warning required');
assert.throws(()=>context.applyPreparedWorkbookImport({confirmDeletions:true}), /unsaved changes/);
context.applyPreparedWorkbookImport({replaceWorkingCopy:true, confirmDeletions:true});
assert(context.localStorage.data[context.editingSessionState().storageKey], 'imported working copy persists for refresh');
console.log('Workbook import validates round-trip, edits, additions/removals, pricing/disclaimers/dates, invalid workbooks, dirty-copy protection, restore, published safety, and persistence.');
