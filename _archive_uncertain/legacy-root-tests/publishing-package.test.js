const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {TextEncoder, TextDecoder} = require('util');

const context = {
  console,
  fetch: async () => { throw new Error('fetch unused'); },
  XLSX: null,
  TextEncoder,
  TextDecoder,
  Blob,
  Buffer
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/asset-manager.js', 'utf8'), context);

const raw = JSON.parse(fs.readFileSync('database/persona-db.json','utf8'));
context.applyRawDatabase(raw, {source:'bundled', filename:'database/persona-db.json'});

assert.throws(() => context.publishingPackageFiles(), /Review Database Health/, 'package generation requires health review');
context.markDatabaseHealthReviewed();
const files = context.publishingPackageFiles();
const paths = files.map(file => file.path).sort();
assert(paths.includes('database/persona-db.json'), 'package includes updated JSON');
assert(paths.includes('reports/change-summary.json'), 'package includes change summary');
assert(paths.includes('reports/health-report.json'), 'package includes health report');
assert(paths.includes('reports/release-notes-draft.md'), 'package includes release notes draft');
assert(paths.includes('reports/publishing-instructions.md'), 'package includes publishing instructions');
assert(paths.includes('reports/manifest.json'), 'package includes manifest');
const manifest = JSON.parse(new TextDecoder().decode(files.find(file => file.path === 'reports/manifest.json').bytes));
assert.strictEqual(manifest.sourceFilename, 'database/persona-db.json');
assert.strictEqual(manifest.counts.files, files.length);
assert.match(context.publishingPackageFilename(new Date('2026-07-16T09:05:00')), /^Personaville-v2-Publish-20260716-0905\.zip$/);
console.log('v2 publishing package manifest and required files are generated.');
