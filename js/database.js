
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
  downloadableRaw: null
};

const ICON_DIR = "assets/icons/";
function normalizeIconFile(file){
  const value = String(file || "").trim();
  if(!value) return "";
  if(/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  const relative = value.replace(/^\.\//, "");
  return relative.replace(/^(?:assets\/icons\/|icons\/)+/i, "");
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
  applyRawDatabase(data, {source:"bundled", filename:"database/persona-db.json"});
}
function cloneDatabasePayload(raw){
  return JSON.parse(JSON.stringify(raw || {}));
}
function normalizeDatabasePayload(raw){
  const normalized = {};
  Object.keys(raw || {}).forEach(key => {
    normalized[key] = Array.isArray(raw[key]) ? raw[key].map(row => ({...row})) : raw[key];
  });
  return normalized;
}
function applyRawDatabase(raw, options={}){
  const normalized = normalizeDatabasePayload(raw);
  DB.raw = normalized;
  DB.loadedFromWorkbook = options.source === "workbook";
  DB.downloadableRaw = DB.loadedFromWorkbook ? cloneDatabasePayload(normalized) : null;
  DB.personas = normalized[SHEET_MAP.personas] || [];
  DB.speedOptions = normalized[SHEET_MAP.speedOptions] || [];
  DB.schedules = normalized[SHEET_MAP.schedules] || [];
  DB.modifiers = normalized[SHEET_MAP.modifiers] || [];
  DB.personaModifiers = normalized[SHEET_MAP.personaModifiers] || [];
  DB.disclaimers = normalized[SHEET_MAP.disclaimers] || [];
  DB.icons = normalized[SHEET_MAP.icons] || [];
  DB.health = normalized[SHEET_MAP.health] || [];
  DB.settings = normalized[SHEET_MAP.settings] || [];
  DB.sourceFilename = options.filename || (DB.loadedFromWorkbook ? "Uploaded workbook" : "database/persona-db.json");
  DB.lastBuildAt = DB.loadedFromWorkbook ? new Date().toISOString() : databaseSetting("GeneratedOn") || "";
  DB.iconFailures = [];
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
  if(!DB.loadedFromWorkbook || !DB.downloadableRaw) throw new Error("Upload Workbook must successfully load a workbook before downloading updated JSON.");
  return JSON.stringify(DB.downloadableRaw, null, 2) + "\n";
}
function hasBlockingHealthErrors(){
  return currentBuildSummary().healthErrors > 0;
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
    p.speeds = (speedsByPersona[p.PersonaID] || []).sort((a,b) => Number(a.SortOrder||0)-Number(b.SortOrder||0));
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
function groupBy(arr, key){
  return arr.reduce((acc,row)=>{
    const k = row[key] || "";
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
function buildHealth(){
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
        "Persona PromoIcon does not match a FileName in the Icons table.",
        {PersonaID:persona.PersonaID, PromoIcon:persona.PromoIcon || "", ResolvedPath:resolved}
      ));
    }
  });
  DB.modifiers.forEach(modifier => {
    const normalized = normalizeIconFile(modifier.IconFile);
    const resolved = resolveIconPath(modifier.IconFile);
    if(!normalized || !iconFiles.has(normalized)){
      iconRecords.push(healthRecord(
        modifier.ModifierName || modifier.ModifierID,
        "Modifier IconFile does not match a FileName in the Icons table.",
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

  const workbookRows = normalizedWorkbookHealthRows();
  return rows.concat(workbookRows);
}
