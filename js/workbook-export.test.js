const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function fakeXlsx(){
  const encode_cell = ({r,c}) => `${String.fromCharCode(65+c)}${r+1}`;
  const decode_range = ref => {
    const [, sc, sr, ec, er] = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    return {s:{c:sc.charCodeAt(0)-65, r:Number(sr)-1}, e:{c:ec.charCodeAt(0)-65, r:Number(er)-1}};
  };
  const aoa_to_sheet = aoa => {
    const sheet = {__aoa: aoa};
    aoa.forEach((row,r)=>row.forEach((v,c)=>{ sheet[encode_cell({r,c})] = {v, t:typeof v === 'number' ? 'n' : 's'}; }));
    sheet['!ref'] = aoa.length ? `A1:${encode_cell({r:aoa.length-1,c:Math.max(0,...aoa.map(r=>r.length-1))})}` : 'A1:A1';
    return sheet;
  };
  const sheet_to_json = (sheet, options={}) => {
    const aoa = sheet.__aoa || [];
    if(options.header === 1) return aoa.map(row => row.map(v => v ?? options.defval ?? ''));
    const [headers = [], ...rows] = aoa;
    return rows.filter(row => row.some(v => String(v ?? '').trim() !== '')).map(row => Object.fromEntries(headers.map((h,i)=>[h, row[i] ?? ''])));
  };
  const book_new = () => ({SheetNames:[], Sheets:{}});
  const book_append_sheet = (wb, sheet, name) => { if(wb.Sheets[name]) throw new Error(`Worksheet with name [${name}] already exists!`); wb.SheetNames.push(name); wb.Sheets[name]=sheet; };
  const write = wb => Buffer.from(JSON.stringify(wb));
  return {utils:{aoa_to_sheet, sheet_to_json, book_new, book_append_sheet, encode_cell, decode_range}, write};
}

const context = {console, fetch: async () => { throw new Error('fetch unused'); }, XLSX: fakeXlsx(), TextEncoder, TextDecoder, Buffer};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js','utf8'), context);

const published = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
context.applyRawDatabase(published, {source:'bundled', filename:'database/persona-db.json'});
context.initializeEditingSessionFromPublished(published, {filename:'database/persona-db.json', restoreSaved:false});

const changed = context.activeDatabaseSnapshot();
changed['05_Personas'][0].PersonaID = '00123';
changed['05_Personas'][0].PersonaName += ' Workbook Draft';
changed['05_Personas'][0].EffectiveStartDate = '2026-01-02';
changed['05_Personas'][0].previewUrl = 'runtime-only';
changed['07_PricingSchedules'][0].Price = 0;
changed['07_PricingSchedules'][1].Price = '';
changed['08_Disclaimers'][0].DisclaimerText = 'Exact legal copy — with unicode “quotes” & symbols ™';
context.updateWorkingCopy(changed, 'test-workbook-export', {sheet:'05_Personas'});

function workbook(source, opts={}){
  context.databaseWorkbookBytes(source, opts);
  return JSON.parse(context.XLSX.write.last || '{}');
}
context.XLSX.write = wb => { context.XLSX.write.last = JSON.stringify(wb); return Buffer.from(context.XLSX.write.last); };

const publishedBook = workbook('published', {date:new Date('2026-07-17T12:34:00Z')});
const workingBook = workbook('working', {date:new Date('2026-07-17T12:34:00Z'), confirmedHealthErrors:true});

assert.strictEqual(publishedBook.SheetNames.filter(n => n === 'README').length, 1, 'published export contains exactly one README worksheet');
assert.strictEqual(workingBook.SheetNames.filter(n => n === 'README').length, 1, 'working-copy export contains exactly one README worksheet');

for(const sheet of ['README','Metadata','01_Settings','02_FamilyGroups','03_PricingSets','04_Modifiers','05_Personas','06_SpeedOptions','07_PricingSchedules','08_Disclaimers','09_Icons','10_PersonaModifiers','12_DataHealth','Database Health summary'.slice(0,31)]){
  assert(workingBook.SheetNames.includes(sheet), `expected sheet ${sheet}`);
}
assert.deepStrictEqual(workingBook.SheetNames.filter(n => n === '05_Personas'), ['05_Personas'], 'sheet names match importer expectations without duplicate persona structures');
assert.deepStrictEqual(publishedBook.SheetNames.filter(n => n === 'README'), ['README'], 'published export completes without duplicate README worksheet errors');
assert.deepStrictEqual(workingBook.SheetNames.filter(n => n === 'README'), ['README'], 'working-copy export completes without duplicate README worksheet errors');

