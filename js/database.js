
let DB = {
  raw: {},
  personas: [],
  speedOptions: [],
  schedules: [],
  modifiers: [],
  personaModifiers: [],
  disclaimers: [],
  icons: [],
  health: [],
  settings: [],
  iconFailures: [],
  loadedFromWorkbook: false,
  sourceFilename: "",
  lastBuildAt: "",
  downloadableRaw: null,
  sourceWorkbookFile: null,
  sourceWorkbookBytes: null,
  healthReviewedAt: ""
};

let EditingSession = {
  initState: "empty",
  notice: "",
  storageKey: "",
  databaseIdentity: "",
  isEditing: false,
  publishedRaw: {},
  workingRaw: null,
  lastSavedSnapshotRaw: null,
  baselineSnapshotRaw: null,
  recordStates: {},
  commands: [],
  commandIndex: -1,
  changeFilter: "all"
};

const RECORD_ID_FIELDS = ["PersonaID", "SpeedOptionID", "ScheduleID", "ModifierID", "PersonaModifierID", "DisclaimerID", "IconID", "Setting"];
const EDITABLE_DATABASE_SHEETS = new Set([
  "05_Personas",
  "06_SpeedOptions",
  "07_PricingSchedules",
  "04_Modifiers",
  "10_PersonaModifiers",
  "08_Disclaimers",
  "09_Icons"
]);
const RUNTIME_ONLY_FIELDS = new Set(["IconPath", "IconRecord", "ResolvedPath", "speeds", "schedules", "modifiers", "disclaimer"]);

