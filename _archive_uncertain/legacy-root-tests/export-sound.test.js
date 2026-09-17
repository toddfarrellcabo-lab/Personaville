const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('js/app.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(app.includes('let exportSound = null;'), 'export sound should use one shared variable');
assert(app.includes('exportSound = new Audio("assets/audio/uhoh.mp3")'), 'export sound should lazy-load the requested asset');
assert(app.includes('exportSound.currentTime = 0;'), 'export sound should restart from time 0');
assert(app.includes('exportSound.play().catch(() => {});'), 'export sound should fail silently when playback is blocked');

[
  'printPersona',
  'savePdf',
  'downloadSummary',
  'copySummary'
].forEach((id) => {
  assert(index.includes(`id="${id}"`), `${id} button should exist`);
  assert(app.includes(`document.getElementById("${id}").addEventListener("click", () => runExportAction(`), `${id} should play export sound before action`);
});

[
  'globalSearch',
  'familyFilter',
  'pricingFilter',
  'clearSelection',
  'loadBundled',
  'downloadUpdatedJson'
].forEach((id) => {
  const listener = new RegExp(`getElementById\\("${id}"\\)\\.addEventListener\\([^;]+runExportAction`);
  assert(!listener.test(app), `${id} should not use the export sound helper`);
});

console.log('Export sound helper is wired only to export actions.');
