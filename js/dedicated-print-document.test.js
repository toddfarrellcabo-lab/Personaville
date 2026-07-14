const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Node {
  constructor(tag = '#node') {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.attributes = {};
    this.textContent = '';
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  remove() {
    if(!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  cloneNode(deep = false) {
    const clone = new Node(this.tagName);
    clone.className = this.className;
    clone.attributes = {...this.attributes};
    clone.textContent = this.textContent;
    if(deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }
  querySelectorAll(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const matches = [];
    const visit = node => {
      if(className && node.className.split(/\s+/).includes(className)) matches.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return matches;
  }
}

const document = {
  title: 'Personaville',
  body: new Node('body'),
  createElement: tag => new Node(tag),
  createTextNode: text => {
    const node = new Node('#text');
    node.textContent = text;
    return node;
  }
};
let printCalls = 0;
const context = { document, window: { print: () => { printCalls += 1; } }, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/render.js', 'utf8'), context);

context.printablePersonaCard = (persona, index, total) => {
  const section = document.createElement('section');
  section.className = 'print-card print-persona-page';
  section.setAttribute('data-persona-name', persona.PersonaName || '');
  section.setAttribute('data-index', index + 1);
  section.setAttribute('data-total', total);
  const heading = document.createElement('h1');
  heading.textContent = persona.PersonaName || 'Untitled persona';
  section.appendChild(heading);
  return section;
};

context.selectedExportPersonas = () => [{PersonaName: 'Alice/One'}];
assert.strictEqual(context.exportPdfDocumentTitle(new Date(2026, 6, 14, 9, 5)), 'AliceOne', 'one selected persona should use a filename-safe persona name');
context.printCombinedExportPdf();
assert.strictEqual(printCalls, 1, 'print should be called once');
let container = document.body.children.find(child => child.className === 'persona-print-document');
assert(container, 'temporary print container should be appended');
assert.strictEqual(container.querySelectorAll('.print-persona-page').length, 1, 'one selected persona should produce exactly one print page');
assert.strictEqual(container.querySelectorAll('.print-persona-page')[0].children[0].textContent, 'Alice/One', 'persona name should remain visible on the printed page');

context.removeDedicatedPrintDocument();
assert(!document.body.children.some(child => child.className === 'persona-print-document'), 'temporary print container should be removed afterward');

context.selectedExportPersonas = () => [
  {PersonaName: 'Alpha'},
  {PersonaName: 'Beta'},
  {PersonaName: 'Gamma'}
];
assert.strictEqual(context.exportPdfDocumentTitle(new Date(2026, 6, 14, 9, 5)), 'Personaville-3-Personas-20260714-0905', 'multiple-persona filename should include count and timestamp');
context.printCombinedExportPdf();
container = document.body.children.find(child => child.className === 'persona-print-document');
assert.strictEqual(container.querySelectorAll('.print-persona-page').length, 3, 'three selected personas should produce exactly three print pages');
assert.deepStrictEqual(container.querySelectorAll('.print-persona-page').map(page => page.children[0].textContent), ['Alpha', 'Beta', 'Gamma'], 'persona names should remain visible on every printed page');
assert.strictEqual(container.querySelectorAll('.empty-state').length, 0, 'dedicated print document should not include instruction or empty-state pages');

context.selectedExportPersonas = () => [{PersonaName: ''}, {PersonaName: null}];
assert.strictEqual(context.exportPdfDocumentTitle(new Date(2026, 6, 14, 9, 5)), 'Personaville-Export-20260714-0905', 'filename should include timestamp fallback when persona names are unavailable');

const css = fs.readFileSync('css/app.css', 'utf8');
assert(css.includes('body > :not(.persona-print-document){display:none!important}'), 'print CSS should suppress all application UI outside the dedicated print document');
assert(css.includes('.print-persona-page:last-child{break-after:auto;page-break-after:auto}'), 'last persona page should not force a trailing blank page');
assert(css.includes('break-after:page;page-break-after:always'), 'persona page breaks should occur between personas');

console.log('Dedicated print document workflow, page counts, visible names, no instruction pages, and filename rules pass.');