function stableStringify(value){
  if(Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if(value && typeof value === "object"){
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function rawPayloadEquals(a, b){
  return stableStringify(a || {}) === stableStringify(b || {});
}
function canonicalizeRowForComparison(row){
  const cleaned = {};
  Object.keys(row || {}).sort().forEach(key => {
    if(RUNTIME_ONLY_FIELDS.has(key)) return;
    cleaned[key] = row[key];
  });
  return cleaned;
}
function canonicalSnapshotForComparison(raw, editableOnly=true){
  const normalized = normalizeDatabasePayload(raw || {});
  const snapshot = {};
  Object.keys(normalized || {}).sort().forEach(sheet => {
    if(editableOnly && !EDITABLE_DATABASE_SHEETS.has(sheet)) return;
    if(Array.isArray(normalized[sheet])){
      snapshot[sheet] = normalized[sheet].map(canonicalizeRowForComparison);
    }
  });
  return snapshot;
}
function sheetRecordKey(sheetName, row, index){
  if(sheetName === "06_SpeedOptions") return `${sheetName}:SpeedOption:${row?.PersonaID || ""}|${row?.SpeedOption || ""}|${row?.ReferenceID || index}`;
  if(sheetName === "07_PricingSchedules") return `${sheetName}:PricingRow:${row?.ScheduleID || ""}|${row?.ReferenceID || ""}|${row?.Sequence ?? index}|${row?.StartMonth ?? ""}|${row?.EndMonth ?? ""}`;
  if(sheetName === "10_PersonaModifiers") return `${sheetName}:PersonaModifier:${row?.PersonaID || ""}|${row?.ModifierID || ""}`;
  const idField = RECORD_ID_FIELDS.find(field => row && row[field] !== undefined && row[field] !== "");
  const id = idField ? row[idField] : index;
  return `${sheetName}:${idField || "Row"}:${id}`;
}
function snapshotRecordStates(baselineRaw, workingRaw){
  const states = {};
  const baseline = canonicalSnapshotForComparison(baselineRaw);
  const working = canonicalSnapshotForComparison(workingRaw);
  const sheets = new Set([...Object.keys(baseline || {}), ...Object.keys(working || {})]);
  sheets.forEach(sheet => {
    const baselineRows = Array.isArray(baseline?.[sheet]) ? baseline[sheet] : [];
    const workingRows = Array.isArray(working?.[sheet]) ? working[sheet] : [];
    const baselineByKey = new Map(baselineRows.map((row, index) => [sheetRecordKey(sheet, row, index), row]));
    const workingByKey = new Map(workingRows.map((row, index) => [sheetRecordKey(sheet, row, index), row]));
    workingByKey.forEach((row, key) => {
      if(!baselineByKey.has(key)) states[key] = "created";
      else if(!rawPayloadEquals(baselineByKey.get(key), row)) states[key] = "modified";
    });
    baselineByKey.forEach((row, key) => {
      if(!workingByKey.has(key)) states[key] = "deleted";
    });
  });
  return states;
}

const CHANGE_SHEET_LABELS = {
  "05_Personas":"Personas",
  "06_SpeedOptions":"Speed Options",
  "07_PricingSchedules":"Pricing Rows",
  "04_Modifiers":"Modifiers",
  "10_PersonaModifiers":"Relationships",
  "08_Disclaimers":"Disclaimers",
  "09_Icons":"Assets"
};
const CHANGE_EDITOR_TARGETS = {
  "05_Personas":{view:"manage", section:"persona"},
  "06_SpeedOptions":{view:"manage", section:"speed"},
  "07_PricingSchedules":{view:"manage", section:"pricing"},
  "04_Modifiers":{view:"manage", section:"modifier"},
  "10_PersonaModifiers":{view:"manage", section:"relationships"},
  "08_Disclaimers":{view:"manage", section:"disclaimer"},
  "09_Icons":{view:"admin", adminSection:"assets"}
};
function valueForChangeDisplay(value){
  if(value === undefined) return "—";
  if(value === null) return "null";
  if(typeof value === "object") return JSON.stringify(value);
  return String(value) || "(blank)";
}
function rowDisplayName(sheet, row, key){
  if(!row) return key.split(":").slice(2).join(":") || "record";
  return row.PersonaName || row.SpeedOption || row.ModifierName || row.Title || row.ScheduleID || row.IconName || row.PersonaID || row.SpeedOptionID || row.ModifierID || row.DisclaimerID || row.IconID || row.Setting || key;
}
function classifyChange(sheet, field, beforeRow, afterRow, status){
  if(sheet === SHEET_MAP.personaModifiers) return status === "created" ? "added relationship" : status === "deleted" ? "removed relationship" : "modified relationship";
  if(["PromoIcon", "IconFile", "FileName", "DefaultIcon"].includes(field) || sheet === SHEET_MAP.icons) return "changed asset assignment";
  if(status === "created") return "created record";
  if(status === "deleted") return "deleted record";
  if(["Status", "Active"].includes(field) && (String(afterRow?.[field] || "").toLowerCase() === "deleted" || String(afterRow?.[field] || "").toLowerCase() === "false")) return "deleted/deactivated record";
  return "modified field";
}
function buildChangeList(beforeRaw, afterRaw){
  const changes = [];
  const beforeSnapshot = canonicalSnapshotForComparison(beforeRaw);
  const afterSnapshot = canonicalSnapshotForComparison(afterRaw);
  const sheets = new Set([...Object.keys(beforeSnapshot || {}), ...Object.keys(afterSnapshot || {})]);
  sheets.forEach(sheet => {
    if(!EDITABLE_DATABASE_SHEETS.has(sheet)) return;
    const beforeRows = Array.isArray(beforeSnapshot?.[sheet]) ? beforeSnapshot[sheet] : [];
    const afterRows = Array.isArray(afterSnapshot?.[sheet]) ? afterSnapshot[sheet] : [];
    const beforeByKey = new Map(beforeRows.map((row, index) => [sheetRecordKey(sheet, row, index), row]));
    const afterByKey = new Map(afterRows.map((row, index) => [sheetRecordKey(sheet, row, index), row]));
    const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
    keys.forEach(key => {
      const beforeRow = beforeByKey.get(key), afterRow = afterByKey.get(key);
      const status = beforeRow ? (afterRow ? "modified" : "deleted") : "created";
      const fields = status === "modified" ? [...new Set([...Object.keys(beforeRow), ...Object.keys(afterRow)])].filter(f => stableStringify(beforeRow[f]) !== stableStringify(afterRow[f])) : ["Record"];
      fields.forEach(field => changes.push({
        id:`${sheet}|${key}|${field}`,
        sheet,
        recordType:CHANGE_SHEET_LABELS[sheet] || sheet,
        recordKey:key,
        recordName:rowDisplayName(sheet, afterRow || beforeRow, key),
        field,
        kind:classifyChange(sheet, field, beforeRow, afterRow, status),
        before:valueForChangeDisplay(field === "Record" ? beforeRow : beforeRow?.[field]),
        after:valueForChangeDisplay(field === "Record" ? afterRow : afterRow?.[field]),
        editorTarget:CHANGE_EDITOR_TARGETS[sheet] || {view:"manage"}
      }));
    });
  });
  return changes;
}
function editingChangeList(){
  if(EditingSession.initState !== "ready" || !EditingSession.baselineSnapshotRaw || !EditingSession.workingRaw) return [];
  return buildChangeList(EditingSession.baselineSnapshotRaw, EditingSession.workingRaw);
}
function editingChangeSummary(){
  if(EditingSession.initState !== "ready") return {personas:0, speedOptions:0, pricingRows:0, modifiers:0, disclaimers:0, assets:0, healthErrors:0, healthWarnings:0};
  const count = sheet => editingChangeList().filter(c => c.sheet === sheet).length;
  const liveHealth = buildHealth();
  const healthErrors = liveHealth.filter(row => ["BAD", "ERROR", "FAIL"].includes(String(row.Status).toUpperCase())).length;
  const healthWarnings = liveHealth.filter(row => String(row.Status).toUpperCase() === "WARN").length;
  return {personas:count(SHEET_MAP.personas), speedOptions:count(SHEET_MAP.speedOptions), pricingRows:count(SHEET_MAP.schedules), modifiers:count(SHEET_MAP.modifiers), disclaimers:count(SHEET_MAP.disclaimers), assets:count(SHEET_MAP.icons) + editingChangeList().filter(c => c.kind === "changed asset assignment").length, healthErrors, healthWarnings};
}
function canUndoEdit(){ return EditingSession.isEditing && EditingSession.commandIndex >= 0; }
function canRedoEdit(){ return EditingSession.isEditing && EditingSession.commandIndex < EditingSession.commands.length - 1; }
function applyEditingRaw(raw){
  EditingSession.workingRaw = cloneDatabasePayload(raw);
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  refreshEditingRecordStates();
}
function undoLastEdit(){ if(!canUndoEdit()) return false; applyEditingRaw(EditingSession.commands[EditingSession.commandIndex].beforeRaw); EditingSession.commandIndex -= 1; return true; }
function redoLastEdit(){ if(!canRedoEdit()) return false; EditingSession.commandIndex += 1; applyEditingRaw(EditingSession.commands[EditingSession.commandIndex].afterRaw); return true; }
function discardUncommittedChange(changeId){
  const change = editingChangeList().find(c => c.id === changeId);
  if(!change) return false;
  const raw = activeDatabaseSnapshot();
  const baselineRows = Array.isArray(EditingSession.baselineSnapshotRaw?.[change.sheet]) ? EditingSession.baselineSnapshotRaw[change.sheet] : [];
  const workingRows = Array.isArray(raw?.[change.sheet]) ? raw[change.sheet] : [];
  const baselineRow = baselineRows.find((row, index) => sheetRecordKey(change.sheet, row, index) === change.recordKey);
  const index = workingRows.findIndex((row, rowIndex) => sheetRecordKey(change.sheet, row, rowIndex) === change.recordKey);
  if(change.field !== "Record" && baselineRow && index >= 0) workingRows[index][change.field] = cloneDatabasePayload(baselineRow[change.field]);
  else if(!baselineRow && index >= 0) workingRows.splice(index, 1);
  else if(baselineRow && index < 0) workingRows.push(cloneDatabasePayload(baselineRow));
  else return false;
  raw[change.sheet] = workingRows;
  updateWorkingCopy(raw, "discard-change", {sheet:change.sheet, key:change.recordKey, field:change.field});
  return true;
}

function databaseState(){
  return DB;
}
function editingSessionState(){
  return EditingSession;
}
function editingHasUnsavedChanges(){
  return EditingSession.initState === "ready" && EditingSession.isEditing && !rawPayloadEquals(
    canonicalSnapshotForComparison(EditingSession.workingRaw),
    canonicalSnapshotForComparison(EditingSession.lastSavedSnapshotRaw)
  );
}
function editingStatusText(){
  return editingHasUnsavedChanges() ? "Unsaved Changes" : "Saved";
}
function refreshEditingRecordStates(){
  if(EditingSession.initState !== "ready" || !EditingSession.baselineSnapshotRaw || !EditingSession.workingRaw){ EditingSession.recordStates = {}; return EditingSession.recordStates; }
  EditingSession.recordStates = snapshotRecordStates(EditingSession.baselineSnapshotRaw, EditingSession.workingRaw);
  return EditingSession.recordStates;
}
function createChangeCommand(type, beforeRaw, afterRaw, meta={}){
  return {type, beforeRaw: cloneDatabasePayload(beforeRaw), afterRaw: cloneDatabasePayload(afterRaw), meta, createdAt: new Date().toISOString()};
}
function recordEditingSnapshot(type, beforeRaw, afterRaw, meta={}){
  const command = createChangeCommand(type, beforeRaw, afterRaw, meta);
  EditingSession.commands = EditingSession.commands.slice(0, EditingSession.commandIndex + 1);
  EditingSession.commands.push(command);
  EditingSession.commandIndex = EditingSession.commands.length - 1;
  refreshEditingRecordStates();
  return command;
}
const EDIT_SESSION_SCHEMA_VERSION = "2";
const EDIT_SESSION_KEY_PREFIX = "personaville-v2-edit-session";
function collectionCounts(raw){
  const normalized = normalizeDatabasePayload(raw || {});
  return {
    personas:Array.isArray(normalized[SHEET_MAP.personas]) ? normalized[SHEET_MAP.personas].length : 0,
    speedOptions:Array.isArray(normalized[SHEET_MAP.speedOptions]) ? normalized[SHEET_MAP.speedOptions].length : 0,
    pricingRows:Array.isArray(normalized[SHEET_MAP.schedules]) ? normalized[SHEET_MAP.schedules].length : 0,
    modifiers:Array.isArray(normalized[SHEET_MAP.modifiers]) ? normalized[SHEET_MAP.modifiers].length : 0,
    disclaimers:Array.isArray(normalized[SHEET_MAP.disclaimers]) ? normalized[SHEET_MAP.disclaimers].length : 0,
    assets:Array.isArray(normalized[SHEET_MAP.icons]) ? normalized[SHEET_MAP.icons].length : 0
  };
}
function logStartupDiagnostic(stage, raw){
  if(typeof console !== "undefined" && typeof console.debug === "function") console.debug("Personaville startup", stage, collectionCounts(raw));
}
function databaseIdentityFor(raw, filename=DB.sourceFilename){
  const normalized = normalizeDatabasePayload(raw || {});
  const counts = collectionCounts(normalized);
  const generated = (Array.isArray(normalized[SHEET_MAP.settings]) ? normalized[SHEET_MAP.settings].find(row => row.Setting === "GeneratedOn")?.Value : "") || "";
  return encodeURIComponent([filename || "database/persona-db.json", generated, counts.personas, counts.speedOptions, counts.pricingRows, counts.modifiers, counts.disclaimers].join(":"));
}
function editingSessionStorageKey(identity=EditingSession.databaseIdentity){ return `${EDIT_SESSION_KEY_PREFIX}:${EDIT_SESSION_SCHEMA_VERSION}:${identity || "unknown"}`; }
function browserStorage(){ try{ return typeof localStorage !== "undefined" ? localStorage : null; }catch(err){ return null; } }
function hasExpectedCollections(raw){ return [SHEET_MAP.personas,SHEET_MAP.speedOptions,SHEET_MAP.schedules,SHEET_MAP.modifiers,SHEET_MAP.disclaimers].every(sheet => Array.isArray(raw?.[sheet])); }
function validateSavedEditingSession(payload, publishedRaw, identity){
  if(!payload || typeof payload !== "object") return {valid:false, reason:"not an object"};
  if(payload.schemaVersion !== EDIT_SESSION_SCHEMA_VERSION) return {valid:false, reason:"stale schema version"};
  if(payload.databaseIdentity !== identity) return {valid:false, reason:"database identity mismatch"};
  if(!payload.workingRaw || typeof payload.workingRaw !== "object") return {valid:false, reason:"missing working database"};
  if(!hasExpectedCollections(payload.workingRaw)) return {valid:false, reason:"missing required collections"};
  const publishedCounts = collectionCounts(publishedRaw), workingCounts = collectionCounts(payload.workingRaw);
  const totalWorking = workingCounts.personas + workingCounts.speedOptions + workingCounts.pricingRows + workingCounts.modifiers + workingCounts.disclaimers;
  const totalPublished = publishedCounts.personas + publishedCounts.speedOptions + publishedCounts.pricingRows + publishedCounts.modifiers + publishedCounts.disclaimers;
  if(totalPublished > 0 && totalWorking === 0) return {valid:false, reason:"empty working collections"};
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  const hasExplicitDeletes = commands.some(command => command?.type && String(command.type).toLowerCase().includes("delete"));
  if(totalPublished > 0 && totalWorking < Math.max(1, Math.floor(totalPublished * 0.5)) && !hasExplicitDeletes) return {valid:false, reason:"incomplete working collections"};
  return {valid:true};
}
function loadSavedEditingSession(publishedRaw, identity){
  const storage = browserStorage();
  if(!storage) return {restored:false};
  const key = editingSessionStorageKey(identity);
  const stored = storage.getItem(key);
  if(!stored) return {restored:false};
  let payload;
  try{ payload = JSON.parse(stored); }catch(err){ storage.removeItem(key); return {restored:false, ignored:true, reason:"malformed JSON"}; }
  const validation = validateSavedEditingSession(payload, publishedRaw, identity);
  if(!validation.valid){ storage.setItem(`${key}:ignored:${Date.now()}`, stored); storage.removeItem(key); return {restored:false, ignored:true, reason:validation.reason}; }
  return {restored:true, key, payload};
}
function persistEditingSession(){
  if(EditingSession.initState !== "ready" || !EditingSession.isEditing || !EditingSession.storageKey) return;
  const storage = browserStorage();
  if(!storage) return;
  storage.setItem(EditingSession.storageKey, JSON.stringify({schemaVersion:EDIT_SESSION_SCHEMA_VERSION, databaseIdentity:EditingSession.databaseIdentity, savedAt:new Date().toISOString(), workingRaw:EditingSession.workingRaw, lastSavedSnapshotRaw:EditingSession.lastSavedSnapshotRaw, commands:EditingSession.commands, commandIndex:EditingSession.commandIndex}));
}
function clearEditingSessionStorage(){ const storage = browserStorage(); if(storage && EditingSession.storageKey) storage.removeItem(EditingSession.storageKey); }
function initializeCleanWorkingCopy(published, identity, notice=""){
  EditingSession.isEditing = true;
  EditingSession.publishedRaw = cloneDatabasePayload(published);
  EditingSession.workingRaw = cloneDatabasePayload(published);
  EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(EditingSession.workingRaw);
  EditingSession.baselineSnapshotRaw = cloneDatabasePayload(published);
  EditingSession.recordStates = {};
  EditingSession.commands = [];
  EditingSession.commandIndex = -1;
  EditingSession.databaseIdentity = identity;
  EditingSession.storageKey = editingSessionStorageKey(identity);
  EditingSession.notice = notice;
  EditingSession.initState = "ready";
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  persistEditingSession();
}
function initializeEditingSessionFromPublished(raw, options={}){
  EditingSession.initState = "loading published database";
  const published = normalizeDatabasePayload(raw);
  logStartupDiagnostic("published normalized", published);
  const identity = databaseIdentityFor(published, options.filename || DB.sourceFilename);
  EditingSession.initState = "restoring editing session";
  const saved = options.restoreSaved === false ? {restored:false} : loadSavedEditingSession(published, identity);
  if(saved.restored){
    EditingSession.isEditing = true; EditingSession.publishedRaw = cloneDatabasePayload(published); EditingSession.workingRaw = normalizeDatabasePayload(saved.payload.workingRaw);
    EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(saved.payload.lastSavedSnapshotRaw || EditingSession.workingRaw); EditingSession.baselineSnapshotRaw = cloneDatabasePayload(published);
    EditingSession.commands = Array.isArray(saved.payload.commands) ? saved.payload.commands : []; EditingSession.commandIndex = Number.isInteger(saved.payload.commandIndex) ? saved.payload.commandIndex : EditingSession.commands.length - 1;
    EditingSession.databaseIdentity = identity; EditingSession.storageKey = saved.key; EditingSession.notice = ""; EditingSession.initState = "ready";
    applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true}); refreshEditingRecordStates(); logStartupDiagnostic("working restored before diff", EditingSession.workingRaw); return EditingSession;
  }
  const notice = saved.ignored ? "An invalid saved editing session was ignored. A clean working copy was loaded." : "";
  initializeCleanWorkingCopy(published, identity, notice);
  logStartupDiagnostic("working clean before diff", EditingSession.workingRaw);
  return EditingSession;
}

function startEditingSession(){
  if(EditingSession.isEditing && EditingSession.initState === "ready") return EditingSession;
  const published = normalizeDatabasePayload(DB.raw);
  EditingSession.initState = "ready";
  EditingSession.isEditing = true;
  EditingSession.publishedRaw = published;
  EditingSession.workingRaw = cloneDatabasePayload(published);
  EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(EditingSession.workingRaw);
  EditingSession.baselineSnapshotRaw = cloneDatabasePayload(published);
  EditingSession.recordStates = {};
  EditingSession.commands = [];
  EditingSession.commandIndex = -1;
  EditingSession.databaseIdentity = databaseIdentityFor(published, DB.sourceFilename);
  EditingSession.storageKey = editingSessionStorageKey(EditingSession.databaseIdentity);
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  persistEditingSession();
  return EditingSession;
}
function resetWorkingCopyFromPublished(){
  if(!EditingSession.isEditing) startEditingSession();
  EditingSession.workingRaw = normalizeDatabasePayload(EditingSession.publishedRaw);
  EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(EditingSession.workingRaw);
  EditingSession.baselineSnapshotRaw = cloneDatabasePayload(EditingSession.workingRaw);
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  EditingSession.commands = [];
  EditingSession.commandIndex = -1;
  if(typeof AssetManager !== "undefined"){ AssetManager.staged = []; AssetManager.meta = {}; AssetManager.history = []; AssetManager.historyIndex = -1; }
  clearEditingSessionStorage();
  persistEditingSession();
  refreshEditingRecordStates();
}
function discardWorkingChanges(){
  if(!EditingSession.isEditing) return;
  const before = cloneDatabasePayload(EditingSession.workingRaw);
  EditingSession.workingRaw = cloneDatabasePayload(EditingSession.lastSavedSnapshotRaw);
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  recordEditingSnapshot("discard", before, EditingSession.workingRaw);
  persistEditingSession();
}
function markWorkingCopyDownloaded(){
  if(!EditingSession.isEditing) return;
  EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(EditingSession.workingRaw);
  persistEditingSession();
  refreshEditingRecordStates();
}
function markRecordState(sheetName, recordKey, state){
  if(!["created", "modified", "deleted"].includes(state)) throw new Error("Record state must be created, modified, or deleted.");
  EditingSession.recordStates[`${sheetName}:${recordKey}`] = state;
}
function publishedDatabaseSnapshot(){
  return cloneDatabasePayload(EditingSession.isEditing ? EditingSession.publishedRaw : DB.raw);
}
function activeDatabaseSnapshot(){
  return cloneDatabasePayload(EditingSession.isEditing ? EditingSession.workingRaw : DB.raw);
}
function updateWorkingCopy(raw, type="change", meta={}){
  if(!EditingSession.isEditing) startEditingSession();
  const before = cloneDatabasePayload(EditingSession.workingRaw);
  EditingSession.workingRaw = cloneDatabasePayload(raw);
  applyRawDatabase(EditingSession.workingRaw, {source: DB.loadedFromWorkbook ? "workbook" : "bundled", filename: DB.sourceFilename, preservePublished:true});
  const command = recordEditingSnapshot(type, before, EditingSession.workingRaw, meta);
  persistEditingSession();
  return command;
}


const ICON_DIR = "assets/icons/";
function normalizeIconFile(file){
  const value = String(file || "").trim();
  if(!value) return "";
  if(/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  let relative = value.replace(/^\.\//, "");
  while(/^(?:assets\/icons\/|icons\/)/i.test(relative)){
    relative = relative.replace(/^(?:assets\/icons\/|icons\/)/i, "");
  }
  return relative;
}
function resolveIconPath(file){
  const normalized = normalizeIconFile(file);
  if(!normalized) return "";
  if(/^https?:\/\//i.test(normalized) || normalized.startsWith("/")) return normalized;
  return ICON_DIR + normalized;
}
function recordIconLoadFailure(path, context){
  if(!path) return;
  const key = `${context?.type || "Icon"}|${context?.id || ""}|${path}`;
  if(DB.iconFailures.some(f => f.Key === key)) return;
  DB.iconFailures.push({
    Key:key,
    Path:path,
    Context:context || {},
    Reason:"Browser could not load the resolved image path."
  });
}

const SHEET_MAP = {
  personas: "05_Personas",
  speedOptions: "06_SpeedOptions",
  schedules: "07_PricingSchedules",
  modifiers: "04_Modifiers",
  personaModifiers: "10_PersonaModifiers",
  disclaimers: "08_Disclaimers",
  icons: "09_Icons",
  health: "12_DataHealth",
  settings: "01_Settings",
  summary: "00_Summary"
};

function truthy(v){
  return String(v ?? "").toLowerCase() === "true" || v === true || v === 1;
}
function isBooleanLike(v){
  return ["true", "false"].includes(String(v ?? "").trim().toLowerCase()) || v === true || v === false || v === 1 || v === 0;
}
function normalizeBooleanCell(v, defaultValue="FALSE"){
  if(v === undefined || v === null || String(v).trim() === "") return defaultValue;
  if(truthy(v)) return "TRUE";
  if(isBooleanLike(v)) return "FALSE";
  return v;
}
function money(v){
  if(v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if(Number.isNaN(n)) return String(v);
  return "$" + n.toFixed(n % 1 ? 2 : 0) + "/mo.";
}
function bareMoney(v){
  if(v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if(Number.isNaN(n)) return String(v);
  return "$" + n.toFixed(2);
}
function displayPricingSet(v){
  if(!v) return "";
  const s=String(v).trim();
  if(s.toLowerCase()==="std") return "Standard";
  return s.replace(/^Standard$/i,"Standard");
}
function rowsFromSheet(sheet){
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:""});
  return rows.filter(r => Object.values(r).some(v => String(v).trim() !== ""));
}
async function loadBundledDatabase(){
  const res = await fetch("database/persona-db.json");
  if(!res.ok) throw new Error("Could not load database/persona-db.json");
  const data = await res.json();
  logStartupDiagnostic("bundled fetch", data);
  applyRawDatabase(data, {source:"bundled", filename:"database/persona-db.json"});
  initializeEditingSessionFromPublished(DB.raw, {filename:"database/persona-db.json"});
}
function cloneDatabasePayload(raw){
  return JSON.parse(JSON.stringify(raw || {}));
}
function browserLocalDateString(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
let personaCurrentDateProvider = () => browserLocalDateString();
function setPersonaCurrentDateProvider(provider){ personaCurrentDateProvider = typeof provider === "function" ? provider : () => browserLocalDateString(); }
function currentPersonaDate(){ return normalizeDateCell(personaCurrentDateProvider()); }
function normalizeDateCell(value){
  if(value === undefined || value === null || String(value).trim() === "") return "";
  if(typeof value === "number"){
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return browserLocalDateString(date);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : text;
}
function isValidCalendarDate(value){
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match) return false;
  const date = new Date(Number(match[1]), Number(match[2])-1, Number(match[3]));
  return browserLocalDateString(date) === text;
}
function addCalendarDays(value, days){
  const [y,m,d] = String(value).split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return browserLocalDateString(date);
}
function personaLifecycleStatus(persona, today=currentPersonaDate()){
  const override = String(persona?.LifecycleStatusOverride || "").trim().toLowerCase();
  if(override === "inactive" || String(persona?.Status || "").toLowerCase() === "inactive") return "Inactive";
  if(String(persona?.Status || "").toLowerCase() === "draft") return "Draft";
  const start = normalizeDateCell(persona?.EffectiveStartDate);
  const end = normalizeDateCell(persona?.EffectiveEndDate);
  if(start && isValidCalendarDate(start) && today < start) return "Scheduled";
  if(end && isValidCalendarDate(end) && today > end) return "Expired";
  if(!start && !end && String(persona?.Status || "").toLowerCase() === "active") return "Active";
  if(start && isValidCalendarDate(start) && (!end || today <= end)) return "Active";
  return String(persona?.Status || "").toLowerCase() === "active" ? "Active" : "Draft";
}
function isPersonaCurrentlyActive(persona){ return personaLifecycleStatus(persona) === "Active"; }

function normalizeDatabasePayload(raw){
  const normalized = {};
  Object.keys(raw || {}).forEach(key => {
    normalized[key] = Array.isArray(raw[key]) ? raw[key].map(row => ({...row})) : raw[key];
  });
  if(Array.isArray(normalized[SHEET_MAP.personas])){
    normalized[SHEET_MAP.personas] = normalized[SHEET_MAP.personas].map(row => ({
      ...row,
      Fiber: normalizeBooleanCell(row.Fiber),
      EffectiveStartDate: normalizeDateCell(row.EffectiveStartDate),
      EffectiveEndDate: normalizeDateCell(row.EffectiveEndDate),
      SupersedesPersonaID: row.SupersedesPersonaID ?? "",
      LifecycleStatusOverride: row.LifecycleStatusOverride ?? ""
    }));
  }
  return normalized;
}
function applyRawDatabase(raw, options={}){
  const normalized = normalizeDatabasePayload(raw);
  DB.raw = normalized;
  if(!options.preservePublished){
    EditingSession.initState = "loading published database";
    EditingSession.isEditing = false;
    EditingSession.publishedRaw = cloneDatabasePayload(normalized);
    EditingSession.workingRaw = null;
    EditingSession.lastSavedSnapshotRaw = cloneDatabasePayload(normalized);
    EditingSession.baselineSnapshotRaw = cloneDatabasePayload(normalized);
    EditingSession.recordStates = {};
    EditingSession.commands = [];
    EditingSession.commandIndex = -1;
    EditingSession.notice = "";
  }
  if(EditingSession.isEditing){
    EditingSession.workingRaw = cloneDatabasePayload(normalized);
  }
  DB.loadedFromWorkbook = options.source === "workbook";
  DB.downloadableRaw = DB.loadedFromWorkbook ? cloneDatabasePayload(normalized) : null;
  DB.personas = cloneDatabasePayload(normalized[SHEET_MAP.personas] || []);
  DB.speedOptions = cloneDatabasePayload(normalized[SHEET_MAP.speedOptions] || []);
  DB.schedules = cloneDatabasePayload(normalized[SHEET_MAP.schedules] || []);
  DB.modifiers = cloneDatabasePayload(normalized[SHEET_MAP.modifiers] || []);
  DB.personaModifiers = cloneDatabasePayload(normalized[SHEET_MAP.personaModifiers] || []);
  DB.disclaimers = cloneDatabasePayload(normalized[SHEET_MAP.disclaimers] || []);
  DB.icons = cloneDatabasePayload(normalized[SHEET_MAP.icons] || []);
  DB.health = cloneDatabasePayload(normalized[SHEET_MAP.health] || []);
  DB.settings = cloneDatabasePayload(normalized[SHEET_MAP.settings] || []);
  DB.sourceFilename = options.filename || (DB.loadedFromWorkbook ? "Uploaded workbook" : "database/persona-db.json");
  DB.lastBuildAt = DB.loadedFromWorkbook ? new Date().toISOString() : databaseSetting("GeneratedOn") || "";
  DB.iconFailures = [];
  DB.healthReviewedAt = "";
  if(options.source !== "workbook"){ DB.sourceWorkbookFile = null; DB.sourceWorkbookBytes = null; }
  enhanceDatabase();
}
async function loadWorkbookFile(file){
  if(!window.XLSX) throw new Error("SheetJS library did not load. Use the bundled JSON or connect to the internet once.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {type:"array"});
  const raw = {};
  workbook.SheetNames.forEach(name => {
    raw[name] = rowsFromSheet(workbook.Sheets[name]);
  });
  applyRawDatabase(raw, {source:"workbook", filename:file?.name || "Uploaded workbook"});
  DB.sourceWorkbookFile = file || null;
  DB.sourceWorkbookBytes = buffer;
}
function databaseSetting(name){
  const row = (DB.settings || []).find(item => String(item.Setting || "").toLowerCase() === String(name || "").toLowerCase());
  return row?.Value ?? "";
}
function currentBuildSummary(){
  const healthRows = buildHealth();
  const healthErrors = healthRows.filter(row => ["BAD", "ERROR", "FAIL"].includes(String(row.Status || "").toUpperCase()));
  const healthWarnings = healthRows.filter(row => String(row.Status || "").toUpperCase() === "WARN");
  const healthOk = healthRows.filter(row => String(row.Status || "").toUpperCase() === "OK");
  return {
    personas: DB.personas.length,
    speedOptions: DB.speedOptions.length,
    pricingSchedules: DB.schedules.length,
    disclaimers: DB.disclaimers.length,
    modifiers: DB.modifiers.length,
    icons: DB.icons.length,
    healthOk: healthOk.length,
    healthErrors: healthErrors.length,
    healthWarnings: healthWarnings.length
  };
}
function updatedDatabaseJson(){
  const raw = EditingSession.isEditing ? activeDatabaseSnapshot() : (DB.loadedFromWorkbook ? DB.downloadableRaw : DB.raw);
  if(!raw) throw new Error("No database is available for download.");
  return JSON.stringify(raw, null, 2) + "\n";
}
function hasBlockingHealthErrors(){
  return currentBuildSummary().healthErrors > 0;
}

function markDatabaseHealthReviewed(){
  DB.healthReviewedAt = new Date().toISOString();
  return DB.healthReviewedAt;
}
function databaseHealthReviewed(){
  return Boolean(DB.healthReviewedAt);
}
function healthStatusCounts(rows=buildHealth()){
  return rows.reduce((counts, row) => {
    const status = String(row.Status || "").trim().toUpperCase() || "UNKNOWN";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}
function publishingPackageFilename(date=new Date()){
  const pad = n => String(n).padStart(2, "0");
  return `Personaville-v2-Publish-${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}
function publishingDatabaseVersion(){
  return databaseSetting("Version") || databaseSetting("DatabaseVersion") || databaseSetting("GeneratedOn") || DB.sourceFilename || "unknown";
}
function publishingHealthReport(rows=buildHealth()){
  return {reviewedAt:DB.healthReviewedAt || "Not reviewed", counts:healthStatusCounts(rows), rows};
}
function publishingChangeSummary(){
  const changes = editingChangeList();
  const summary = editingChangeSummary();
  return {summary, changes};
}
function publishingReleaseNotesDraft(){
  const generated = new Date().toISOString();
  const changeData = publishingChangeSummary();
  return [
    `# Personaville v2 Release Notes Draft`,
    ``,
    `Generated: ${generated}`,
    `Source database version: ${publishingDatabaseVersion()}`,
    ``,
    `## Summary`,
    `- Personas changed: ${changeData.summary.personas}`,
    `- Speed options changed: ${changeData.summary.speedOptions}`,
    `- Pricing rows changed: ${changeData.summary.pricingRows}`,
    `- Modifiers changed: ${changeData.summary.modifiers}`,
    `- Disclaimers changed: ${changeData.summary.disclaimers}`,
    `- Asset-related changes: ${changeData.summary.assets}`,
    ``,
    `## Health`,
    `- Errors/BAD results: ${changeData.summary.healthErrors}`,
    `- Warnings: ${changeData.summary.healthWarnings}`,
    ``,
    `## Reviewer notes`,
    `- Review this package before committing it to GitHub.`,
    `- Do not modify the published site directly.`
  ].join("\n") + "\n";
}
function publishingInstructions(){
  return [
    `# Publishing Instructions`,
    ``,
    `1. Review Database Health and resolve BAD/Error rows unless this package was intentionally generated with override.`,
    `2. Unzip this package locally.`,
    `3. Review all files, especially database/persona-db.json, reports/health-report.json, reports/change-summary.json, and reports/release-notes-draft.md.`,
    `4. Copy the included database/ and assets/ files into the repository preserving paths.`,
    `5. Commit the reviewed package contents to GitHub. GitHub Pages publishes from GitHub; never modify the published site directly.`,
    `6. Keep release notes with the GitHub commit or PR as appropriate.`
  ].join("\n") + "\n";
}

function updatedWorkbookBytes(){
  if(typeof XLSX === "undefined" || !XLSX?.utils || !XLSX?.write) return null;
  const workbook = XLSX.utils.book_new();
  const raw = activeDatabaseSnapshot();
  Object.keys(raw || {}).forEach(sheetName => {
    const rows = Array.isArray(raw[sheetName]) ? raw[sheetName] : [];
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  });
  return new Uint8Array(XLSX.write(workbook, {bookType:"xlsx", type:"array"}));
}
function dataUrlToBytes(dataUrl){
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  const payload = comma >= 0 ? text.slice(comma + 1) : text;
  if(typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(payload, "base64"));
  const binary = atob(payload);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function textBytes(text){ return new TextEncoder().encode(String(text)); }
function crc32(bytes){
  let crc = -1;
  for(const byte of bytes){
    crc ^= byte;
    for(let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function dosDateTime(date=new Date()){
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds()/2);
  const day = ((date.getFullYear()-1980) << 9) | ((date.getMonth()+1) << 5) | date.getDate();
  return {time, day};
}
function writeU16(out, n){ out.push(n & 255, (n >>> 8) & 255); }
function writeU32(out, n){ out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); }
function makeZip(files){
  const now = dosDateTime();
  const local = [], central = []; let offset = 0;
  files.forEach(file => {
    const name = textBytes(file.path); const bytes = file.bytes instanceof Uint8Array ? file.bytes : textBytes(file.bytes || ""); const crc = crc32(bytes);
    const header = []; writeU32(header,0x04034b50); writeU16(header,20); writeU16(header,0); writeU16(header,0); writeU16(header,now.time); writeU16(header,now.day); writeU32(header,crc); writeU32(header,bytes.length); writeU32(header,bytes.length); writeU16(header,name.length); writeU16(header,0);
    local.push(Uint8Array.from(header), name, bytes);
    const c = []; writeU32(c,0x02014b50); writeU16(c,20); writeU16(c,20); writeU16(c,0); writeU16(c,0); writeU16(c,now.time); writeU16(c,now.day); writeU32(c,crc); writeU32(c,bytes.length); writeU32(c,bytes.length); writeU16(c,name.length); writeU16(c,0); writeU16(c,0); writeU16(c,0); writeU16(c,0); writeU32(c,0); writeU32(c,offset); central.push(Uint8Array.from(c), name);
    offset += header.length + name.length + bytes.length;
  });
  const centralSize = central.reduce((n,b)=>n+b.length,0); const end=[]; writeU32(end,0x06054b50); writeU16(end,0); writeU16(end,0); writeU16(end,files.length); writeU16(end,files.length); writeU32(end,centralSize); writeU32(end,offset); writeU16(end,0);
  return new Blob([...local, ...central, Uint8Array.from(end)], {type:"application/zip"});
}
function publishingPackageFiles(options={}){
  const rows = buildHealth();
  if(!databaseHealthReviewed()) throw new Error("Review Database Health before creating a publishing package.");
  const counts = healthStatusCounts(rows);
  const blocking = (counts.BAD || 0) + (counts.ERROR || 0) + (counts.FAIL || 0);
  if(blocking && !options.overrideHealthErrors) throw new Error("Database Health contains BAD/Error results. Resolve them or explicitly override.");
  const generatedAt = new Date().toISOString();
  const files = [];
  const addText = (path, text) => files.push({path, bytes:textBytes(text)});
  addText("database/persona-db.json", updatedDatabaseJson());
  const workbookBytes = updatedWorkbookBytes();
  if(workbookBytes) files.push({path:"database/persona-db.xlsx", bytes:workbookBytes});
  (typeof AssetManager !== "undefined" ? AssetManager.staged : []).forEach(asset => files.push({path:asset.path, bytes:dataUrlToBytes(asset.dataUrl || "")}));
  if(typeof AssetManager !== "undefined" && (AssetManager.staged.length || Object.keys(AssetManager.meta || {}).length)){
    addText("reports/asset-manifest.json", JSON.stringify({stagedAssets:AssetManager.staged.map(({filename,path,category,size,width,height,replacing})=>({filename,path,category,size,width,height,replacing})), metadata:AssetManager.meta}, null, 2) + "\n");
  }
  addText("reports/change-summary.json", JSON.stringify(publishingChangeSummary(), null, 2) + "\n");
  addText("reports/health-report.json", JSON.stringify(publishingHealthReport(rows), null, 2) + "\n");
  addText("reports/release-notes-draft.md", publishingReleaseNotesDraft());
  addText("reports/publishing-instructions.md", publishingInstructions());
  const manifest = {generatedAt, sourceDatabaseVersion:publishingDatabaseVersion(), sourceFilename:DB.sourceFilename, healthReviewedAt:DB.healthReviewedAt, overrideHealthErrors:Boolean(options.overrideHealthErrors), counts:{files:0, stagedAssets:(typeof AssetManager !== "undefined" ? AssetManager.staged.length : 0), health:counts}, files:[]};
  manifest.files = files.map(file => ({path:file.path, bytes:file.bytes.length, sha256:"pending"}));
  manifest.counts.files = files.length + 1;
  addText("reports/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return files;
}
async function finalizePublishingManifest(files){
  const manifestFile = files.find(f => f.path === "reports/manifest.json"); if(!manifestFile || typeof crypto === "undefined" || !crypto.subtle) return files;
  const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
  for(const entry of manifest.files){
    const file = files.find(f => f.path === entry.path);
    const hash = await crypto.subtle.digest("SHA-256", file.bytes);
    entry.sha256 = [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
  }
  manifestFile.bytes = textBytes(JSON.stringify(manifest, null, 2) + "\n");
  return files;
}
async function publishingPackageBlob(options={}){
  const files = await finalizePublishingManifest(publishingPackageFiles(options));
  return makeZip(files);
}
function pricingRowIdentity(row){
  return [
    row.ScheduleID || "",
    row.ReferenceID || "",
    row.StartMonth ?? "",
    row.EndMonth ?? "",
    row.Price ?? "",
    truthy(row.DisplayAsFree) ? "FREE" : "PAID",
    row.StrikeThroughPrice ?? ""
  ].join("|");
}
function dedupePricingRows(rows){
  const seen = new Set();
  return rows.filter(row => {
    const key = pricingRowIdentity(row);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function getSchedulesForSpeed(speed){
  return dedupePricingRows(
    DB.schedules.filter(row =>
      row.ReferenceID === speed.ReferenceID &&
      row.ScheduleID === speed.ScheduleID
    )
  ).sort((a,b)=>Number(a.Sequence||0)-Number(b.Sequence||0));
}
function healthMonthLabel(row){
  if(row.StartMonth === row.EndMonth) return `Month ${row.StartMonth}`;
  return `Months ${row.StartMonth}-${row.EndMonth}`;
}
function healthRecord(record, reason, fields={}){
  return {Record: record || "Unknown record", Reason: reason || "No reason provided", Fields: fields};
}
function healthDetailsFromRecords(records){
  return records.map(r => `${r.Record}: ${r.Reason}`).join(", ");
}
function workbookHealthRecords(row){
  const status = String(row.Status || "").trim().toUpperCase();
  if(status === "OK") return [];
  const details = String(row.Details || "").trim();
  if(!details) return [];
  return details.split(/,\s*/).filter(Boolean).map((detail, index) => healthRecord(
    `${row.Check || "Workbook health"} #${index + 1}`,
    detail,
    {Source:"12_DataHealth", Section:row.Section || "Workbook", Status:row.Status || ""}
  ));
}

const HEALTH_STATUSES = new Set(["OK", "WARN", "BAD", "ERROR", "FAIL"]);
const WORKBOOK_HEALTH_COLUMNS = ["Section", "Check", "Status", "Count", "Details"];
function normalizedHealthCell(value){
  return String(value ?? "").trim().toLowerCase();
}
function isWorkbookHealthColumnHeader(row){
  return WORKBOOK_HEALTH_COLUMNS.every(column => normalizedHealthCell(row[column]) === column.toLowerCase());
}
function isWorkbookDetailHeader(row, expectedColumns){
  return expectedColumns.every(([field, label]) => normalizedHealthCell(row[field]) === label.toLowerCase());
}
function isWorkbookSectionLabel(row){
  const values = WORKBOOK_HEALTH_COLUMNS.map(column => String(row[column] ?? "").trim());
  return Boolean(values[0]) && values.slice(1).every(value => !value);
}
function isIgnoredWorkbookHealthRow(row){
  return isWorkbookHealthColumnHeader(row) ||
    isWorkbookSectionLabel(row) ||
    isWorkbookDetailHeader(row, [
      ["Section", "IntroFreeScheduleID"],
      ["Check", "ReferenceID"],
      ["Status", "PersonaID"],
      ["Count", "SpeedOption"],
      ["Details", "FirstPaidPrice"]
    ]);
}
function isWorkbookHealthSummary(row){
  return !isIgnoredWorkbookHealthRow(row) && HEALTH_STATUSES.has(String(row.Status || "").trim().toUpperCase()) && String(row.Check || "").trim();
}
function isIntroFreeDetailHeader(row){
  return isWorkbookDetailHeader(row, [
    ["Section", "IntroFreeScheduleID"],
    ["Check", "ReferenceID"],
    ["Status", "PersonaID"],
    ["Count", "SpeedOption"],
    ["Details", "FirstPaidPrice"]
  ]);
}
function isIntroFreeDetailRecord(row){
  return String(row.Section || "").trim().startsWith("SCH_") && String(row.Check || "").trim();
}
function workbookDetailRecord(row, detailType){
  if(detailType === "IntroFreeScheduleID"){
    return healthRecord(
      `${row.Section || "Unknown schedule"}/${row.Check || "Unknown reference"}`,
      "Workbook detail record for an Intro Free schedule; this is supporting detail, not a separate health check.",
      {
        IntroFreeScheduleID:row.Section || "",
        ReferenceID:row.Check || "",
        PersonaID:row.Status || "",
        SpeedOptionID:row.Count || "",
        FirstPaidPrice:row.Details ?? ""
      }
    );
  }
  return healthRecord(
    row.Section || row.Check || "Workbook detail",
    "Workbook detail record; this is supporting detail, not a separate health check.",
    {Source:"12_DataHealth", Section:row.Section || "", Check:row.Check || "", Status:row.Status || "", Count:row.Count ?? "", Details:row.Details ?? ""}
  );
}
function attachRecordsToWorkbookCheck(rows, checkMatcher, records){
  if(!records.length) return;
  const target = rows.find(checkMatcher);
  if(!target) return;
  target.Records = [...(target.Records || []), ...records];
  const summary = healthDetailsFromRecords(target.Records);
  target.Details = target.Details ? `${target.Details}; ${summary}` : summary;
}
function normalizedWorkbookHealthRows(){
  const summaryRows = [];
  const introFreeRecords = [];
  let detailType = "";
  (DB.health || []).forEach(row => {
    if(isWorkbookHealthSummary(row)){
      summaryRows.push({...row, Section:row.Section || "Workbook", Records:workbookHealthRecords(row)});
      detailType = "";
      return;
    }
    if(isIntroFreeDetailHeader(row)){
      detailType = "IntroFreeScheduleID";
      return;
    }
    if(detailType === "IntroFreeScheduleID" && isIntroFreeDetailRecord(row)){
      introFreeRecords.push(workbookDetailRecord(row, detailType));
    }
  });
  attachRecordsToWorkbookCheck(
    summaryRows,
    row => /intro free/i.test(String(row.Check || "")),
    introFreeRecords
  );
  return summaryRows.filter(row => String(row.Check || "").trim() !== "Personas missing ModifiedBy");
}
function monthsFromScheduleRow(row){
  const label = String(row.DisplayLabel || "");
  const monthText = label.match(/Months?\s+(.+)/i);
  const months = new Set();
  if(/36\s+Months/i.test(label)){
    for(let month=1; month<=36; month++) months.add(month);
    return months;
  }
  if(monthText){
    monthText[1].split(/,\s*/).forEach(part => {
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      const single = part.match(/^(\d+)$/);
      if(range){
        const start = Number(range[1]);
        const end = Number(range[2]);
        for(let month=start; month<=end; month++) months.add(month);
      }else if(single){
        months.add(Number(single[1]));
      }
    });
  }
  if(months.size) return months;
  const start = Number(row.StartMonth || 0);
  const end = Number(row.EndMonth || start);
  for(let month=start; month<=end; month++) months.add(month);
  return months;
}
function intersectingMonths(a, b){
  return [...a].filter(month => b.has(month)).sort((x,y)=>x-y);
}


const COVERAGE_PERIODS = [
  {Label:"Months 1-12", Start:1, End:12},
  {Label:"Months 13-24", Start:13, End:24},
  {Label:"Months 25-36", Start:25, End:36}
];
function formatMonthRanges(months){
  const sorted = [...new Set(months)].sort((a,b)=>a-b);
  const ranges = [];
  let start = null;
  let previous = null;
  sorted.forEach(month => {
    if(start === null){
      start = month;
      previous = month;
      return;
    }
    if(month === previous + 1){
      previous = month;
      return;
    }
    ranges.push(start === previous ? `Month ${start}` : `Months ${start}-${previous}`);
    start = month;
    previous = month;
  });
  if(start !== null){
    ranges.push(start === previous ? `Month ${start}` : `Months ${start}-${previous}`);
  }
  return ranges;
}
function scheduleCoverageMonths(rows){
  return rows.reduce((months, row) => {
    monthsFromScheduleRow(row).forEach(month => months.add(month));
    return months;
  }, new Set());
}
function scheduleRangeSummary(rows){
  return rows.map(row => row.DisplayLabel || healthMonthLabel(row)).filter(Boolean).join(" | ");
}
function isStandalone40OneGigException(speed, rows){
  const isOneGig = String(speed.DisplaySpeed || "").trim().toLowerCase() === "1 gig" || Number(speed.DownloadMbps || 0) === 1000;
  const isFortyDollar = Number(speed.FirstPaidPrice || 0) === 40 || rows.some(row => Number(row.Price || 0) === 40);
  const hasCoverageAfter24 = rows.some(row => [...monthsFromScheduleRow(row)].some(month => month >= 25 && month <= 36));
  return isOneGig && isFortyDollar && !hasCoverageAfter24;
}
function isThirtySixMonthCoverageCandidate(persona, speed, rows){
  if(!persona || !speed || !rows.length) return false;
  const pricingSet = displayPricingSet(persona.PricingSet);
  if(/3\s*year\s*price\s*lock/i.test(pricingSet)){
    return !isStandalone40OneGigException(speed, rows);
  }
  return rows.some(row => [...monthsFromScheduleRow(row)].some(month => month >= 25 && month <= 36));
}
function missingCoverageLabels(coverageMonths){
  return COVERAGE_PERIODS.flatMap(period => {
    const missing = [];
    for(let month=period.Start; month<=period.End; month++){
      if(!coverageMonths.has(month)) missing.push(month);
    }
    return missing.length ? formatMonthRanges(missing) : [];
  });
}


function sameMonthSet(actual, expected){
  const a = [...actual].sort((x,y)=>x-y);
  const e = [...expected].sort((x,y)=>x-y);
  return a.length === e.length && a.every((month, index) => month === e[index]);
}
function paidRows(rows){
  return rows.filter(row => !truthy(row.DisplayAsFree));
}
function rowHasValidMonthLabel(row){
  const label = String(row.DisplayLabel || "").trim();
  if(!label) return false;
  if(/36\s+Months/i.test(label)) return true;
  if(!/^Months?\s+/i.test(label)) return false;
  const parsed = monthsFromScheduleRow(row);
  return [...parsed].some(month => month >= 1 && month <= 36);
}
function sortedScheduleRows(rows){
  return dedupePricingRows(rows).sort((a,b)=>Number(a.Sequence||0)-Number(b.Sequence||0));
}


function expectedModifierIDsForPersona(persona, speeds){
  const expected = new Set();
  const pricingSet = displayPricingSet(persona?.PricingSet || "");
  if(/3\s*Months\s*Free/i.test(pricingSet)) expected.add("MOD_002");
  if(/3\s*Year\s*Price\s*Lock/i.test(pricingSet)) expected.add("MOD_003");
  if((speeds || []).some(speed =>
    truthy(speed.Active) &&
    Number(speed.FirstPaidPrice || 0) === 40 &&
    (String(speed.DisplaySpeed || "").trim().toLowerCase() === "1 gig" || Number(speed.DownloadMbps || 0) === 1000)
  )) expected.add("MOD_001");
  return expected;
}

function enhanceDatabase(){
  const speedsByPersona = groupBy(DB.speedOptions.filter(s => truthy(s.Active)), "PersonaID");
  const modsById = Object.fromEntries(DB.modifiers.map(m => [m.ModifierID, m]));
  const personaModsByPersona = groupBy(DB.personaModifiers.filter(pm => truthy(pm.Active)), "PersonaID");
  const disclaimersById = Object.fromEntries(DB.disclaimers.map(d => [d.DisclaimerID, d]));
  const iconsByFile = Object.fromEntries(DB.icons.map(i => [normalizeIconFile(i.FileName), {...i, ResolvedPath:resolveIconPath(i.FileName)}]));
  DB.icons.forEach(i => { i.ResolvedPath = resolveIconPath(i.FileName); });
  DB.modifiers.forEach(m => {
    m.IconPath = resolveIconPath(m.IconFile);
    m.IconRecord = iconsByFile[normalizeIconFile(m.IconFile)] || null;
  });
  DB.personas.forEach(p => {
    p.PricingSet = displayPricingSet(p.PricingSet);
    p.IconPath = resolveIconPath(p.PromoIcon);
    p.IconRecord = iconsByFile[normalizeIconFile(p.PromoIcon)] || null;
    p.speeds = (speedsByPersona[p.PersonaID] || []).sort((a,b) => Number(a.DisplayOrder || a.SortOrder || 0)-Number(b.DisplayOrder || b.SortOrder || 0));
    p.speeds.forEach(s => {
      // ReferenceID is reused across Standard, 3 Months Free, and Price Lock personas.
      // ScheduleID + ReferenceID is the exact schedule key for one persona speed.
      s.schedules = getSchedulesForSpeed(s);
    });
    p.modifiers = (personaModsByPersona[p.PersonaID] || [])
      .sort((a,b)=>Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0))
      .map(pm => modsById[pm.ModifierID])
      .filter(Boolean);
    p.disclaimer = disclaimersById[p.DisclaimerID] || null;
  });
}

const PERSONA_EDITOR_FIELDS = ["PersonaID", "PersonaName", "FamilyGroup", "FamilyGroupID", "PricingSet", "PricingSetID", "Status", "EffectiveStartDate", "EffectiveEndDate", "SupersedesPersonaID", "LifecycleStatusOverride", "PromoIcon", "EquipInc", "SymSpeed", "Fiber", "DisclaimerID", "Notes", "ModifiedBy", "ModifiedDate"];
const PERSONA_REQUIRED_FIELDS = ["PersonaID", "PersonaName", "FamilyGroup", "FamilyGroupID", "PricingSet", "PricingSetID", "Status"];
const SPEED_OPTION_FIELDS = ["ReferenceID", "PersonaID", "SpeedOption", "DisplaySpeed", "DownloadMbps", "UploadSpeed", "PricingType", "FirstPaidPrice", "RegularRate", "ScheduleID", "DisplayOrder", "Active"];
const SPEED_OPTION_REQUIRED_FIELDS = ["ReferenceID", "PersonaID", "SpeedOption", "DisplaySpeed", "DownloadMbps", "UploadSpeed", "PricingType", "ScheduleID"];
function speedDisplayOrder(row){
  return row.DisplayOrder ?? row.SortOrder ?? "";
}
function speedOptionKey(row){
  return `${row.PersonaID || ""}|${row.SpeedOption || ""}`;
}
function nextSpeedOptionForPersona(personaID){
  const nums = DB.speedOptions.filter(row => row.PersonaID === personaID).map(row => String(row.SpeedOption || "").match(/^SO_(\d+)$/i)?.[1]).filter(Boolean).map(Number);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `SO_${next}`;
}
function pricingSummaryForSpeed(speed){
  const rows = sortedScheduleRows(getSchedulesForSpeed(speed));
  if(!rows.length) return "No pricing rows resolve for this ScheduleID + ReferenceID.";
  return rows.map(row => `${row.DisplayLabel || healthMonthLabel(row)}: ${truthy(row.DisplayAsFree) ? "FREE" : money(row.Price)}`).join(" | ");
}
function scheduleResolutionForSpeed(speed){
  const rows = getSchedulesForSpeed(speed);
  return {resolves: rows.length > 0, count: rows.length, summary: pricingSummaryForSpeed(speed)};
}
function validateSpeedOptionDraft(input, originalKey=""){
  const errors = {};
  SPEED_OPTION_REQUIRED_FIELDS.forEach(field => { if(!String(input[field] ?? "").trim()) errors[field] = "Required"; });
  const personaID = String(input.PersonaID || "").trim();
  if(personaID && !DB.personas.some(row => row.PersonaID === personaID)) errors.PersonaID = "PersonaID does not exist.";
  const key = speedOptionKey(input);
  if(key && key !== originalKey && DB.speedOptions.some(row => speedOptionKey(row) === key)) errors.SpeedOption = "PersonaID + SpeedOption must be unique.";
  const ref = String(input.ReferenceID || "").trim();
  if(ref && DB.speedOptions.some(row => row.PersonaID === personaID && row.ReferenceID === ref && speedOptionKey(row) !== originalKey)) errors.ReferenceID = "ReferenceID must be unique within the selected persona.";
  return {valid:Object.keys(errors).length === 0, errors};
}
function normalizeSpeedOptionForSave(input, existing={}){
  const row = {...existing};
  SPEED_OPTION_FIELDS.forEach(field => { row[field] = input[field] ?? ""; });
  row.Active = truthy(row.Active) ? "TRUE" : "FALSE";
  row.DownloadMbps = row.DownloadMbps === "" ? "" : Number(row.DownloadMbps);
  row.FirstPaidPrice = row.FirstPaidPrice === "" ? "" : Number(row.FirstPaidPrice);
  row.RegularRate = row.RegularRate === "" ? "" : Number(row.RegularRate);
  row.SortOrder = row.DisplayOrder === "" ? (existing.SortOrder ?? "") : Number(row.DisplayOrder);
  delete row.DisplayOrder;
  return row;
}
function saveSpeedOptionDraft(input, originalKey=""){
  if(!EditingSession.isEditing) startEditingSession();
  const validation = validateSpeedOptionDraft(input, originalKey);
  if(!validation.valid) throw new Error(Object.entries(validation.errors).map(([field, msg]) => `${field}: ${msg}`).join("\n"));
  const raw = activeDatabaseSnapshot();
  const rows = Array.isArray(raw[SHEET_MAP.speedOptions]) ? raw[SHEET_MAP.speedOptions] : [];
  const index = originalKey ? rows.findIndex(row => speedOptionKey(row) === originalKey) : -1;
  const saved = normalizeSpeedOptionForSave(input, index >= 0 ? rows[index] : {});
  if(index >= 0) rows[index] = saved; else rows.push(saved);
  raw[SHEET_MAP.speedOptions] = rows;
  updateWorkingCopy(raw, index >= 0 ? "speed-save" : "speed-create", {sheet:SHEET_MAP.speedOptions, key:speedOptionKey(saved)});
  return saved;
}
function duplicateSpeedOption(key){
  const source = DB.speedOptions.find(row => speedOptionKey(row) === key);
  if(!source) throw new Error("Speed option not found.");
  const option = nextSpeedOptionForPersona(source.PersonaID);
  const copy = {...source, SpeedOption:option, ReferenceID:`${source.PersonaID}-${option}`, SortOrder:DB.speedOptions.filter(row => row.PersonaID === source.PersonaID).length + 1, Active:"FALSE"};
  return saveSpeedOptionDraft({...copy, DisplayOrder:speedDisplayOrder(copy)}, "");
}
function setSpeedOptionActive(key, active){
  const row = DB.speedOptions.find(item => speedOptionKey(item) === key);
  if(!row) throw new Error("Speed option not found.");
  return saveSpeedOptionDraft({...row, DisplayOrder:speedDisplayOrder(row), Active:active ? "TRUE" : "FALSE"}, key);
}
function removeSpeedOption(key){
  if(!EditingSession.isEditing) startEditingSession();
  const raw = activeDatabaseSnapshot();
  raw[SHEET_MAP.speedOptions] = (raw[SHEET_MAP.speedOptions] || []).filter(row => speedOptionKey(row) !== key);
  updateWorkingCopy(raw, "speed-remove", {sheet:SHEET_MAP.speedOptions, key});
}
function moveSpeedOption(key, direction){
  const row = DB.speedOptions.find(item => speedOptionKey(item) === key);
  if(!row) throw new Error("Speed option not found.");
  const siblings = DB.speedOptions.filter(item => item.PersonaID === row.PersonaID).sort((a,b)=>Number(speedDisplayOrder(a)||0)-Number(speedDisplayOrder(b)||0));
  const index = siblings.findIndex(item => speedOptionKey(item) === key);
  const swap = siblings[index + direction];
  if(!swap) return row;
  saveSpeedOptionDraft({...row, DisplayOrder:speedDisplayOrder(swap)}, key);
  return saveSpeedOptionDraft({...swap, DisplayOrder:speedDisplayOrder(row)}, speedOptionKey(swap));
}
function personaRelationships(personaID){
  const id = String(personaID || "").trim();
  return {
    speeds: DB.speedOptions.filter(row => row.PersonaID === id).length,
    modifiers: DB.personaModifiers.filter(row => row.PersonaID === id).length,
    disclaimers: DB.personas.filter(row => row.PersonaID === id && row.DisclaimerID).length
  };
}
function personaHasRelationships(personaID){
  const counts = personaRelationships(personaID);
  return counts.speeds + counts.modifiers + counts.disclaimers > 0;
}
function nextSafePersonaID(){
  const used = new Set(DB.personas.map(row => String(row.PersonaID || "").trim()).filter(Boolean));
  let max = 0;
  used.forEach(id => {
    const match = id.match(/^PM_(\d+)$/i);
    if(match) max = Math.max(max, Number(match[1]));
  });
  let candidate = "";
  do {
    max += 1;
    candidate = `PM_${String(max).padStart(3, "0")}`;
  } while(used.has(candidate));
  return candidate;
}
function normalizePersonaForSave(input, existingPersona={}, modifiedBy="Persona Editor"){
  const now = new Date().toISOString();
  const row = {...existingPersona};
  PERSONA_EDITOR_FIELDS.forEach(field => { row[field] = input[field] ?? ""; });
  row.PromoIcon = normalizeIconFile(row.PromoIcon);
  row.EquipInc = normalizeBooleanCell(row.EquipInc);
  row.SymSpeed = normalizeBooleanCell(row.SymSpeed);
  row.Fiber = normalizeBooleanCell(row.Fiber);
  row.EffectiveStartDate = normalizeDateCell(row.EffectiveStartDate);
  row.EffectiveEndDate = normalizeDateCell(row.EffectiveEndDate);
  row.ModifiedBy = modifiedBy || "Persona Editor";
  row.ModifiedDate = now;
  return row;
}
function validatePersonaDraft(input, originalPersonaID=""){
  const errors = {};
  PERSONA_REQUIRED_FIELDS.forEach(field => { if(!String(input[field] ?? "").trim()) errors[field] = "Required"; });
  const id = String(input.PersonaID || "").trim();
  if(id && !/^[A-Za-z0-9_-]+$/.test(id)) errors.PersonaID = "Use letters, numbers, underscores, or hyphens only.";
  if(id && id !== originalPersonaID && DB.personas.some(row => row.PersonaID === id)) errors.PersonaID = "PersonaID already exists.";
  if(input.DisclaimerID && !DB.disclaimers.some(row => row.DisclaimerID === input.DisclaimerID)) errors.DisclaimerID = "DisclaimerID does not exist.";
  const start = normalizeDateCell(input.EffectiveStartDate);
  const end = normalizeDateCell(input.EffectiveEndDate);
  if(start && !isValidCalendarDate(start)) errors.EffectiveStartDate = "Use YYYY-MM-DD.";
  if(end && !isValidCalendarDate(end)) errors.EffectiveEndDate = "Use YYYY-MM-DD.";
  if(start && end && isValidCalendarDate(start) && isValidCalendarDate(end) && end < start) errors.EffectiveEndDate = "End date cannot be before start date.";
  if(input.SupersedesPersonaID){
    if(input.SupersedesPersonaID === id) errors.SupersedesPersonaID = "A persona cannot supersede itself.";
    else if(!DB.personas.some(row => row.PersonaID === input.SupersedesPersonaID)) errors.SupersedesPersonaID = "Superseded PersonaID does not exist.";
  }
  ["EquipInc", "SymSpeed", "Fiber"].forEach(field => {
    const value = input[field];
    if(value !== undefined && value !== null && value !== "" && !isBooleanLike(value)){
      errors[field] = "Use TRUE or FALSE.";
    }
  });
  return {valid:Object.keys(errors).length === 0, errors};
}
function savePersonaDraft(input, originalPersonaID="", modifiedBy="Persona Editor"){
  if(!EditingSession.isEditing) startEditingSession();
  const validation = validatePersonaDraft(input, originalPersonaID);
  if(!validation.valid) throw new Error(Object.entries(validation.errors).map(([field, msg]) => `${field}: ${msg}`).join("\n"));
  const raw = activeDatabaseSnapshot();
  const rows = Array.isArray(raw[SHEET_MAP.personas]) ? raw[SHEET_MAP.personas] : [];
  const index = originalPersonaID ? rows.findIndex(row => row.PersonaID === originalPersonaID) : -1;
  const saved = normalizePersonaForSave(input, index >= 0 ? rows[index] : {}, modifiedBy);
  if(index >= 0) rows[index] = saved; else rows.push(saved);
  raw[SHEET_MAP.personas] = rows;
  updateWorkingCopy(raw, index >= 0 ? "persona-save" : "persona-create", {sheet:SHEET_MAP.personas, PersonaID:saved.PersonaID});
  return saved;
}
function duplicatePersona(personaID, modifiedBy="Persona Editor"){
  const source = DB.personas.find(row => row.PersonaID === personaID);
  if(!source) throw new Error("Persona not found.");
  const copy = {...source, PersonaID:nextSafePersonaID(), PersonaName:`${source.PersonaName || "Persona"} Copy`, Status:"Draft", SupersedesPersonaID:"", EffectiveStartDate:"", EffectiveEndDate:"", LifecycleStatusOverride:""};
  return savePersonaDraft(copy, "", modifiedBy);
}
function createUpdatedPersonaVersion(sourcePersonaID, startDate, confirm=false, modifiedBy="Persona Editor"){
  const source = DB.personas.find(row => row.PersonaID === sourcePersonaID);
  if(!source) throw new Error("Persona not found.");
  const normalizedStart = normalizeDateCell(startDate);
  if(!normalizedStart || !isValidCalendarDate(normalizedStart)) throw new Error("Replacement start date must be YYYY-MM-DD.");
  const sourceEndDate = addCalendarDays(normalizedStart, -1);
  const newDraft = {...source, PersonaID:nextSafePersonaID(), PersonaName:`${source.PersonaName || "Persona"} Updated`, Status:"Draft", EffectiveStartDate:normalizedStart, EffectiveEndDate:"", SupersedesPersonaID:source.PersonaID, LifecycleStatusOverride:""};
  const sourceUpdate = {...source, EffectiveEndDate:sourceEndDate};
  const preview = {sourceBefore:cloneDatabasePayload(source), sourceAfter:sourceUpdate, newDraft};
  if(!confirm) return preview;
  if(!EditingSession.isEditing) startEditingSession();
  const raw = activeDatabaseSnapshot();
  const rows = Array.isArray(raw[SHEET_MAP.personas]) ? raw[SHEET_MAP.personas] : [];
  const index = rows.findIndex(row => row.PersonaID === source.PersonaID);
  if(index < 0) throw new Error("Superseded source persona is missing from the working copy.");
  rows[index] = normalizePersonaForSave(sourceUpdate, rows[index], modifiedBy);
  rows.push(normalizePersonaForSave(newDraft, {}, modifiedBy));
  raw[SHEET_MAP.personas] = rows;
  updateWorkingCopy(raw, "persona-version", {sheet:SHEET_MAP.personas, PersonaID:newDraft.PersonaID, SupersedesPersonaID:source.PersonaID});
  return DB.personas.find(row => row.PersonaID === newDraft.PersonaID);
}
function setPersonaStatus(personaID, status, modifiedBy="Persona Editor"){
  const row = DB.personas.find(item => item.PersonaID === personaID);
  if(!row) throw new Error("Persona not found.");
  return savePersonaDraft({...row, Status:status}, personaID, modifiedBy);
}
function markPersonaDeleted(personaID, modifiedBy="Persona Editor"){
  const row = DB.personas.find(item => item.PersonaID === personaID);
  if(!row) throw new Error("Persona not found.");
  return savePersonaDraft({...row, Status:"Deleted", Notes:[row.Notes, "Marked for deletion in working copy"].filter(Boolean).join(" | ")}, personaID, modifiedBy);
}

const PRICING_SCHEDULE_FIELDS = ["ScheduleID", "ReferenceID", "Sequence", "StartMonth", "EndMonth", "DisplayLabel", "Price", "DisplayAsFree", "StrikeThroughPrice"];
function pricingScheduleKey(row){
  return `${row.ScheduleID || ""}|${row.ReferenceID || ""}|${row.Sequence ?? ""}`;
}
function pricingScheduleIDs(){
  return getUnique(DB.schedules, "ScheduleID");
}
function pricingRowsForSchedule(scheduleID){
  return sortedScheduleRows(DB.schedules.filter(row => row.ScheduleID === scheduleID));
}
function personasUsingSchedule(scheduleID){
  return DB.speedOptions
    .filter(speed => speed.ScheduleID === scheduleID)
    .map(speed => {
      const persona = DB.personas.find(row => row.PersonaID === speed.PersonaID) || {};
      return {
        PersonaID:speed.PersonaID || "",
        PersonaName:persona.PersonaName || "",
        SpeedOption:speed.SpeedOption || "",
        DisplaySpeed:speed.DisplaySpeed || "",
        ReferenceID:speed.ReferenceID || "",
        PricingType:speed.PricingType || "",
        Active:truthy(speed.Active)
      };
    })
    .sort((a,b)=>[a.PersonaName,a.DisplaySpeed,a.ReferenceID].join("|").localeCompare([b.PersonaName,b.DisplaySpeed,b.ReferenceID].join("|")));
}
function normalizePricingRowForSave(input, existing={}){
  const row = {...existing};
  PRICING_SCHEDULE_FIELDS.forEach(field => { row[field] = input[field] ?? ""; });
  row.Sequence = row.Sequence === "" ? "" : Number(row.Sequence);
  row.StartMonth = row.StartMonth === "" ? "" : Number(row.StartMonth);
  row.EndMonth = row.EndMonth === "" ? "" : Number(row.EndMonth);
  row.Price = row.Price === "" ? "" : Number(row.Price);
  row.DisplayAsFree = truthy(row.DisplayAsFree) ? "TRUE" : "FALSE";
  row.StrikeThroughPrice = row.StrikeThroughPrice === "" ? "" : Number(row.StrikeThroughPrice);
  return row;
}
function scheduleEditorAnalysis(rows){
  const records = [];
  const seenMonths = new Map();
  const missing = [];
  const invalidLabels = [];
  const overlaps = [];
  sortedScheduleRows(rows).forEach(row => {
    if(!rowHasValidMonthLabel(row)) invalidLabels.push(row);
    const months = monthsFromScheduleRow(row);
    months.forEach(month => {
      if(month < 1 || month > 36) invalidLabels.push(row);
      if(seenMonths.has(month)) overlaps.push({month, first:seenMonths.get(month), second:row});
      else seenMonths.set(month, row);
    });
  });
  for(let month=1; month<=36; month++) if(!seenMonths.has(month)) missing.push(month);
  if(overlaps.length) records.push({type:"overlap", message:`Overlapping month ranges: ${formatMonthRanges(overlaps.map(o => o.month)).join("; ")}.`});
  if(missing.length) records.push({type:"missing", message:`Missing month coverage: ${formatMonthRanges(missing).join("; ")}.`});
  if(invalidLabels.length) records.push({type:"label", message:"One or more rows have invalid month labels or months outside 1-36."});
  return {valid:!overlaps.length && !invalidLabels.length, missingMonths:missing, overlaps, invalidLabels, records};
}
function validatePricingScheduleRows(rows, options={}){
  const errors = {};
  const scheduleID = String(options.scheduleID || rows[0]?.ScheduleID || "").trim();
  if(!scheduleID) errors.ScheduleID = "ScheduleID is required.";
  if(options.isNew && DB.schedules.some(row => row.ScheduleID === scheduleID)) errors.ScheduleID = "ScheduleID already exists.";
  rows.forEach((row, index) => {
    const prefix = `row${index}`;
    ["ScheduleID", "ReferenceID", "Sequence", "StartMonth", "EndMonth", "DisplayLabel"].forEach(field => { if(!String(row[field] ?? "").trim()) errors[`${prefix}.${field}`] = "Required"; });
    if(scheduleID && String(row.ScheduleID || "").trim() !== scheduleID) errors[`${prefix}.ScheduleID`] = "Rows must stay within the selected ScheduleID; another schedule is never silently modified.";
    const start = Number(row.StartMonth); const end = Number(row.EndMonth);
    if(!Number.isInteger(start) || start < 1 || start > 36) errors[`${prefix}.StartMonth`] = "Use month 1-36.";
    if(!Number.isInteger(end) || end < start || end > 36) errors[`${prefix}.EndMonth`] = "End month must be between StartMonth and 36.";
    if(!truthy(row.DisplayAsFree) && String(row.Price ?? "").trim() === "") errors[`${prefix}.Price`] = "Enter a price or mark free; prices are never invented.";
    if(String(row.Price ?? "").trim() !== "" && Number.isNaN(Number(row.Price))) errors[`${prefix}.Price`] = "Price must be numeric.";
    if(String(row.StrikeThroughPrice ?? "").trim() !== "" && Number.isNaN(Number(row.StrikeThroughPrice))) errors[`${prefix}.StrikeThroughPrice`] = "Strike-through price must be numeric.";
    if(!rowHasValidMonthLabel(row)) errors[`${prefix}.DisplayLabel`] = "Use labels like Months 1-12, Month 6, or 36 Months.";
  });
  const analysis = scheduleEditorAnalysis(rows);
  if(analysis.overlaps.length) errors.MonthRanges = "Month ranges cannot overlap.";
  if(analysis.invalidLabels.length) errors.DisplayLabel = "Invalid month labels detected.";
  const pricingType = String(options.pricingType || "").toLowerCase();
  if(/3\s*year\s*price\s*lock/.test(pricingType) && analysis.missingMonths.length) errors.Promotion = "3 Year Price Lock must cover all 36 months.";
  if(/flat pricing|^flat$/.test(pricingType)){
    if(rows.length !== 1 || rows.some(row => truthy(row.DisplayAsFree))) errors.Flat = "Flat pricing requires exactly one paid row.";
  }
  if(/step pricing/.test(pricingType)){
    if(rows.filter(row => !truthy(row.DisplayAsFree)).length < 2) errors.Step = "Step pricing requires at least two paid rows.";
  }
  if(/3\s*months\s*free|intro free/.test(pricingType)){
    const freeMonths = scheduleCoverageMonths(rows.filter(row => truthy(row.DisplayAsFree)));
    const paidFirstYear = scheduleCoverageMonths(rows.filter(row => !truthy(row.DisplayAsFree) && [...monthsFromScheduleRow(row)].some(month => month <= 12)));
    if(!sameMonthSet(freeMonths, [1,6,12]) || !sameMonthSet(paidFirstYear, [2,3,4,5,7,8,9,10,11])) errors.IntroFree = "Intro Free requires free months 1, 6, and 12 with paid months 2-5 and 7-11.";
  }
  return {valid:Object.keys(errors).length === 0, errors, analysis};
}
function savePricingScheduleRows(scheduleID, inputRows, meta={}){
  if(!EditingSession.isEditing) startEditingSession();
  const normalizedRows = inputRows.map(row => normalizePricingRowForSave({...row, ScheduleID:row.ScheduleID || scheduleID}));
  const validation = validatePricingScheduleRows(normalizedRows, {scheduleID, isNew:meta.isNew, pricingType:meta.pricingType});
  if(!validation.valid) throw new Error(Object.entries(validation.errors).map(([field,msg]) => `${field}: ${msg}`).join("\n"));
  const raw = activeDatabaseSnapshot();
  const existing = Array.isArray(raw[SHEET_MAP.schedules]) ? raw[SHEET_MAP.schedules] : [];
  raw[SHEET_MAP.schedules] = existing.filter(row => row.ScheduleID !== scheduleID).concat(normalizedRows);
  updateWorkingCopy(raw, meta.isNew ? "pricing-schedule-create" : "pricing-schedule-save", {sheet:SHEET_MAP.schedules, ScheduleID:scheduleID});
  return pricingRowsForSchedule(scheduleID);
}
function removePricingScheduleRow(scheduleID, sequence){
  if(!EditingSession.isEditing) startEditingSession();
  const raw = activeDatabaseSnapshot();
  raw[SHEET_MAP.schedules] = (raw[SHEET_MAP.schedules] || []).filter(row => !(row.ScheduleID === scheduleID && Number(row.Sequence) === Number(sequence)));
  updateWorkingCopy(raw, "pricing-row-remove", {sheet:SHEET_MAP.schedules, ScheduleID:scheduleID, Sequence:sequence});
}


function dateRangesOverlap(aStart, aEnd, bStart, bEnd){
  const aS = aStart || "0000-01-01", aE = aEnd || "9999-12-31", bS = bStart || "0000-01-01", bE = bEnd || "9999-12-31";
  return aS <= bE && bS <= aE;
}
function validatePersonaLifecycleRecords(personas=DB.personas){
  const records = [];
  const byId = Object.fromEntries(personas.map(p => [p.PersonaID, p]));
  personas.forEach(persona => {
    const start = normalizeDateCell(persona.EffectiveStartDate), end = normalizeDateCell(persona.EffectiveEndDate);
    if(start && !isValidCalendarDate(start)) records.push(healthRecord(persona.PersonaID, "EffectiveStartDate is malformed; use YYYY-MM-DD.", {EffectiveStartDate:persona.EffectiveStartDate}));
    if(end && !isValidCalendarDate(end)) records.push(healthRecord(persona.PersonaID, "EffectiveEndDate is malformed; use YYYY-MM-DD.", {EffectiveEndDate:persona.EffectiveEndDate}));
    if(start && end && isValidCalendarDate(start) && isValidCalendarDate(end) && end < start) records.push(healthRecord(persona.PersonaID, "EffectiveEndDate is before EffectiveStartDate.", {EffectiveStartDate:start, EffectiveEndDate:end}));
    if(persona.SupersedesPersonaID){
      if(persona.SupersedesPersonaID === persona.PersonaID) records.push(healthRecord(persona.PersonaID, "SupersedesPersonaID cannot reference itself.", {SupersedesPersonaID:persona.SupersedesPersonaID}));
      else if(!byId[persona.SupersedesPersonaID]) records.push(healthRecord(persona.PersonaID, "SupersedesPersonaID target is missing.", {SupersedesPersonaID:persona.SupersedesPersonaID}));
    }
  });
  personas.forEach(persona => {
    const seen = new Set([persona.PersonaID]); let next = persona.SupersedesPersonaID;
    while(next){ if(seen.has(next)){ records.push(healthRecord(persona.PersonaID, "Version chain is circular.", {SupersedesPersonaID:persona.SupersedesPersonaID})); break; } seen.add(next); next = byId[next]?.SupersedesPersonaID; }
  });
  function chainRoot(persona){
    const seen = new Set(); let current = persona;
    while(current?.SupersedesPersonaID && byId[current.SupersedesPersonaID] && !seen.has(current.PersonaID)){
      seen.add(current.PersonaID); current = byId[current.SupersedesPersonaID];
    }
    return current?.PersonaID || persona.PersonaID;
  }
  const groups = groupBy(personas.filter(p => p.SupersedesPersonaID || personas.some(other => other.SupersedesPersonaID === p.PersonaID)), row => chainRoot(row));
  Object.values(groups).forEach(rows => rows.forEach((a,i)=>rows.slice(i+1).forEach(b => {
    if(dateRangesOverlap(normalizeDateCell(a.EffectiveStartDate), normalizeDateCell(a.EffectiveEndDate), normalizeDateCell(b.EffectiveStartDate), normalizeDateCell(b.EffectiveEndDate))){
      records.push(healthRecord(`${a.PersonaID}/${b.PersonaID}`, "Persona versions have overlapping effective date ranges.", {PersonaID:a.PersonaID, OtherPersonaID:b.PersonaID}));
    }
    if(!normalizeDateCell(a.EffectiveEndDate) && !normalizeDateCell(b.EffectiveEndDate) && isPersonaCurrentlyActive(a) && isPersonaCurrentlyActive(b)){
      records.push(healthRecord(`${a.PersonaID}/${b.PersonaID}`, "Conflicting open-ended active versions.", {PersonaID:a.PersonaID, OtherPersonaID:b.PersonaID}));
    }
  })));
  return records;
}
function runDatabaseHealth(){
  DB.health = buildHealth();
  DB.raw[SHEET_MAP.health] = DB.health.map(row => ({Section:row.Section, Check:row.Check, Status:row.Status, Count:row.Count, Details:row.Details}));
  if(EditingSession.isEditing && EditingSession.workingRaw) EditingSession.workingRaw[SHEET_MAP.health] = cloneDatabasePayload(DB.raw[SHEET_MAP.health]);
  return DB.health;
}

function groupBy(arr, key){
  return arr.reduce((acc,row)=>{
    const k = (typeof key === "function" ? key(row) : row[key]) || "";
    if(!acc[k]) acc[k]=[];
    acc[k].push(row);
    return acc;
  }, {});
}
function getUnique(arr, key){
  return [...new Set(arr.map(x=>x[key]).filter(Boolean))].sort();
}
function searchPersonas(query, family, pricing){
  const q = (query || "").toLowerCase().trim();
  const families = Array.isArray(family) ? family : (family ? [family] : []);
  return DB.personas.filter(p => {
    if(families.length && !families.includes(p.FamilyGroup)) return false;
    if(pricing && p.PricingSet !== pricing) return false;
    if(!q) return true;
    const blob = [
      p.PersonaName,p.FamilyGroup,p.PricingSet,p.PersonaID,
      ...(p.speeds||[]).flatMap(s => [s.ReferenceID,s.SpeedOption,s.DisplaySpeed,s.UploadSpeed,s.FirstPaidPrice,s.RegularRate]),
      ...(p.modifiers||[]).map(m=>m.ModifierName)
    ].join(" ").toLowerCase();
    return blob.includes(q);
  });
}
function buildHealth(options = {}){
  const includeWorkbookRows = options.includeWorkbookRows !== false;
  const rows = [];
  const personaById = Object.fromEntries(DB.personas.map(p => [p.PersonaID, p]));
  const disc = new Set(DB.disclaimers.map(d=>d.DisclaimerID));

  rows.push({Section:"Summary",Check:"Market Personas",Status:"OK",Count:DB.personas.length,Details:"Rows in 05_Personas"});
  rows.push({Section:"Summary",Check:"Speed Options",Status:"OK",Count:DB.speedOptions.length,Details:"Rows in 06_SpeedOptions"});
  rows.push({Section:"Summary",Check:"Pricing Schedules",Status:"OK",Count:DB.schedules.length,Details:"Rows in 07_PricingSchedules"});

  const missingModifiedByRecords = DB.personas
    .filter(persona => !String(persona.ModifiedBy ?? "").trim())
    .map(persona => healthRecord(
      persona.PersonaName || persona.PersonaID,
      "Persona does not have a ModifiedBy value from the imported 05_Personas sheet.",
      {PersonaID:persona.PersonaID || "", PersonaName:persona.PersonaName || "", ModifiedBy:persona.ModifiedBy ?? ""}
    ));
  rows.push({
    Section:"Audit",
    Check:"Personas missing ModifiedBy",
    Status:missingModifiedByRecords.length?"WARN":"OK",
    Count:missingModifiedByRecords.length,
    Details:healthDetailsFromRecords(missingModifiedByRecords),
    Records:missingModifiedByRecords
  });

  const lifecycleRecords = validatePersonaLifecycleRecords(DB.personas);
  rows.push({
    Section:"Personas",
    Check:"Persona lifecycle scheduling",
    Status:lifecycleRecords.length?"BAD":"OK",
    Count:lifecycleRecords.length,
    Details:lifecycleRecords.length ? healthDetailsFromRecords(lifecycleRecords) : "Persona lifecycle dates and version chains are valid.",
    Records:lifecycleRecords
  });

  const invalidFiberRecords = DB.personas
    .filter(persona => !isBooleanLike(persona.Fiber))
    .map(persona => healthRecord(
      persona.PersonaName || persona.PersonaID,
      "Fiber must be a boolean TRUE or FALSE value.",
      {PersonaID:persona.PersonaID || "", PersonaName:persona.PersonaName || "", Fiber:persona.Fiber ?? ""}
    ));
  rows.push({
    Section:"Personas",
    Check:"Fiber boolean values",
    Status:invalidFiberRecords.length?"BAD":"OK",
    Count:invalidFiberRecords.length,
    Details:invalidFiberRecords.length ? healthDetailsFromRecords(invalidFiberRecords) : "All personas have boolean Fiber values.",
    Records:invalidFiberRecords
  });

  const duplicatePricingKeys = {};
  DB.schedules.forEach(row => {
    const key = pricingRowIdentity(row);
    duplicatePricingKeys[key] = (duplicatePricingKeys[key] || 0) + 1;
  });
  const duplicatePricingRows = Object.entries(duplicatePricingKeys).filter(([,count]) => count > 1);
  const duplicatePricingRecords = duplicatePricingRows.map(([key,count]) => healthRecord(
    key,
    `Pricing schedule has ${count} identical rows for the same schedule, reference, months, price, free flag, and strike-through price.`,
    {Identity:key, DuplicateRows:count}
  ));
  rows.push({
    Section:"Pricing",
    Check:"Duplicate Pricing Rows",
    Status:duplicatePricingRecords.length?"WARN":"OK",
    Count:duplicatePricingRecords.length,
    Details:healthDetailsFromRecords(duplicatePricingRecords),
    Records:duplicatePricingRecords
  });

  const schedulesByExactKey = groupBy(DB.schedules, "ScheduleID");
  const overlapRecords = [];
  Object.entries(schedulesByExactKey).forEach(([scheduleID, scheduleRows]) => {
    const byRef = groupBy(scheduleRows, "ReferenceID");
    Object.entries(byRef).forEach(([referenceID, refRows]) => {
      const sorted = dedupePricingRows(refRows).sort((a,b)=>Number(a.Sequence||0)-Number(b.Sequence||0));
      for(let i=0; i<sorted.length; i++){
        for(let j=i+1; j<sorted.length; j++){
          const sharedMonths = intersectingMonths(monthsFromScheduleRow(sorted[i]), monthsFromScheduleRow(sorted[j]));
          if(sharedMonths.length){
            overlapRecords.push(healthRecord(
              `${scheduleID}/${referenceID}`,
              `${sorted[j].DisplayLabel || healthMonthLabel(sorted[j])} overlaps ${sorted[i].DisplayLabel || healthMonthLabel(sorted[i])} in month${sharedMonths.length===1?"":"s"} ${sharedMonths.join(", ")}.`,
              {
                ScheduleID:scheduleID,
                ReferenceID:referenceID,
                FirstRange:sorted[i].DisplayLabel || healthMonthLabel(sorted[i]),
                SecondRange:sorted[j].DisplayLabel || healthMonthLabel(sorted[j]),
                OverlappingMonths:sharedMonths.join(", "),
                FirstDisplayAsFree:String(sorted[i].DisplayAsFree || ""),
                SecondDisplayAsFree:String(sorted[j].DisplayAsFree || "")
              }
            ));
          }
        }
      }
    });
  });
  rows.push({
    Section:"Pricing",
    Check:"Overlapping Month Ranges",
    Status:overlapRecords.length?"WARN":"OK",
    Count:overlapRecords.length,
    Details:healthDetailsFromRecords(overlapRecords),
    Records:overlapRecords
  });

  const speedScheduleKeys = {};
  DB.speedOptions.filter(speed => truthy(speed.Active)).forEach(speed => {
    const key = `${speed.PersonaID || ""}|${speed.SpeedOptionID || speed.SpeedOption || ""}|${speed.ReferenceID || ""}`;
    if(!speedScheduleKeys[key]) speedScheduleKeys[key] = {speed, scheduleIDs:new Set(), pricingSets:new Set()};
    speedScheduleKeys[key].scheduleIDs.add(speed.ScheduleID || "");
    const persona = personaById[speed.PersonaID];
    if(persona) speedScheduleKeys[key].pricingSets.add(displayPricingSet(persona.PricingSet));
  });
  const mixedRefRecords = Object.values(speedScheduleKeys)
    .filter(entry => [...entry.scheduleIDs].filter(Boolean).length > 1)
    .map(entry => healthRecord(
      `${entry.speed.PersonaID} ${entry.speed.ReferenceID}`,
      "A single persona speed resolves to more than one ScheduleID, which can mix promotion schedules.",
      {
        PersonaID:entry.speed.PersonaID,
        SpeedOptionID:entry.speed.SpeedOptionID || entry.speed.SpeedOption || "",
        ReferenceID:entry.speed.ReferenceID || "",
        ScheduleIDs:[...entry.scheduleIDs].filter(Boolean).join(" / "),
        PricingSets:[...entry.pricingSets].filter(Boolean).join(" / ")
      }
    ));
  rows.push({
    Section:"Pricing",
    Check:"Mixed Promotion Reference IDs",
    Status:mixedRefRecords.length?"WARN":"OK",
    Count:mixedRefRecords.length,
    Details:healthDetailsFromRecords(mixedRefRecords),
    Records:mixedRefRecords
  });

  const invalidLabelRecords = [];
  DB.schedules.forEach(row => {
    if(rowHasValidMonthLabel(row)) return;
    invalidLabelRecords.push(healthRecord(
      `${row.ScheduleID || "Unknown schedule"}/${row.ReferenceID || "Unknown reference"}`,
      "Pricing schedule row does not have a parseable month range label or structured StartMonth/EndMonth coverage.",
      {ScheduleID:row.ScheduleID || "", ReferenceID:row.ReferenceID || "", Sequence:row.Sequence || "", StartMonth:row.StartMonth ?? "", EndMonth:row.EndMonth ?? "", DisplayLabel:row.DisplayLabel || "", Price:row.Price ?? ""}
    ));
  });
  rows.push({
    Section:"Pricing",
    Check:"Invalid Month Labels",
    Status:invalidLabelRecords.length?"WARN":"OK",
    Count:invalidLabelRecords.length,
    Details:healthDetailsFromRecords(invalidLabelRecords),
    Records:invalidLabelRecords
  });

  const brokenReferenceRecords = [];
  const speedSchedulePairs = new Set(DB.speedOptions.map(speed => `${speed.ScheduleID || ""}|${speed.ReferenceID || ""}`));
  const personaIds = new Set(DB.personas.map(persona => persona.PersonaID).filter(Boolean));
  const modifierIds = new Set(DB.modifiers.map(modifier => modifier.ModifierID).filter(Boolean));
  const disclaimerIds = new Set(DB.disclaimers.map(disclaimer => disclaimer.DisclaimerID).filter(Boolean));
  DB.speedOptions.forEach(speed => {
    if(!personaIds.has(speed.PersonaID)){
      brokenReferenceRecords.push(healthRecord(
        `${speed.PersonaID || "Unknown persona"} ${speed.ReferenceID || "Unknown reference"}`,
        "Speed option references a PersonaID that does not exist.",
        {PersonaID:speed.PersonaID || "", ReferenceID:speed.ReferenceID || "", ScheduleID:speed.ScheduleID || ""}
      ));
    }
  });
  DB.schedules.forEach(row => {
    if(!speedSchedulePairs.has(`${row.ScheduleID || ""}|${row.ReferenceID || ""}`)){
      brokenReferenceRecords.push(healthRecord(
        `${row.ScheduleID || "Unknown schedule"}/${row.ReferenceID || "Unknown reference"}`,
        "Pricing schedule row has no matching speed option for its exact ScheduleID + ReferenceID.",
        {ScheduleID:row.ScheduleID || "", ReferenceID:row.ReferenceID || "", DisplayLabel:row.DisplayLabel || ""}
      ));
    }
  });
  DB.personaModifiers.forEach(row => {
    if(!personaIds.has(row.PersonaID) || !modifierIds.has(row.ModifierID)){
      brokenReferenceRecords.push(healthRecord(
        `${row.PersonaID || "Unknown persona"}/${row.ModifierID || "Unknown modifier"}`,
        "Persona modifier row references a missing persona or modifier.",
        {PersonaID:row.PersonaID || "", ModifierID:row.ModifierID || "", PersonaExists:String(personaIds.has(row.PersonaID)), ModifierExists:String(modifierIds.has(row.ModifierID))}
      ));
    }
  });
  DB.personas.forEach(persona => {
    if(persona.DisclaimerID && !disclaimerIds.has(persona.DisclaimerID)){
      brokenReferenceRecords.push(healthRecord(
        persona.PersonaName || persona.PersonaID,
        "Persona references a DisclaimerID that does not exist.",
        {PersonaID:persona.PersonaID || "", DisclaimerID:persona.DisclaimerID || ""}
      ));
    }
  });
  rows.push({
    Section:"Relationships",
    Check:"Broken References",
    Status:brokenReferenceRecords.length?"WARN":"OK",
    Count:brokenReferenceRecords.length,
    Details:healthDetailsFromRecords(brokenReferenceRecords),
    Records:brokenReferenceRecords
  });

  const duplicateModifierRows = Object.entries(
    DB.personaModifiers.reduce((acc, row) => {
      const key = `${row.PersonaID || ""}|${row.ModifierID || ""}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).filter(([,count]) => count > 1);
  const duplicateModifierRecords = duplicateModifierRows.map(([key, count]) => {
    const [personaID, modifierID] = key.split("|");
    return healthRecord(
      `${personaID}/${modifierID}`,
      `Persona modifier relationship appears ${count} times.`,
      {PersonaID:personaID, ModifierID:modifierID, DuplicateRows:count}
    );
  });
  rows.push({
    Section:"Relationships",
    Check:"Duplicate Persona Modifiers",
    Status:duplicateModifierRecords.length?"WARN":"OK",
    Count:duplicateModifierRecords.length,
    Details:healthDetailsFromRecords(duplicateModifierRecords),
    Records:duplicateModifierRecords
  });

  const missingModifierRecords = [];
  const activeModifierRowsByPersona = groupBy(DB.personaModifiers.filter(row => truthy(row.Active)), "PersonaID");
  const speedsByPersonaForAudit = groupBy(DB.speedOptions.filter(speed => truthy(speed.Active)), "PersonaID");
  DB.personas.filter(persona => String(persona.Status || "").toLowerCase() === "active").forEach(persona => {
    const expectedModifierIDs = expectedModifierIDsForPersona(persona, speedsByPersonaForAudit[persona.PersonaID] || []);
    const activeModifierIDs = new Set((activeModifierRowsByPersona[persona.PersonaID] || []).map(row => row.ModifierID));
    const missing = [...expectedModifierIDs].filter(modifierID => !activeModifierIDs.has(modifierID));
    if(missing.length){
      missingModifierRecords.push(healthRecord(
        persona.PersonaName || persona.PersonaID,
        "Active persona is missing one or more expected ratecard modifier relationships.",
        {PersonaID:persona.PersonaID || "", PersonaName:persona.PersonaName || "", MissingModifierIDs:missing.join(" / ")}
      ));
    }
  });
  rows.push({
    Section:"Relationships",
    Check:"Missing Modifiers",
    Status:missingModifierRecords.length?"WARN":"OK",
    Count:missingModifierRecords.length,
    Details:healthDetailsFromRecords(missingModifierRecords),
    Records:missingModifierRecords
  });

  const priceProgressionRecords = [];
  DB.speedOptions.filter(speed => truthy(speed.Active)).forEach(speed => {
    const rowsForSpeed = sortedScheduleRows(getSchedulesForSpeed(speed));
    const chargeRows = paidRows(rowsForSpeed).filter(row => row.Price !== null && row.Price !== undefined && row.Price !== "");
    for(let i=1; i<chargeRows.length; i++){
      const previousPrice = Number(chargeRows[i-1].Price);
      const currentPrice = Number(chargeRows[i].Price);
      if(Number.isNaN(previousPrice) || Number.isNaN(currentPrice)) continue;
      if(currentPrice < previousPrice){
        const persona = personaById[speed.PersonaID];
        priceProgressionRecords.push(healthRecord(
          `${speed.PersonaID} ${speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
          "Paid pricing decreases across later schedule rows.",
          {PersonaID:speed.PersonaID || "", PersonaName:persona?.PersonaName || "", SpeedOptionID:speed.SpeedOptionID || speed.SpeedOption || "", ScheduleID:speed.ScheduleID || "", ReferenceID:speed.ReferenceID || "", PreviousLabel:chargeRows[i-1].DisplayLabel || "", PreviousPrice:chargeRows[i-1].Price ?? "", CurrentLabel:chargeRows[i].DisplayLabel || "", CurrentPrice:chargeRows[i].Price ?? ""}
        ));
      }
    }
  });
  rows.push({
    Section:"Pricing",
    Check:"Invalid Price Progression",
    Status:priceProgressionRecords.length?"WARN":"OK",
    Count:priceProgressionRecords.length,
    Details:healthDetailsFromRecords(priceProgressionRecords),
    Records:priceProgressionRecords
  });

  const priceLockRecords = [];
  const introFreeRecords = [];
  const flatRecords = [];
  const stepRecords = [];
  DB.speedOptions.filter(speed => truthy(speed.Active)).forEach(speed => {
    const persona = personaById[speed.PersonaID];
    const rowsForSpeed = sortedScheduleRows(getSchedulesForSpeed(speed));
    const pricingType = String(speed.PricingType || "").trim().toLowerCase();
    const pricingSet = displayPricingSet(persona?.PricingSet || "");
    const coverage = scheduleCoverageMonths(rowsForSpeed);
    const baseFields = {PersonaID:speed.PersonaID || "", PersonaName:persona?.PersonaName || "", SpeedOptionID:speed.SpeedOptionID || speed.SpeedOption || "", ScheduleID:speed.ScheduleID || "", ReferenceID:speed.ReferenceID || "", ExistingMonthRanges:scheduleRangeSummary(rowsForSpeed)};

    if(/3\s*year\s*price\s*lock/i.test(pricingSet) && !isStandalone40OneGigException(speed, rowsForSpeed)){
      const missingRanges = missingCoverageLabels(coverage);
      if(missingRanges.length){
        priceLockRecords.push(healthRecord(
          `${speed.PersonaID} ${speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
          `3-Year Price Lock schedule is missing ${missingRanges.join("; ")}.`,
          {...baseFields, MissingMonthRanges:missingRanges.join("; ")}
        ));
      }
    }

    if(pricingType === "intro free"){
      const freeMonths = scheduleCoverageMonths(rowsForSpeed.filter(row => truthy(row.DisplayAsFree)));
      const firstYearPaidMonths = scheduleCoverageMonths(rowsForSpeed.filter(row => !truthy(row.DisplayAsFree) && [...monthsFromScheduleRow(row)].some(month => month >= 1 && month <= 12)));
      if(!sameMonthSet(freeMonths, [1,6,12]) || !sameMonthSet(firstYearPaidMonths, [2,3,4,5,7,8,9,10,11])){
        introFreeRecords.push(healthRecord(
          `${speed.PersonaID} ${speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
          "Intro Free schedule must cover free months 1, 6, and 12 with paid months 2-5 and 7-11 in the first year.",
          {...baseFields, FreeMonths:formatMonthRanges(freeMonths).join("; "), FirstYearPaidMonths:formatMonthRanges(firstYearPaidMonths).join("; ")}
        ));
      }
    }

    if(pricingType === "flat"){
      if(rowsForSpeed.length !== 1 || !rowsForSpeed.every(row => !truthy(row.DisplayAsFree))){
        flatRecords.push(healthRecord(
          `${speed.PersonaID} ${speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
          "Flat pricing should resolve to one non-free schedule row.",
          {...baseFields, RowCount:rowsForSpeed.length}
        ));
      }
    }

    if(pricingType === "step pricing"){
      const chargeRows = paidRows(rowsForSpeed);
      if(chargeRows.length < 2){
        stepRecords.push(healthRecord(
          `${speed.PersonaID} ${speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
          "Step Pricing should resolve to at least two paid schedule rows.",
          {...baseFields, PaidRowCount:chargeRows.length}
        ));
      }
    }
  });
  rows.push({Section:"Pricing", Check:"Invalid 3-Year Price Lock Structure", Status:priceLockRecords.length?"WARN":"OK", Count:priceLockRecords.length, Details:healthDetailsFromRecords(priceLockRecords), Records:priceLockRecords});
  rows.push({Section:"Pricing", Check:"Invalid Intro Free Structure", Status:introFreeRecords.length?"WARN":"OK", Count:introFreeRecords.length, Details:healthDetailsFromRecords(introFreeRecords), Records:introFreeRecords});
  rows.push({Section:"Pricing", Check:"Invalid Flat Pricing Structure", Status:flatRecords.length?"WARN":"OK", Count:flatRecords.length, Details:healthDetailsFromRecords(flatRecords), Records:flatRecords});
  rows.push({Section:"Pricing", Check:"Invalid Step Pricing Structure", Status:stepRecords.length?"WARN":"OK", Count:stepRecords.length, Details:healthDetailsFromRecords(stepRecords), Records:stepRecords});


  const coverageRecords = [];
  DB.speedOptions.filter(speed => truthy(speed.Active)).forEach(speed => {
    const persona = personaById[speed.PersonaID];
    const rowsForSpeed = getSchedulesForSpeed(speed);
    if(!isThirtySixMonthCoverageCandidate(persona, speed, rowsForSpeed)) return;
    const missingRanges = missingCoverageLabels(scheduleCoverageMonths(rowsForSpeed));
    if(!missingRanges.length) return;
    coverageRecords.push(healthRecord(
      `${speed.PersonaID} ${speed.SpeedOptionID || speed.SpeedOption || ""} ${speed.ScheduleID || ""}`,
      `Schedule is intended to cover 36 months but is missing ${missingRanges.join("; ")}.`,
      {
        PersonaID:speed.PersonaID || "",
        PersonaName:persona?.PersonaName || "",
        SpeedOptionID:speed.SpeedOptionID || speed.SpeedOption || "",
        ScheduleID:speed.ScheduleID || "",
        ReferenceID:speed.ReferenceID || "",
        ExistingMonthRanges:scheduleRangeSummary(rowsForSpeed),
        MissingMonthRanges:missingRanges.join("; ")
      }
    ));
  });
  rows.push({
    Section:"Pricing",
    Check:"36-Month Promotion Coverage",
    Status:coverageRecords.length?"WARN":"OK",
    Count:coverageRecords.length,
    Details:healthDetailsFromRecords(coverageRecords),
    Records:coverageRecords
  });

  const missingSchedule = DB.speedOptions.filter(speed => !DB.schedules.some(row =>
    row.ReferenceID === speed.ReferenceID && row.ScheduleID === speed.ScheduleID
  ));
  const missingScheduleRecords = missingSchedule.map(speed => healthRecord(
    `${speed.PersonaID} ${speed.ReferenceID} ${speed.ScheduleID}`,
    "Speed option has no matching pricing rows for its exact ScheduleID + ReferenceID.",
    {PersonaID:speed.PersonaID, ReferenceID:speed.ReferenceID, ScheduleID:speed.ScheduleID, SpeedOption:speed.SpeedOption}
  ));
  rows.push({
    Section:"Relationships",
    Check:"Missing Pricing Rows",
    Status:missingScheduleRecords.length?"WARN":"OK",
    Count:missingScheduleRecords.length,
    Details:healthDetailsFromRecords(missingScheduleRecords),
    Records:missingScheduleRecords
  });

  const missingDisc = DB.personas.filter(p=>!p.DisclaimerID || !disc.has(p.DisclaimerID));
  const missingDiscRecords = missingDisc.map(p => healthRecord(
    p.PersonaName || p.PersonaID,
    p.DisclaimerID ? `Persona references missing DisclaimerID ${p.DisclaimerID}.` : "Persona does not have a DisclaimerID.",
    {PersonaID:p.PersonaID, PersonaName:p.PersonaName, DisclaimerID:p.DisclaimerID || ""}
  ));
  rows.push({
    Section:"Relationships",
    Check:"Missing Disclaimers",
    Status:missingDiscRecords.length?"WARN":"OK",
    Count:missingDiscRecords.length,
    Details:healthDetailsFromRecords(missingDiscRecords),
    Records:missingDiscRecords
  });

  const iconRecords = [];
  const iconFiles = new Set(DB.icons.map(i => normalizeIconFile(i.FileName)).filter(Boolean));
  if(typeof AssetManager !== "undefined") AssetManager.staged.forEach(asset => { if(asset.category === "Promotion Icons" || asset.category === "Modifier Icons") iconFiles.add(normalizeIconFile(asset.filename)); });
  DB.icons.forEach(icon => {
    const resolved = resolveIconPath(icon.FileName);
    if(!resolved){
      iconRecords.push(healthRecord(
        icon.IconName || icon.IconID,
        "Icon table row does not resolve to an image path.",
        {IconID:icon.IconID, IconName:icon.IconName, FileName:icon.FileName || "", ResolvedPath:resolved}
      ));
    }
  });
  DB.personas.forEach(persona => {
    const normalized = normalizeIconFile(persona.PromoIcon);
    const resolved = resolveIconPath(persona.PromoIcon);
    if(!normalized || !iconFiles.has(normalized)){
      iconRecords.push(healthRecord(
        persona.PersonaName || persona.PersonaID,
        "Persona PromoIcon does not match a FileName in the Icons table or staged promotion icon assets.",
        {PersonaID:persona.PersonaID, PromoIcon:persona.PromoIcon || "", ResolvedPath:resolved}
      ));
    }
  });
  (DB.raw[SHEET_MAP.pricingSets] || []).forEach(pricingSet => {
    const normalized = normalizeIconFile(pricingSet.DefaultIcon);
    const resolved = resolveIconPath(pricingSet.DefaultIcon);
    if(normalized && !iconFiles.has(normalized)){
      iconRecords.push(healthRecord(
        pricingSet.PricingSetName || pricingSet.PricingSetID,
        "Pricing DefaultIcon does not match a FileName in the Icons table or staged icon assets.",
        {PricingSetID:pricingSet.PricingSetID, DefaultIcon:pricingSet.DefaultIcon || "", ResolvedPath:resolved}
      ));
    }
  });
  DB.modifiers.forEach(modifier => {
    const normalized = normalizeIconFile(modifier.IconFile);
    const resolved = resolveIconPath(modifier.IconFile);
    if(!normalized || !iconFiles.has(normalized)){
      iconRecords.push(healthRecord(
        modifier.ModifierName || modifier.ModifierID,
        "Modifier IconFile does not match a FileName in the Icons table or staged modifier icon assets.",
        {ModifierID:modifier.ModifierID, IconFile:modifier.IconFile || "", ResolvedPath:resolved}
      ));
    }
  });
  DB.iconFailures.forEach(failure => {
    iconRecords.push(healthRecord(
      `${failure.Context.type || "Icon"} ${failure.Context.id || failure.Path}`,
      failure.Reason,
      {ResolvedPath:failure.Path, SourceFile:failure.Context.file || "", AssociatedRecord:failure.Context.name || ""}
    ));
  });
  rows.push({
    Section:"Assets",
    Check:"Resolved Icon Image Paths",
    Status:iconRecords.length?"WARN":"OK",
    Count:iconRecords.length,
    Details:healthDetailsFromRecords(iconRecords),
    Records:iconRecords
  });

  if(!includeWorkbookRows) return rows;
  const workbookRows = normalizedWorkbookHealthRows();
  return rows.concat(workbookRows);
}

const HEALTH_EXPORT_COLUMNS = [
  "Severity",
  "Section",
  "Check",
  "PersonaID",
  "PersonaName",
  "SpeedOptionID",
  "SpeedOption",
  "ScheduleID",
  "ReferenceID",
  "ModifierID",
  "DisclaimerID",
  "AssetPath",
  "Message",
  "ExistingValue",
  "ExpectedValue",
  "SuggestedAction"
];
const HEALTH_ERROR_STATUSES = new Set(["BAD", "ERROR", "FAIL"]);
function healthExportTimestamp(date=new Date()){
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
function healthExportSource(){
  return DB.sourceFilename || (DB.loadedFromWorkbook ? "Uploaded workbook" : "Published database");
}
function healthExportDirtyState(){
  if(typeof editingHasUnsavedChanges === "function") return editingHasUnsavedChanges() ? "dirty" : "clean";
  return EditingSession.isEditing ? "dirty" : "clean";
}
function liveWorkingCopyHealthRows(){
  return buildHealth({includeWorkbookRows:false});
}
function healthSeverity(row){
  return String(row.Status || "").trim().toUpperCase() || "UNKNOWN";
}
function healthFindingRows(severityFilter="all"){
  const rows = liveWorkingCopyHealthRows();
  const findings = [];
  rows.forEach(row => {
    const severity = healthSeverity(row);
    if(severity === "OK") return;
    if(severityFilter === "warnings" && severity !== "WARN") return;
    if(severityFilter === "errors" && !HEALTH_ERROR_STATUSES.has(severity)) return;
    const records = Array.isArray(row.Records) && row.Records.length ? row.Records : [healthRecord(row.Check || "Health check", row.Details || "No details available.", {})];
    records.forEach(record => {
      const fields = record.Fields || {};
      findings.push({
        Severity: severity,
        Section: row.Section || "",
        Check: row.Check || "",
        PersonaID: fields.PersonaID ?? "",
        PersonaName: fields.PersonaName ?? "",
        SpeedOptionID: fields.SpeedOptionID ?? "",
        SpeedOption: fields.SpeedOption ?? "",
        ScheduleID: fields.ScheduleID ?? fields.IntroFreeScheduleID ?? "",
        ReferenceID: fields.ReferenceID ?? "",
        ModifierID: fields.ModifierID ?? "",
        DisclaimerID: fields.DisclaimerID ?? "",
        AssetPath: fields.AssetPath ?? fields.ResolvedPath ?? fields.SourceFile ?? fields.IconFile ?? fields.PromoIcon ?? "",
        Message: record.Reason || row.Details || "",
        ExistingValue: fields.ExistingValue ?? fields.CurrentValue ?? fields.ActualValue ?? fields.Price ?? fields.CurrentPrice ?? fields.ExistingMonthRanges ?? "",
        ExpectedValue: fields.ExpectedValue ?? fields.MissingMonthRanges ?? fields.MissingModifierIDs ?? fields.ScheduleIDs ?? "",
        SuggestedAction: fields.SuggestedAction ?? suggestedHealthAction(row, record)
      });
    });
  });
  return findings;
}
function suggestedHealthAction(row, record){
  const section = String(row.Section || "").toLowerCase();
  if(section.includes("asset")) return "Resolve the missing or mismatched asset path in the working copy.";
  if(section.includes("relationship")) return "Update the related working-copy IDs so each reference points to an existing record.";
  if(section.includes("pricing")) return "Review and correct the pricing schedule rows in the working copy.";
  if(section.includes("audit")) return "Update the audit metadata in the working copy.";
  return record?.Reason ? "Review the listed working-copy record and correct the reported health finding." : "Review Database Health for this working-copy finding.";
}
function csvEscape(value){
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function healthFindingsCsv(findings){
  return "\ufeff" + [HEALTH_EXPORT_COLUMNS.join(","), ...findings.map(row => HEALTH_EXPORT_COLUMNS.map(column => csvEscape(row[column])).join(","))].join("\r\n") + "\r\n";
}
function healthExportCounts(findings=healthFindingRows("all")){
  return findings.reduce((counts, row) => {
    counts.total += 1;
    if(row.Severity === "WARN") counts.warnings += 1;
    if(HEALTH_ERROR_STATUSES.has(row.Severity)) counts.errors += 1;
    counts.bySeverity[row.Severity] = (counts.bySeverity[row.Severity] || 0) + 1;
    return counts;
  }, {total:0, warnings:0, errors:0, bySeverity:{}});
}
function healthLogText(){
  const generatedAt = new Date().toISOString();
  const findings = healthFindingRows("all");
  const counts = healthExportCounts(findings);
  const grouped = groupBy(findings, row => `${row.Severity} / ${row.Section || "Unsectioned"}`);
  const lines = [
    "Personaville Health Log",
    `Generated: ${generatedAt}`,
    `Source: ${healthExportSource()}`,
    `Version: ${publishingDatabaseVersion()}`,
    `Dirty state: ${healthExportDirtyState()}`,
    `Counts: ${counts.total} finding(s), ${counts.warnings} warning(s), ${counts.errors} error(s)`,
    ""
  ];
  if(!findings.length){
    lines.push("No warning or error findings were found in the live working-copy health results.");
  }else{
    Object.keys(grouped).sort().forEach(group => {
      lines.push(`[${group}]`);
      grouped[group].forEach(f => lines.push(`- ${f.Check}: ${f.Message} (${[f.PersonaID, f.SpeedOptionID, f.ScheduleID, f.ReferenceID, f.ModifierID, f.DisclaimerID, f.AssetPath].filter(Boolean).join(" / ") || "record-level detail unavailable"})`));
      lines.push("");
    });
  }
  return lines.join("\n") + "\n";
}
function healthExportPayload(kind){
  const timestamp = healthExportTimestamp();
  if(kind === "log") return {filename:`Personaville-Health-Log-${timestamp}.txt`, type:"text/plain;charset=utf-8", text:healthLogText(), count:1};
  const filter = kind === "warnings" ? "warnings" : kind === "errors" ? "errors" : "all";
  const findings = healthFindingRows(filter);
  const prefix = kind === "warnings" ? "Warnings" : kind === "errors" ? "Errors" : "Report";
  return {filename:`Personaville-Health-${prefix}-${timestamp}.csv`, type:"text/csv;charset=utf-8", text:healthFindingsCsv(findings), count:findings.length};
}

const MODIFIER_EDITOR_FIELDS = ["ModifierID", "ModifierName", "Category", "IconFile", "Active", "Description"];
const DISCLAIMER_EDITOR_FIELDS = ["DisclaimerID", "Title", "DisclaimerText", "Active"];
function modifierRelationships(modifierID){
  return DB.personaModifiers.filter(row => row.ModifierID === modifierID).map(row => ({...row, persona:DB.personas.find(p => p.PersonaID === row.PersonaID) || {}})).sort((a,b)=>Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0));
}
function personasUsingDisclaimer(disclaimerID){ return DB.personas.filter(p => p.DisclaimerID === disclaimerID).sort((a,b)=>String(a.PersonaName||a.PersonaID).localeCompare(String(b.PersonaName||b.PersonaID))); }
function missingDisclaimerRelationships(){
  const disclaimerIDs = new Set(DB.disclaimers.map(row => row.DisclaimerID).filter(Boolean));
  return DB.personas
    .filter(persona => !persona.DisclaimerID || !disclaimerIDs.has(persona.DisclaimerID))
    .sort((a,b)=>String(a.PersonaName||a.PersonaID).localeCompare(String(b.PersonaName||b.PersonaID)));
}
function nextSafeModifierID(){ const nums=DB.modifiers.map(r=>String(r.ModifierID||"").match(/^MOD_(\d+)$/i)?.[1]).filter(Boolean).map(Number); let n=(nums.length?Math.max(...nums):0)+1; let id; do{id=`MOD_${String(n++).padStart(3,"0")}`;}while(DB.modifiers.some(r=>r.ModifierID===id)); return id; }
function nextSafeDisclaimerID(){ const nums=DB.disclaimers.map(r=>String(r.DisclaimerID||"").match(/^DISC_(\d+)$/i)?.[1]).filter(Boolean).map(Number); let n=(nums.length?Math.max(...nums):0)+1; let id; do{id=`DISC_${String(n++).padStart(3,"0")}`;}while(DB.disclaimers.some(r=>r.DisclaimerID===id)); return id; }
function normalizeModifierForSave(input, existing={}){ const row={...existing}; MODIFIER_EDITOR_FIELDS.forEach(f=>row[f]=input[f]??""); row.Active=truthy(row.Active)?"TRUE":"FALSE"; return row; }
function validateModifierDraft(input, originalID=""){ const errors={}; ["ModifierID","ModifierName"].forEach(f=>{if(!String(input[f]??"").trim()) errors[f]="Required";}); const id=String(input.ModifierID||"").trim(); if(id&&id!==originalID&&DB.modifiers.some(r=>r.ModifierID===id)) errors.ModifierID="ModifierID already exists."; return {valid:!Object.keys(errors).length, errors}; }
function saveModifierDraft(input, originalID=""){ if(!EditingSession.isEditing) startEditingSession(); const validation=validateModifierDraft(input, originalID); if(!validation.valid) throw new Error(Object.entries(validation.errors).map(([f,m])=>`${f}: ${m}`).join("\n")); const raw=activeDatabaseSnapshot(); const rows=Array.isArray(raw[SHEET_MAP.modifiers])?raw[SHEET_MAP.modifiers]:[]; const index=originalID?rows.findIndex(r=>r.ModifierID===originalID):-1; const saved=normalizeModifierForSave(input,index>=0?rows[index]:{}); if(index>=0) rows[index]=saved; else rows.push(saved); raw[SHEET_MAP.modifiers]=rows; updateWorkingCopy(raw,index>=0?"modifier-save":"modifier-create",{sheet:SHEET_MAP.modifiers, ModifierID:saved.ModifierID}); return saved; }
function setModifierActive(id, active){ const row=DB.modifiers.find(r=>r.ModifierID===id); if(!row) throw new Error("Modifier not found."); return saveModifierDraft({...row, Active:active?"TRUE":"FALSE"}, id); }
function validatePersonaModifierDraft(input, originalKey=""){ const errors={}; if(!DB.personas.some(p=>p.PersonaID===input.PersonaID)) errors.PersonaID="PersonaID does not exist."; if(!DB.modifiers.some(m=>m.ModifierID===input.ModifierID)) errors.ModifierID="ModifierID does not exist."; const key=`${input.PersonaID||""}|${input.ModifierID||""}`; if(key!==originalKey&&DB.personaModifiers.some(r=>`${r.PersonaID||""}|${r.ModifierID||""}`===key)) errors.ModifierID="This PersonaID + ModifierID relationship already exists."; return {valid:!Object.keys(errors).length, errors}; }
function savePersonaModifierDraft(input, originalKey=""){ if(!EditingSession.isEditing) startEditingSession(); const validation=validatePersonaModifierDraft(input, originalKey); if(!validation.valid) throw new Error(Object.values(validation.errors).join("\n")); const raw=activeDatabaseSnapshot(); const rows=Array.isArray(raw[SHEET_MAP.personaModifiers])?raw[SHEET_MAP.personaModifiers]:[]; const index=originalKey?rows.findIndex(r=>`${r.PersonaID||""}|${r.ModifierID||""}`===originalKey):-1; const saved={PersonaID:input.PersonaID||"", ModifierID:input.ModifierID||"", DisplayOrder:input.DisplayOrder===""?"":Number(input.DisplayOrder), Active:truthy(input.Active)?"TRUE":"FALSE"}; if(index>=0) rows[index]=saved; else rows.push(saved); raw[SHEET_MAP.personaModifiers]=rows; updateWorkingCopy(raw,index>=0?"persona-modifier-save":"persona-modifier-create",{sheet:SHEET_MAP.personaModifiers, key:`${saved.PersonaID}|${saved.ModifierID}`}); return saved; }
function removePersonaModifier(personaID, modifierID){ if(!EditingSession.isEditing) startEditingSession(); const raw=activeDatabaseSnapshot(); raw[SHEET_MAP.personaModifiers]=(raw[SHEET_MAP.personaModifiers]||[]).filter(r=>!(r.PersonaID===personaID&&r.ModifierID===modifierID)); updateWorkingCopy(raw,"persona-modifier-remove",{sheet:SHEET_MAP.personaModifiers, key:`${personaID}|${modifierID}`}); }
function movePersonaModifier(personaID, modifierID, direction){ const row=DB.personaModifiers.find(r=>r.PersonaID===personaID&&r.ModifierID===modifierID); if(!row) return; const siblings=DB.personaModifiers.filter(r=>r.PersonaID===personaID).sort((a,b)=>Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0)); const index=siblings.findIndex(r=>r.ModifierID===modifierID); const swap=siblings[index+direction]; if(!swap) return; savePersonaModifierDraft({...row, DisplayOrder:swap.DisplayOrder}, `${row.PersonaID}|${row.ModifierID}`); savePersonaModifierDraft({...swap, DisplayOrder:row.DisplayOrder}, `${swap.PersonaID}|${swap.ModifierID}`); }
function expectedModifierWarningsForPersona(personaID){ const persona=DB.personas.find(p=>p.PersonaID===personaID); const expected=[...expectedModifierIDsForPersona(persona, DB.speedOptions.filter(s=>s.PersonaID===personaID&&truthy(s.Active)))]; const active=new Set(DB.personaModifiers.filter(r=>r.PersonaID===personaID&&truthy(r.Active)).map(r=>r.ModifierID)); return expected.filter(id=>!active.has(id)).map(id=>`Expected ${id} based on pricing/persona data.`); }
function validateDisclaimerDraft(input, originalID=""){ const errors={}; if(!String(input.DisclaimerID||"").trim()) errors.DisclaimerID="Required"; if(!String(input.DisclaimerText??"").trim()) errors.DisclaimerText="Required"; if(input.DisclaimerID&&input.DisclaimerID!==originalID&&DB.disclaimers.some(r=>r.DisclaimerID===input.DisclaimerID)) errors.DisclaimerID="DisclaimerID already exists."; return {valid:!Object.keys(errors).length, errors}; }
function saveDisclaimerDraft(input, originalID=""){ if(!EditingSession.isEditing) startEditingSession(); const validation=validateDisclaimerDraft(input, originalID); if(!validation.valid) throw new Error(Object.values(validation.errors).join("\n")); const raw=activeDatabaseSnapshot(); const rows=Array.isArray(raw[SHEET_MAP.disclaimers])?raw[SHEET_MAP.disclaimers]:[]; const index=originalID?rows.findIndex(r=>r.DisclaimerID===originalID):-1; const saved={...(index>=0?rows[index]:{})}; DISCLAIMER_EDITOR_FIELDS.forEach(f=>saved[f]=input[f]??""); saved.Active=truthy(saved.Active)?"TRUE":"FALSE"; if(index>=0) rows[index]=saved; else rows.push(saved); raw[SHEET_MAP.disclaimers]=rows; updateWorkingCopy(raw,index>=0?"disclaimer-save":"disclaimer-create",{sheet:SHEET_MAP.disclaimers, DisclaimerID:saved.DisclaimerID}); return saved; }
function duplicateDisclaimer(id){ const source=DB.disclaimers.find(r=>r.DisclaimerID===id); if(!source) throw new Error("Disclaimer not found."); return saveDisclaimerDraft({...source, DisclaimerID:nextSafeDisclaimerID(), Title:`${source.Title||"Disclaimer"} Copy`, Active:"FALSE"}, ""); }