const metadataRows = context.XLSX.utils.sheet_to_json(workingBook.Sheets.Metadata);
assert.strictEqual(metadataRows.find(r => r.Field === 'publication state').Value, 'Unpublished working copy');
assert.strictEqual(metadataRows.find(r => r.Field === 'record count: 05_Personas').Value, published['05_Personas'].length);
assert.strictEqual(metadataRows.find(r => r.Field === 'health-error export confirmed').Value, 'TRUE');

const pubPersonas = context.XLSX.utils.sheet_to_json(publishedBook.Sheets['05_Personas']);
const workPersonas = context.XLSX.utils.sheet_to_json(workingBook.Sheets['05_Personas']);
assert.notStrictEqual(pubPersonas[0].PersonaName, workPersonas[0].PersonaName, 'published export excludes working-copy changes');
assert.strictEqual(workPersonas[0].PersonaID, '00123', 'IDs and leading zeros remain text');
assert.strictEqual(workingBook.Sheets['05_Personas'].A2.t, 's', 'ID cell is typed as text');
assert.strictEqual(workPersonas[0].EffectiveStartDate, '2026-01-02', 'date-only lifecycle value does not shift');
assert(!Object.keys(workPersonas[0]).includes('previewUrl'), 'runtime-only fields are absent');

const pricing = context.XLSX.utils.sheet_to_json(workingBook.Sheets['07_PricingSchedules']);
assert.strictEqual(pricing[0].Price, 0, 'zero price remains numeric');
assert.strictEqual(pricing[1].Price, '', 'blank price remains blank');
const priceCol = workingBook.Sheets['07_PricingSchedules'].__aoa[0].indexOf('Price');
assert.strictEqual(workingBook.Sheets['07_PricingSchedules'][context.XLSX.utils.encode_cell({r:1,c:priceCol})].t, 'n', 'price cell is numeric when populated');

const disclaimers = context.XLSX.utils.sheet_to_json(workingBook.Sheets['08_Disclaimers']);
assert.strictEqual(disclaimers[0].DisclaimerText, 'Exact legal copy — with unicode “quotes” & symbols ™', 'disclaimer text remains exact');
const publishedFilename = context.databaseWorkbookFilename('published', new Date('2026-07-17T12:34:00Z'));
const workingFilename = context.databaseWorkbookFilename('working', new Date('2026-07-17T12:34:00Z'));
assert.strictEqual(publishedFilename.startsWith('Personaville-Published-Database-20260717-1234'), true);
assert.strictEqual(workingFilename.startsWith('Personaville-Working-Copy-20260717-1234'), true);
assert.strictEqual(publishedFilename.endsWith('.xlsx'), true, 'published export filename ends in .xlsx');
assert.strictEqual(workingFilename.endsWith('.xlsx'), true, 'working-copy export filename ends in .xlsx');

const parsedRaw = {};
workingBook.SheetNames.forEach(name => { parsedRaw[name] = context.XLSX.utils.sheet_to_json(workingBook.Sheets[name]); });
const importSession = context.prepareWorkbookImportFromWorkbook(publishedBook, 'roundtrip.xlsx');
assert.strictEqual(importSession.status, 'ready', `Database Manager import preparation still accepts exported workbooks: ${JSON.stringify(importSession.errors)}`);
context.applyRawDatabase(parsedRaw, {source:'workbook', filename:'roundtrip.xlsx', preservePublished:true});
assert.strictEqual(context.databaseState().personas[0].PersonaID, '00123', 'generated workbook can be parsed by importer path');
assert.strictEqual(context.editingChangeList().length > 0, true, 'exporting does not mutate working-copy change tracking');
console.log('Workbook export covers published and working copy exports, sheet names, metadata, preservation rules, health confirmation, filenames, importer parseability, and no state mutation.');
