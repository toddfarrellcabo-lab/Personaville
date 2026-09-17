const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, fetch: async () => { throw new Error('fetch unused'); }, XLSX: null };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/database.js', 'utf8'), context);

const raw = JSON.parse(fs.readFileSync('database/persona-db.json', 'utf8'));
context.applyRawDatabase(raw, {source: 'bundled', filename: 'database/persona-db.json'});
context.startEditingSession();

const flatRows = [{ScheduleID:'SCH_TEST_FLAT', ReferenceID:'REF_FLAT', Sequence:1, StartMonth:1, EndMonth:36, DisplayLabel:'36 Months', Price:50, DisplayAsFree:'FALSE', StrikeThroughPrice:''}];
assert(context.validatePricingScheduleRows(flatRows, {scheduleID:'SCH_TEST_FLAT', isNew:true, pricingType:'Flat Pricing'}).valid, 'flat 36-month schedule validates');
assert(!context.validatePricingScheduleRows([{...flatRows[0], ScheduleID:'SCH_OTHER'}], {scheduleID:'SCH_TEST_FLAT', isNew:true}).valid, 'rows cannot silently modify another ScheduleID');
context.savePricingScheduleRows('SCH_TEST_FLAT', flatRows, {isNew:true, pricingType:'Flat Pricing'});
assert(context.pricingScheduleIDs().includes('SCH_TEST_FLAT'), 'new ScheduleID is created after collision check');
assert(!context.validatePricingScheduleRows(flatRows, {scheduleID:'SCH_TEST_FLAT', isNew:true}).valid, 'new ScheduleID cannot collide with an existing schedule');

const overlapRows = [
  {ScheduleID:'SCH_TEST_STEP', ReferenceID:'REF_STEP', Sequence:1, StartMonth:1, EndMonth:12, DisplayLabel:'Months 1-12', Price:40, DisplayAsFree:'FALSE', StrikeThroughPrice:''},
  {ScheduleID:'SCH_TEST_STEP', ReferenceID:'REF_STEP', Sequence:2, StartMonth:12, EndMonth:24, DisplayLabel:'Months 12-24', Price:60, DisplayAsFree:'FALSE', StrikeThroughPrice:''}
];
const overlapValidation = context.validatePricingScheduleRows(overlapRows, {scheduleID:'SCH_TEST_STEP', isNew:true, pricingType:'Step Pricing'});
assert(!overlapValidation.valid, 'overlapping month ranges are prevented');
assert(overlapValidation.errors.MonthRanges, 'overlap validation points at month ranges');

const introFreeRows = [
  {ScheduleID:'SCH_TEST_FREE', ReferenceID:'REF_FREE', Sequence:1, StartMonth:1, EndMonth:1, DisplayLabel:'Month 1', Price:'', DisplayAsFree:'TRUE', StrikeThroughPrice:75},
  {ScheduleID:'SCH_TEST_FREE', ReferenceID:'REF_FREE', Sequence:2, StartMonth:2, EndMonth:5, DisplayLabel:'Months 2-5', Price:55, DisplayAsFree:'FALSE', StrikeThroughPrice:''},
  {ScheduleID:'SCH_TEST_FREE', ReferenceID:'REF_FREE', Sequence:3, StartMonth:6, EndMonth:6, DisplayLabel:'Month 6', Price:'', DisplayAsFree:'TRUE', StrikeThroughPrice:75},
  {ScheduleID:'SCH_TEST_FREE', ReferenceID:'REF_FREE', Sequence:4, StartMonth:7, EndMonth:11, DisplayLabel:'Months 7-11', Price:55, DisplayAsFree:'FALSE', StrikeThroughPrice:''},
  {ScheduleID:'SCH_TEST_FREE', ReferenceID:'REF_FREE', Sequence:5, StartMonth:12, EndMonth:12, DisplayLabel:'Month 12', Price:'', DisplayAsFree:'TRUE', StrikeThroughPrice:75}
];
assert(context.validatePricingScheduleRows(introFreeRows, {scheduleID:'SCH_TEST_FREE', isNew:true, pricingType:'3 Months Free'}).valid, 'Intro Free structure validates free months 1, 6, and 12 plus paid gaps');

const priceLockRows = [{ScheduleID:'SCH_TEST_LOCK', ReferenceID:'REF_LOCK', Sequence:1, StartMonth:1, EndMonth:24, DisplayLabel:'Months 1-24', Price:70, DisplayAsFree:'FALSE', StrikeThroughPrice:''}];
const priceLockValidation = context.validatePricingScheduleRows(priceLockRows, {scheduleID:'SCH_TEST_LOCK', isNew:true, pricingType:'3 Year Price Lock'});
assert(!priceLockValidation.valid, '3 Year Price Lock requires 36-month coverage');
assert(priceLockValidation.errors.Promotion, 'price lock validation reports promotion coverage');

const invalidLabelRows = [{ScheduleID:'SCH_TEST_LABEL', ReferenceID:'REF_LABEL', Sequence:1, StartMonth:1, EndMonth:12, DisplayLabel:'First Year', Price:50, DisplayAsFree:'FALSE', StrikeThroughPrice:''}];
assert(!context.validatePricingScheduleRows(invalidLabelRows, {scheduleID:'SCH_TEST_LABEL', isNew:true}).valid, 'invalid month labels are rejected');

const blankPriceRows = [{ScheduleID:'SCH_TEST_PRICE', ReferenceID:'REF_PRICE', Sequence:1, StartMonth:1, EndMonth:12, DisplayLabel:'Months 1-12', Price:'', DisplayAsFree:'FALSE', StrikeThroughPrice:''}];
assert(!context.validatePricingScheduleRows(blankPriceRows, {scheduleID:'SCH_TEST_PRICE', isNew:true}).valid, 'paid rows cannot silently invent prices');
assert(!context.validatePricingScheduleRows(overlapRows.slice(0, 1), {scheduleID:'SCH_TEST_STEP', isNew:true, pricingType:'Step Pricing'}).valid, 'step pricing requires at least two paid rows');

context.runDatabaseHealth();
assert(Array.isArray(context.databaseState().health), 'Database Health can be rerun after pricing edits');
console.log('Pricing Schedule Editor helpers validate flat, step, intro-free, price-lock, labels, collision checks, and blank paid prices.');
