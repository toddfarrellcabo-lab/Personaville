
let selectedPersona = null;
const exportSelection = new Set();

function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(v===null || v===undefined || v===false) return;
    if(k==="class") node.className=v;
    else if(k==="html") node.innerHTML=v;
    else if(k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k,v===true ? "" : v);
  });
  [].concat(children).forEach(ch=>{
    if(ch===null || ch===undefined) return;
    node.appendChild(typeof ch==="string" ? document.createTextNode(ch) : ch);
  });
  return node;
}

function iconImage(path, alt, context={}, fallbackText="1:1"){
  if(!path) return el("span",{class:"icon-fallback", "aria-label":"No icon selected"},[fallbackText]);
  return el("img",{
    src:path,
    alt:alt || "",
    loading:"lazy",
    onerror:(event)=>{
      recordIconLoadFailure(path, context);
      event.currentTarget.parentNode.replaceChildren(el("span",{class:"icon-fallback missing-icon", "aria-label":"Missing icon"},[fallbackText || "Missing"]));
      renderHealth();
    }
  });
}
function iconSlot(path, alt, context){
  return el("div",{class:"icon-slot"},[iconImage(path, alt, context)]);
}
function modifierChip(m){
  return el("span",{class:"chip mod"},[
    m.IconPath ? iconImage(m.IconPath, "", {type:"Modifier", id:m.ModifierID, name:m.ModifierName, file:m.IconFile}, "") : null,
    m.ModifierName
  ]);
}

function renderAll(){
  renderKpis();
  fillFilters();
  renderTiles();
  renderModifiers();
  renderHealth();
  renderBuildSummary();
  renderSourceBanner();
  renderPublishPanel();
  renderEditingStatus();
  renderChangeReview();
  renderPersonaEditor();
  renderSpeedOptionEditor();
  renderPricingScheduleEditor();
  renderModifierEditor();
  renderPersonaModifierEditor();
  renderDisclaimerEditor();
  if(typeof renderAssetManager === "function") renderAssetManager();
  fillExportPicker();
  renderExportCartTray();
  document.getElementById("dbStatus").textContent = "Database loaded";
  document.getElementById("dbStatus").className = "pill gray";
  const download = document.getElementById("downloadUpdatedJson");
  if(download) download.disabled = !(DB.loadedFromWorkbook || EditingSession.isEditing);
}
function renderEditingStatus(){
  const status = document.getElementById("editingStatus");
  if(status){
    const dirty = editingHasUnsavedChanges();
    status.textContent = editingStatusText();
    status.className = `pill ${dirty ? "warn" : "ok"}`;
  }
  const state = document.getElementById("editingStateSummary");
  const undo = document.getElementById("undoEdit"), redo = document.getElementById("redoEdit");
  if(undo) undo.disabled = !canUndoEdit();
  if(redo) redo.disabled = !canRedoEdit();
  if(state){
    const changes = Object.values(editingSessionState().recordStates || {}).reduce((acc, value) => { acc[value] = (acc[value] || 0) + 1; return acc; }, {});
    state.innerHTML = "";
    state.appendChild(el("div",{class:"status-card kpi"},[el("div",{class:"num"},[editingSessionState().isEditing ? "Active" : "Not started"]), el("div",{class:"label"},["Editing Session"])]));
    state.appendChild(el("div",{class:"status-card kpi"},[el("div",{class:"num"},[String(changes.created || 0)]), el("div",{class:"label"},["Created records"])]));
    state.appendChild(el("div",{class:"status-card kpi"},[el("div",{class:"num"},[String(changes.modified || 0)]), el("div",{class:"label"},["Modified records"])]));
    state.appendChild(el("div",{class:"status-card kpi"},[el("div",{class:"num"},[String(changes.deleted || 0)]), el("div",{class:"label"},["Deleted records"])]));
  }
}

let editorSelectedPersonaID = "";
let personaEditorMode = "start"; // start, view, create-from-existing, edit-anyway
function isExistingActivePersona(persona){ return typeof isPersonaCurrentlyActive === "function" ? isPersonaCurrentlyActive(persona) : String(persona?.Status || "").toLowerCase() === "active"; }
function personaEditorReadOnly(persona){ return Boolean(persona && persona.PersonaID && isExistingActivePersona(persona) && personaEditorMode !== "edit-anyway"); }
function personaEditorRows(){
  const q = (document.getElementById("personaEditorSearch")?.value || "").toLowerCase().trim();
  return DB.personas.filter(p => !q || [p.PersonaID,p.PersonaName,p.FamilyGroup,p.PricingSet,p.Status].join(" ").toLowerCase().includes(q));
}
function personaEditorStateClass(p){
  if(String(p.Status || "").toLowerCase() === "deleted") return " deleted";
  const state = editingSessionState().recordStates?.[sheetRecordKey(SHEET_MAP.personas, p, 0)] || "";
  return state ? ` ${state}` : "";
}
function renderPersonaEditor(){
  const list = document.getElementById("personaEditorList");
  const form = document.getElementById("personaEditorForm");
  if(!list || !form) return;
  const rows = personaEditorRows();
  list.innerHTML = "";
  rows.forEach(p => list.appendChild(el("button",{class:`persona-editor-row${p.PersonaID===editorSelectedPersonaID?" active":""}${personaEditorStateClass(p)}`, type:"button", "aria-pressed":String(p.PersonaID===editorSelectedPersonaID), onclick:()=>{editorSelectedPersonaID=p.PersonaID; personaEditorMode = personaEditorMode === "create-from-existing" ? "create-from-existing" : "view"; renderPersonaEditor();}},[
    p.PersonaID===editorSelectedPersonaID ? el("span",{class:"selected-marker", "aria-hidden":"true"},["✓ Selected"]) : null,
    el("strong",{},[p.PersonaName || "Untitled"]),
    el("span",{class:"persona-row-meta"},[p.PersonaID || "No ID", el("span",{class:"lifecycle-badge"},[typeof personaLifecycleStatus === "function" ? personaLifecycleStatus(p) : (p.Status || "No status")])])
  ])));
  document.getElementById("personaEditorCount").textContent = `${rows.length} persona${rows.length===1?"":"s"}`;
  updatePersonaEditorActionState();
  if(personaEditorMode === "start") renderPersonaStartPanel();
  else renderPersonaEditorForm(DB.personas.find(p => p.PersonaID === editorSelectedPersonaID) || null);
}

function updatePersonaEditorActionState(){
  const selected = DB.personas.find(p => p.PersonaID === editorSelectedPersonaID);
  const hasSelection = Boolean(selected);
  ["personaCreateUpdatedVersion", "personaDuplicate", "personaDeactivate", "personaMarkDeleted", "personaEditAnyway"].forEach(id => { const node = document.getElementById(id); if(node) node.disabled = !hasSelection; });
  const editAnyway = document.getElementById("personaEditAnyway");
  if(editAnyway) editAnyway.disabled = !hasSelection || !isExistingActivePersona(selected);
}
function renderPersonaStartPanel(){
  const form = document.getElementById("personaEditorForm");
  form.innerHTML = "";
  form.dataset.originalPersonaId = "";
  form.appendChild(emptyState("Choose a persona management action.", "Create a blank draft, create from an existing persona, or view existing personas read-only first."));
  updatePersonaEditorSaveState("Saved");
  const save = document.getElementById("personaEditorSave");
  const cancel = document.getElementById("personaEditorCancel");
  const schedule = document.getElementById("personaEditorSchedule");
  if(save) save.disabled = true;
  if(cancel) cancel.textContent = "Cancel";
  if(schedule) schedule.disabled = true;
  renderSpeedOptionEditor();
  renderPersonaModifierEditor();
}
function startPersonaViewExisting(){ personaEditorMode = "view"; editorSelectedPersonaID = ""; renderPersonaEditor(); }
function startPersonaCreateFromExisting(){ personaEditorMode = "create-from-existing"; editorSelectedPersonaID = ""; renderPersonaEditor(); }
const PERSONA_FIELD_LABELS = {
  PersonaID: "Persona ID",
  PersonaName: "Persona Name",
  FamilyGroup: "Family Group",
  FamilyGroupID: "Family Group ID",
  PricingSet: "Pricing Set",
  PricingSetID: "Pricing Set ID",
  PromoIcon: "Promotion Icon",
  EquipInc: "Equipment Included",
  SymSpeed: "Symmetrical Speed",
  Fiber: "Fiber",
  DisclaimerID: "Disclaimer",
  ModifiedBy: "Modified By",
  ModifiedDate: "Modified Date",
  EffectiveStartDate: "Effective Start Date",
  EffectiveEndDate: "Effective End Date",
  SupersedesPersonaID: "Supersedes PersonaID",
  LifecycleStatusOverride: "Lifecycle Override"
};
const PERSONA_FIELD_HELP = {
  FamilyGroup: "Choose the product family this persona belongs to.",
  PricingSet: "Choose the offer or promotion pricing group for this persona.",
  PromoIcon: "Optional image filename used as the promotional badge for this persona.",
  DisclaimerID: "Choose the legal disclaimer that should appear with this persona.",
  EffectiveStartDate: "Browser-local calendar date only, formatted YYYY-MM-DD. Blank means active immediately for legacy active records.",
  EffectiveEndDate: "YYYY-MM-DD. Blank means effective indefinitely until ended, deactivated, or superseded.",
  SupersedesPersonaID: "Set by Create Updated Version to link replacement records.",
  LifecycleStatusOverride: "Use Inactive only for manual deactivation."
};
const PERSONA_EDITOR_SECTIONS = [
  {title:"Identity & Publication", fields:["PersonaName", "Status", "EffectiveStartDate", "EffectiveEndDate", "FamilyGroup", "PricingSet"]},
  {title:"Features", fields:["EquipInc", "SymSpeed", "Fiber"]},
  {title:"Promotion", fields:["PromoIcon"]},
  {title:"Legal", fields:["DisclaimerID"]},
  {title:"Notes", fields:["Notes"]},
  {title:"System Information", collapsed:true, fields:["PersonaID", "FamilyGroupID", "PricingSetID", "DisclaimerID", "SupersedesPersonaID", "ModifiedBy", "ModifiedDate"]}
];
function personaFieldLabel(name){
  return PERSONA_FIELD_LABELS[name] || name;
}
function sheetRows(sheetName){
  return Array.isArray(DB.raw?.[sheetName]) ? DB.raw[sheetName] : [];
}
function currentFamilyGroups(){
  const rows = sheetRows("02_FamilyGroups");
  const mapped = rows.map(row => ({label:row.FamilyGroup || "", id:row.FamilyGroupID || ""})).filter(row => row.label || row.id);
  return mapped.length ? mapped : getUnique(DB.personas, "FamilyGroup").map(label => ({label, id:DB.personas.find(p => p.FamilyGroup === label)?.FamilyGroupID || ""}));
}
function currentPricingSets(){
  const rows = sheetRows("03_PricingSets");
  const mapped = rows.map(row => ({label:row.PricingSet || "", id:row.PricingSetID || ""})).filter(row => row.label || row.id);
  return mapped.length ? mapped : getUnique(DB.personas, "PricingSet").map(label => ({label, id:DB.personas.find(p => p.PricingSet === label)?.PricingSetID || ""}));
}
function formatPersonaDateTime(value){
  if(value === null || value === undefined || value === "") return "";
  let date = null;
  if(typeof value === "number"){
    date = new Date(Math.round((value - 25569) * 86400 * 1000));
  }else{
    const parsed = new Date(value);
    if(!Number.isNaN(parsed.getTime())) date = parsed;
  }
  return date ? date.toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"}) : String(value);
}
function personaChoiceField(name, value, errors={}){
  const id = `personaEdit-${name}`;
  const isFamily = name === "FamilyGroup";
  const baseChoices = isFamily ? currentFamilyGroups() : currentPricingSets();
  const choices = value && !baseChoices.some(choice => choice.label === value) ? [{label:value, id:""}, ...baseChoices] : baseChoices;
  const idField = isFamily ? "FamilyGroupID" : "PricingSetID";
  const select = el("select",{
    id,
    name,
    onchange:event=>{
      const selected = choices.find(choice => choice.label === event.currentTarget.value) || {};
      const idInput = document.getElementById(`personaEdit-${idField}`);
      if(idInput) idInput.value = selected.id || "";
      updatePersonaEditorSaveState("Unsaved Changes");
    }
  },[
    el("option",{value:""},["Choose…"]),
    ...choices.map(choice => el("option",{"value":choice.label, "data-related-id":choice.id, selected:choice.label === value},[choice.label || choice.id]))
  ]);
  return personaFieldWrapper(name, select, errors);
}
function personaFieldWrapper(name, input, errors={}){
  const required = PERSONA_REQUIRED_FIELDS.includes(name);
  const help = PERSONA_FIELD_HELP[name];
  const label = personaFieldLabel(name);
  if(help) input.setAttribute("aria-describedby", `personaHelp-${name}`);
  return el("label",{class:`editor-field ${errors[name]?"invalid":""}`},[
    el("span",{},[label, required ? el("b",{title:"Required"},[" *"]) : null]), input,
    help ? el("small",{id:`personaHelp-${name}`, class:"editor-help", title:help},[help]) : null,
    errors[name] ? el("em",{},[errors[name]]) : null
  ]);
}
function editorField(name, value, errors={}, readonlyForm=false){
  const id = `personaEdit-${name}`;
  if(["EffectiveStartDate", "EffectiveEndDate"].includes(name)) return personaFieldWrapper(name, el("input",{id, name, type:"date", value:value ?? "", readonly:readonlyForm}), errors);
  if(name === "LifecycleStatusOverride") return personaFieldWrapper(name, el("select",{id, name, disabled:readonlyForm},[el("option",{value:"", selected:!value},["None"]), el("option",{value:"Inactive", selected:value === "Inactive"},["Inactive"])]), errors);
  if(name === "FamilyGroup" || name === "PricingSet") return personaChoiceField(name, value, errors);
  if(name === "PromoIcon") return personaFieldWrapper(name, el("div",{id:"promotionIconPicker", class:"promotion-icon-picker"},[]), errors);
  if(name === "DisclaimerID"){
    const current = DB.disclaimers.find(d => d.DisclaimerID === value);
    const listId = "personaDisclaimerChoices";
    const input = el("input",{id, name, list:listId, value:value || "", placeholder:"Search by title or ID", readonly:readonlyForm});
    const preview = el("details",{class:"disclaimer-inline-preview"},[
      el("summary",{},["Preview disclaimer"]),
      el("p",{},[current?.DisclaimerText || "Choose a disclaimer to preview legal copy."])
    ]);
    const datalist = el("datalist",{id:listId},DB.disclaimers.map(d => el("option",{value:d.DisclaimerID, label:d.Title ? `${d.Title} (${d.DisclaimerID})` : d.DisclaimerID},[])));
    return personaFieldWrapper(name, el("div",{class:"disclaimer-picker"},[input, datalist, preview]), errors);
  }
  let readonly = ["FamilyGroupID", "PricingSetID", "ModifiedBy"].includes(name);
  if(name === "PersonaID") readonly = Boolean(document.getElementById("personaEditorForm")?.dataset.originalPersonaId);
  if(name === "ModifiedDate"){
    return personaFieldWrapper(name, el("span",{class:"readonly-field"},[
      el("input",{type:"hidden", name, value:value ?? ""}),
      formatPersonaDateTime(value) || "Not saved yet"
    ]), errors);
  }
  const input = ["Notes"].includes(name) ? el("textarea",{id, name, rows:"4", placeholder:"Internal notes"},[value || ""]) :
    ["EquipInc","SymSpeed","Fiber"].includes(name) ? el("input",{id, name, type:"checkbox", value:"TRUE", checked:truthy(value), disabled:readonlyForm}) :
    el("input",{id, name, value:value ?? "", readonly: readonly || readonlyForm});
  return personaFieldWrapper(name, input, errors);
}

function availablePromotionIcons(){
  const byFile = new Map();
  DB.icons.forEach(icon => {
    const file = normalizeIconFile(icon.FileName);
    if(file) byFile.set(file, {...icon, FileName:file, ResolvedPath:resolveIconPath(file)});
  });
  if(typeof AssetManager !== "undefined") AssetManager.staged.filter(asset => asset.category === "Promotion Icons").forEach(asset => byFile.set(normalizeIconFile(asset.filename), {IconID:asset.stagedId, IconName:asset.displayName || asset.filename, FileName:asset.filename, ResolvedPath:assetDataUrl(asset)}));
  return [...byFile.values()].sort((a,b)=>String(a.FileName).localeCompare(String(b.FileName)));
}
function closePromotionIconPicker(){
  document.querySelectorAll(".promotion-icon-chooser").forEach(node => node.hidden = true);
}
function choosePromotionIcon(file){
  const input = document.getElementById("personaEdit-PromoIcon");
  if(!input) return;
  input.value = normalizeIconFile(file);
  updatePersonaEditorSaveState("Unsaved Changes");
  renderPromotionIconField(input.value);
}
function renderPromotionIconField(value=""){
  const root = document.getElementById("promotionIconPicker");
  if(!root) return;
  const normalized = normalizeIconFile(value);
  root.innerHTML = "";
  const selectedIcon = availablePromotionIcons().find(icon => normalizeIconFile(icon.FileName) === normalized);
  const currentPath = normalized && selectedIcon ? resolveIconPath(normalized) : "";
  const hidden = el("input",{type:"hidden", id:"personaEdit-PromoIcon", name:"PromoIcon", value:normalized});
  const current = el("div",{class:"promotion-icon-current"},[
    iconSlot(currentPath, normalized ? `Promotion icon ${normalized}` : "No promotion icon selected", {type:"Persona", id:document.getElementById("personaEditorForm")?.dataset.originalPersonaId || "draft", file:normalized}),
    el("div",{},[el("strong",{},[normalized ? (selectedIcon?.IconName || "Missing icon") : "No icon selected"]), el("span",{class:"muted"},[normalized || "Choose an icon from assets/icons/"])])
  ]);
  const chooserId = "promotionIconChooser";
  const searchId = "promotionIconSearch";
  const gridId = "promotionIconGrid";
  const chooser = el("div",{id:chooserId, class:"promotion-icon-chooser", hidden:true},[
    el("div",{class:"promotion-icon-chooser__head"},[
      el("label",{for:searchId},["Search icon filenames"]),
      el("button",{type:"button", class:"btn small", onclick:closePromotionIconPicker},["Close"])
    ]),
    el("input",{id:searchId, class:"search", type:"search", placeholder:"Search assets/icons/ filenames", "aria-controls":gridId, oninput:event=>renderPromotionIconGrid(event.currentTarget.value, normalized), onkeydown:event=>{ if(event.key === "Escape") closePromotionIconPicker(); }}),
    el("div",{id:gridId, class:"promotion-icon-grid", role:"listbox", "aria-label":"Available promotion icons from assets/icons"}),
    el("div",{class:"promotion-icon-upload"},[el("button",{type:"button", class:"btn small", onclick:()=>{ setView("admin"); setAdminSection("assets", {focus:true}); }},["Upload New in Asset Manager"])])
  ]);
  const actions = el("div",{class:"promotion-icon-actions"},[
    el("button",{type:"button", class:"btn", "aria-expanded":"false", "aria-controls":chooserId, onclick:event=>{ const open = chooser.hidden; closePromotionIconPicker(); chooser.hidden = !open; event.currentTarget.setAttribute("aria-expanded", String(open)); if(open){ renderPromotionIconGrid("", normalized); setTimeout(()=>document.getElementById(searchId)?.focus(), 0); }}},["Choose Icon"]),
    el("button",{type:"button", class:"btn", onclick:()=>{ setView("admin"); setAdminSection("assets", {focus:true}); }},["Upload New"]),
    el("button",{type:"button", class:"btn small", onclick:()=>choosePromotionIcon("")},["Remove"])
  ]);
  root.append(hidden, current, actions, chooser);
  renderPromotionIconGrid("", normalized);
}
function renderPromotionIconGrid(query="", selected=""){
  const grid = document.getElementById("promotionIconGrid");
  if(!grid) return;
  const q = String(query || "").toLowerCase().trim();
  const selectedFile = normalizeIconFile(selected || document.getElementById("personaEdit-PromoIcon")?.value);
  const icons = availablePromotionIcons().filter(icon => !q || [icon.FileName, icon.IconName, icon.IconID].join(" ").toLowerCase().includes(q));
  grid.innerHTML = "";
  if(!icons.length){ grid.appendChild(el("p",{class:"muted"},["No matching icons found."])); return; }
  icons.forEach((icon, index) => {
    const file = normalizeIconFile(icon.FileName);
    const selectedState = file === selectedFile;
    grid.appendChild(el("button",{type:"button", class:`promotion-icon-option${selectedState ? " selected" : ""}`, role:"option", "aria-selected":String(selectedState), "aria-label":`Choose promotion icon ${file}`, onclick:()=>choosePromotionIcon(file), onkeydown:event=>{
      const options = [...grid.querySelectorAll(".promotion-icon-option")];
      const current = options.indexOf(event.currentTarget);
      const cols = 4;
      let next = current;
      if(event.key === "ArrowRight") next = Math.min(options.length - 1, current + 1);
      else if(event.key === "ArrowLeft") next = Math.max(0, current - 1);
      else if(event.key === "ArrowDown") next = Math.min(options.length - 1, current + cols);
      else if(event.key === "ArrowUp") next = Math.max(0, current - cols);
      else if(event.key === "Home") next = 0;
      else if(event.key === "End") next = options.length - 1;
      else return;
      event.preventDefault(); options[next]?.focus();
    }},[
      iconSlot(icon.ResolvedPath, icon.IconName || file, {type:"PromotionIconPicker", id:icon.IconID, name:icon.IconName, file}),
      el("span",{},[file])
    ]));
  });
}

function updatePersonaEditorSaveState(text){
  const indicator = document.getElementById("personaEditorSaveState");
  if(indicator){
    const label = text || (editingHasUnsavedChanges() ? "Unsaved Changes" : "Saved");
    indicator.textContent = label;
    indicator.className = `pill ${label === "Unsaved Changes" ? "warn" : "ok"}`;
  }
}
function renderPersonaEditorForm(persona, errors={}){
  const form = document.getElementById("personaEditorForm");
  form.innerHTML = "";
  if(!persona){ form.appendChild(emptyState(personaEditorMode === "create-from-existing" ? "Choose a source persona to duplicate." : "Select a persona to view it read-only.")); return; }
  if(personaEditorMode === "create-from-existing"){ duplicateSelectedPersonaEditor(); return; }
  const readonlyForm = personaEditorReadOnly(persona);
  const counts = personaRelationships(persona.PersonaID);
  form.dataset.originalPersonaId = DB.personas.some(row => row.PersonaID === persona.PersonaID) ? (persona.PersonaID || "") : "";
  if(editorSelectedPersonaID){
    form.appendChild(el("div",{class:"editor-mode-banner"},[readonlyForm ? "Read-only active record. Create an updated version before changing published content." : "Editable draft or explicitly unlocked record."]));
  }
  form.appendChild(el("div",{class:"lifecycle-summary", role:"status", "aria-live":"polite"},[
    el("strong",{},["Derived lifecycle status: "]),
    el("span",{class:"lifecycle-badge"},[typeof personaLifecycleStatus === "function" ? personaLifecycleStatus(persona) : (persona.Status || "No status")]),
    el("small",{class:"editor-help"},[" Calculated from browser-local Effective Start/End dates and Lifecycle Override. It is not directly editable."])
  ]));
  PERSONA_EDITOR_SECTIONS.forEach(section => {
    const content = [];
    section.fields.forEach(field => {
      if(section.title === "System Information" && field === "DisclaimerID"){
        content.push(personaFieldWrapper(field, el("span",{class:"readonly-field"},[persona[field] || "Not set"]), errors));
      }else{
        content.push(editorField(field, persona[field], errors, readonlyForm));
      }
    });
    if(section.title === "System Information") content.push(el("div",{class:"editor-related-counts system-counts"},[
      el("span",{},[`Speeds: ${counts.speeds}`]), el("span",{},[`Modifiers: ${counts.modifiers}`]), el("span",{},[`Disclaimer links: ${counts.disclaimers}`])
    ]));
    const sectionNode = section.collapsed
      ? el("details",{class:"persona-editor-section", open:false},[el("summary",{},[section.title]), ...content])
      : el("fieldset",{class:`persona-editor-section ${section.title === "Features" ? "features-section" : ""}`},[el("legend",{},[section.title]), ...content]);
    form.appendChild(sectionNode);
  });
  form.addEventListener("input", () => updatePersonaEditorSaveState("Unsaved Changes"), {once:true});
  form.addEventListener("change", () => updatePersonaEditorSaveState("Unsaved Changes"), {once:true});
  if(readonlyForm){ form.querySelectorAll("select, textarea, button").forEach(node => { if(node.type !== "hidden") node.disabled = true; }); }
  renderPromotionIconField(persona.PromoIcon);
  if(readonlyForm){ document.getElementById("promotionIconPicker")?.querySelectorAll("button").forEach(node => node.disabled = true); }
  const save = document.getElementById("personaEditorSave");
  const cancel = document.getElementById("personaEditorCancel");
  const schedule = document.getElementById("personaEditorSchedule");
  const isNewDraft = !form.dataset.originalPersonaId || personaEditorMode === "create-new";
  if(save){ save.disabled = readonlyForm; save.textContent = isNewDraft ? "Save Draft" : "Save Changes"; }
  if(cancel){ cancel.disabled = false; cancel.textContent = isNewDraft ? "Cancel" : "Discard Changes"; }
  if(schedule){ schedule.disabled = readonlyForm; schedule.textContent = isNewDraft ? "Schedule Persona" : "Schedule/Update Schedule"; }
  if(readonlyForm){
    if(cancel) cancel.textContent = "Create Updated Version";
    if(cancel) cancel.onclick = createUpdatedVersionPersonaEditor;
    if(schedule){ schedule.textContent = "More Actions"; schedule.disabled = false; schedule.onclick = () => document.getElementById("personaMoreActions")?.setAttribute("open", ""); }
  }else{
    if(cancel) cancel.onclick = startPersonaViewExisting;
    if(schedule) schedule.onclick = savePersonaEditor;
  }
  updatePersonaEditorSaveState();
  renderSpeedOptionEditor();
  renderPersonaModifierEditor();
}
function personaEditorDraft(){
  const form = document.getElementById("personaEditorForm");
  const draft = {};
  PERSONA_EDITOR_FIELDS.forEach(field => {
    const control = form.elements[field];
    draft[field] = control?.type === "checkbox" ? (control.checked ? "TRUE" : "FALSE") : (control?.value ?? "");
  });
  return draft;
}
function savePersonaEditor(){
  const form = document.getElementById("personaEditorForm");
  const original = form.dataset.originalPersonaId || "";
  const current = DB.personas.find(p => p.PersonaID === original);
  if(personaEditorReadOnly(current)){ alert("Active records are read-only by default. Create an updated version, or use More Actions > Edit Active Record Anyway after confirming the warning."); return; }
  const draft = personaEditorDraft();
  if(original && draft.PersonaID !== original && personaHasRelationships(original) && !window.confirm("This PersonaID has speed, modifier, or disclaimer relationships. Change it anyway?")) return;
  const validation = validatePersonaDraft(draft, original);
  if(!validation.valid){ renderPersonaEditorForm(draft, validation.errors); return; }
  const prospectiveRows = DB.personas.map(row => row.PersonaID === original ? draft : row);
  if(!original) prospectiveRows.push(draft);
  const lifecycleConflicts = validatePersonaLifecycleRecords(prospectiveRows).filter(record => String(record.Record || "").includes(draft.PersonaID));
  if(lifecycleConflicts.length && !window.confirm(`Lifecycle conflicts were found before save:\n\n${lifecycleConflicts.map(record => `- ${record.Reason}`).join("\n")}\n\nSave anyway?`)) return;
  const saved = savePersonaDraft(draft, original, "Browser Persona Editor");
  runDatabaseHealth();
  editorSelectedPersonaID = saved.PersonaID;
  renderAll();
  setAdminSection("health");
  setView("manage", {focus:false});
}
function createNewPersonaEditor(){
  startEditingSession();
  const id = nextSafePersonaID();
  personaEditorMode = "create-new";
  editorSelectedPersonaID = id;
  renderPersonaEditorForm({PersonaID:id, Status:"Draft", EquipInc:"FALSE", SymSpeed:"FALSE", Fiber:"FALSE"});
}
function duplicateSelectedPersonaEditor(){
  if(!editorSelectedPersonaID) return;
  const saved = duplicatePersona(editorSelectedPersonaID, "Browser Persona Editor");
  runDatabaseHealth();
  editorSelectedPersonaID = saved.PersonaID;
  personaEditorMode = "edit-anyway";
  renderAll();
}
function createUpdatedVersionPersonaEditor(){
  if(!editorSelectedPersonaID) return;
  const startDate = window.prompt("Replacement start date (YYYY-MM-DD). The source end date will be suggested as one day earlier.", currentPersonaDate());
  if(!startDate) return;
  try{
    const preview = createUpdatedPersonaVersion(editorSelectedPersonaID, startDate, false, "Browser Persona Editor");
    const message = [`Create updated version?`, ``, `Source ${preview.sourceBefore.PersonaID}: EffectiveEndDate ${preview.sourceBefore.EffectiveEndDate || "(blank)"} → ${preview.sourceAfter.EffectiveEndDate}`, `New ${preview.newDraft.PersonaID}: SupersedesPersonaID ${preview.newDraft.SupersedesPersonaID}, EffectiveStartDate ${preview.newDraft.EffectiveStartDate}`, ``, `No source changes will be saved unless you confirm.`].join("\n");
    if(!window.confirm(message)) return;
    const saved = createUpdatedPersonaVersion(editorSelectedPersonaID, startDate, true, "Browser Persona Editor");
    runDatabaseHealth(); editorSelectedPersonaID = saved.PersonaID; personaEditorMode = "edit-anyway"; renderAll();
  }catch(err){ alert(err.message); }
}
function editActivePersonaAnyway(){
  const selected = DB.personas.find(p => p.PersonaID === editorSelectedPersonaID);
  if(!selected || !isExistingActivePersona(selected)) return;
  if(!window.confirm("Editing an active record directly can change published content. Creating an updated version is recommended. Edit the active record anyway?")) return;
  personaEditorMode = "edit-anyway";
  renderPersonaEditor();
}
function statusSelectedPersonaEditor(status){
  if(!editorSelectedPersonaID) return;
  setPersonaStatus(editorSelectedPersonaID, status, "Browser Persona Editor");
  runDatabaseHealth();
  renderAll();
}
function deleteSelectedPersonaEditor(){
  if(!editorSelectedPersonaID) return;
  if(!window.confirm("Mark this persona as Deleted in the working copy? It will not be permanently removed.")) return;
  markPersonaDeleted(editorSelectedPersonaID, "Browser Persona Editor");
  runDatabaseHealth();
  renderAll();
}

let editorSelectedSpeedKey = "";
function selectedPersonaSpeedRows(){
  return DB.speedOptions
    .filter(row => row.PersonaID === editorSelectedPersonaID)
    .sort((a,b)=>Number(speedDisplayOrder(a)||0)-Number(speedDisplayOrder(b)||0));
}
function speedOptionStateClass(speed){
  const state = editingSessionState().recordStates?.[sheetRecordKey(SHEET_MAP.speedOptions, speed, 0)] || "";
  return `${truthy(speed.Active) ? "" : " inactive"}${state ? ` ${state}` : ""}`;
}
function renderSpeedOptionEditor(){
  const list = document.getElementById("speedOptionEditorList");
  const form = document.getElementById("speedOptionEditorForm");
  const count = document.getElementById("speedOptionEditorCount");
  if(!list || !form) return;
  const rows = selectedPersonaSpeedRows();
  if(!rows.some(row => speedOptionKey(row) === editorSelectedSpeedKey)) editorSelectedSpeedKey = rows[0] ? speedOptionKey(rows[0]) : "";
  if(count) count.textContent = `${rows.length} speed option${rows.length===1?"":"s"}`;
  list.innerHTML = "";
  if(!editorSelectedPersonaID){
    list.appendChild(emptyState("Select a persona first."));
  }else{
    rows.forEach(speed => {
      const resolution = scheduleResolutionForSpeed(speed);
      list.appendChild(el("button",{class:`persona-editor-row speed-option-row${speedOptionKey(speed)===editorSelectedSpeedKey?" active":""}${speedOptionStateClass(speed)}`, type:"button", onclick:()=>{editorSelectedSpeedKey=speedOptionKey(speed); renderSpeedOptionEditor();}},[
        el("strong",{},[`${speed.SpeedOption || "No option"} • ${speed.DisplaySpeed || "No speed"}`]),
        el("span",{},[`${speed.ReferenceID || "No ReferenceID"} • ${truthy(speed.Active) ? "Active" : "Inactive"} • ${resolution.resolves ? "Pricing resolved" : "Pricing missing"}`])
      ]));
    });
  }
  renderSpeedOptionEditorForm(DB.speedOptions.find(row => speedOptionKey(row) === editorSelectedSpeedKey) || null);
}
function speedOptionField(name, value, errors={}){
  const required = SPEED_OPTION_REQUIRED_FIELDS.includes(name);
  const id = `speedEdit-${name}`;
  const input = name === "Active" ? el("select",{id, name},[["TRUE","True"],["FALSE","False"]].map(([v,l])=>el("option",{value:v, selected:String(value).toUpperCase()===v},[l]))) :
    name === "PricingType" ? el("select",{id, name},[...new Set(["Step Pricing","Flat Pricing","3 Months Free","3 Year Price Lock", ...DB.speedOptions.map(row => row.PricingType).filter(Boolean)])].map(v=>el("option",{value:v, selected:String(value)===String(v)},[v]))) :
    el("input",{id, name, value:value ?? ""});
  return el("label",{class:`editor-field ${errors[name]?"invalid":""}`},[
    el("span",{},[name, required ? el("b",{title:"Required"},[" *"]) : null]), input,
    errors[name] ? el("em",{},[errors[name]]) : null
  ]);
}
function renderSpeedOptionEditorForm(speed, errors={}){
  const form = document.getElementById("speedOptionEditorForm");
  form.innerHTML = "";
  if(!editorSelectedPersonaID){ form.appendChild(emptyState("Select a persona to edit its speed options.")); return; }
  if(!speed){ form.appendChild(emptyState("Create or select a speed option.")); return; }
  const draft = {...speed, DisplayOrder:speedDisplayOrder(speed)};
  const resolution = scheduleResolutionForSpeed(draft);
  const persona = DB.personas.find(row => row.PersonaID === draft.PersonaID);
  form.dataset.originalSpeedKey = speedOptionKey(speed);
  form.dataset.originalScheduleId = speed.ScheduleID || "";
  form.appendChild(el("div",{class:"editor-related-counts"},[
    el("span",{class:resolution.resolves ? "" : "bad"},[`Schedule: ${resolution.resolves ? `${resolution.count} pricing rows` : "unresolved"}`]),
    el("span",{},[`Pricing: ${resolution.summary}`]),
    el("span",{},[`Symmetrical speeds: ${truthy(persona?.SymSpeed) ? "visible / enabled" : "hidden unless upload differs"}`])
  ]));
  SPEED_OPTION_FIELDS.forEach(field => form.appendChild(speedOptionField(field, draft[field], errors)));
}
function speedOptionEditorDraft(){
  const form = document.getElementById("speedOptionEditorForm");
  const draft = {};
  SPEED_OPTION_FIELDS.forEach(field => { draft[field] = form.elements[field]?.value ?? ""; });
  return draft;
}
function saveSpeedOptionEditor(){
  const form = document.getElementById("speedOptionEditorForm");
  const original = form.dataset.originalSpeedKey || "";
  const originalScheduleID = form.dataset.originalScheduleId || "";
  const draft = speedOptionEditorDraft();
  const beforeResolution = original ? scheduleResolutionForSpeed(DB.speedOptions.find(row => speedOptionKey(row) === original) || {}) : {resolves:false};
  const afterResolution = scheduleResolutionForSpeed(draft);
  if(originalScheduleID && draft.ScheduleID !== originalScheduleID && beforeResolution.resolves && !afterResolution.resolves && !window.confirm("Changing ScheduleID breaks the attached pricing relationship. Save anyway?")) return;
  const validation = validateSpeedOptionDraft(draft, original);
  if(!validation.valid){ renderSpeedOptionEditorForm({...draft}, validation.errors); return; }
  const saved = saveSpeedOptionDraft(draft, original);
  runDatabaseHealth();
  editorSelectedSpeedKey = speedOptionKey(saved);
  renderAll();
}
function createSpeedOptionEditor(){
  if(!editorSelectedPersonaID) return;
  startEditingSession();
  const option = nextSpeedOptionForPersona(editorSelectedPersonaID);
  const persona = DB.personas.find(row => row.PersonaID === editorSelectedPersonaID);
  editorSelectedSpeedKey = "";
  renderSpeedOptionEditorForm({PersonaID:editorSelectedPersonaID, SpeedOption:option, ReferenceID:`${editorSelectedPersonaID}-${option}`, DisplayOrder:selectedPersonaSpeedRows().length + 1, Active:"TRUE", PricingType:displayPricingSet(persona?.PricingSet || "Standard")});
}
function duplicateSelectedSpeedOptionEditor(){
  if(!editorSelectedSpeedKey) return;
  const saved = duplicateSpeedOption(editorSelectedSpeedKey);
  runDatabaseHealth();
  editorSelectedSpeedKey = speedOptionKey(saved);
  renderAll();
}
function activeSelectedSpeedOptionEditor(active){
  if(!editorSelectedSpeedKey) return;
  setSpeedOptionActive(editorSelectedSpeedKey, active);
  runDatabaseHealth();
  renderAll();
}
function removeSelectedSpeedOptionEditor(){
  if(!editorSelectedSpeedKey) return;
  if(!window.confirm("Remove this speed option from the working copy? Pricing rows are not deleted.")) return;
  removeSpeedOption(editorSelectedSpeedKey);
  runDatabaseHealth();
  editorSelectedSpeedKey = "";
  renderAll();
}
function moveSelectedSpeedOptionEditor(direction){
  if(!editorSelectedSpeedKey) return;
  moveSpeedOption(editorSelectedSpeedKey, direction);
  runDatabaseHealth();
  renderAll();
}



let editorSelectedScheduleID = "";
function pricingEditorRows(){
  return pricingRowsForSchedule(editorSelectedScheduleID);
}
function renderPricingScheduleEditor(){
  const select = document.getElementById("pricingScheduleSelect");
  const form = document.getElementById("pricingScheduleEditorForm");
  const usage = document.getElementById("pricingScheduleUsage");
  const preview = document.getElementById("pricingSchedulePreview");
  if(!select || !form) return;
  const ids = pricingScheduleIDs();
  if(!editorSelectedScheduleID && ids[0]) editorSelectedScheduleID = ids[0];
  select.innerHTML = "";
  ids.forEach(id => select.appendChild(el("option",{value:id, selected:id===editorSelectedScheduleID},[id])));
  renderPricingScheduleRowsForm(pricingEditorRows());
  renderPricingScheduleUsage(usage);
  renderPricingSchedulePreview(preview);
}
function pricingRowField(row, index, field){
  const id = `pricing-${index}-${field}`;
  const value = row[field] ?? "";
  const input = field === "DisplayAsFree" ? el("select",{id, name:field},[["FALSE","Paid"],["TRUE","Free"]].map(([v,l])=>el("option",{value:v, selected:String(value).toUpperCase()===v},[l]))) :
    el("input",{id, name:field, value, type:["Sequence","StartMonth","EndMonth","Price","StrikeThroughPrice"].includes(field)?"number":"text", step:["Price","StrikeThroughPrice"].includes(field)?"0.01":"1"});
  return el("label",{class:"editor-field"},[el("span",{},[field]), input]);
}
function renderPricingScheduleRowsForm(rows){
  const form = document.getElementById("pricingScheduleEditorForm");
  form.innerHTML = "";
  if(!editorSelectedScheduleID){ form.appendChild(emptyState("Select or create a ScheduleID.")); return; }
  rows.forEach((row,index)=>{
    const card = el("div",{class:"pricing-row-card", "data-index":String(index)},[
      el("div",{class:"pricing-row-head"},[
        el("strong",{},[`Row ${index + 1}: ${row.DisplayLabel || "Unlabeled"}`]),
        el("span",{class:"muted"},[`${row.ReferenceID || "No ReferenceID"} • ${truthy(row.DisplayAsFree) ? "Free" : money(row.Price)}`])
      ]),
      el("div",{class:"month-range-editor", role:"group", "aria-label":`Month range for row ${index + 1}`},Array.from({length:36},(_,i)=>{
        const month = i + 1;
        const active = month >= Number(row.StartMonth || 0) && month <= Number(row.EndMonth || 0);
        return el("button",{type:"button", class:`month-chip${active?" active":""}`, onclick:()=>{
          form.querySelector(`[data-index="${index}"] [name="StartMonth"]`).value = Math.min(Number(form.querySelector(`[data-index="${index}"] [name="StartMonth"]`).value || month), month);
          form.querySelector(`[data-index="${index}"] [name="EndMonth"]`).value = Math.max(Number(form.querySelector(`[data-index="${index}"] [name="EndMonth"]`).value || month), month);
          renderPricingSchedulePreview(document.getElementById("pricingSchedulePreview"));
        }},[String(month)]);
      })),
      el("div",{class:"pricing-row-fields"},PRICING_SCHEDULE_FIELDS.map(field => pricingRowField(row,index,field))),
      el("div",{class:"persona-editor-toolbar"},[
        el("button",{class:"btn", type:"button", onclick:()=>duplicatePricingEditorRow(index)},["Duplicate Row"]),
        el("button",{class:"btn", type:"button", onclick:()=>movePricingEditorRow(index,-1)},["Move Up"]),
        el("button",{class:"btn", type:"button", onclick:()=>movePricingEditorRow(index,1)},["Move Down"]),
        el("button",{class:"btn danger", type:"button", onclick:()=>removePricingEditorRow(index)},["Remove from Working Copy"])
      ])
    ]);
    form.appendChild(card);
  });
}
function pricingEditorDraftRows(){
  return [...document.querySelectorAll("#pricingScheduleEditorForm .pricing-row-card")].map(card => {
    const row = {};
    PRICING_SCHEDULE_FIELDS.forEach(field => { row[field] = card.querySelector(`[name="${field}"]`)?.value ?? ""; });
    return row;
  });
}
function renderPricingScheduleUsage(box){
  if(!box) return;
  const usage = personasUsingSchedule(editorSelectedScheduleID);
  box.innerHTML = "";
  box.appendChild(el("h4",{},["Personas / speeds using this schedule"]));
  if(!usage.length){ box.appendChild(el("p",{class:"muted"},["No current persona speed uses this ScheduleID."])); return; }
  box.appendChild(el("ul",{},usage.map(item => el("li",{},[`${item.PersonaName || item.PersonaID} — ${item.DisplaySpeed || item.SpeedOption} (${item.ReferenceID})${item.Active ? "" : " inactive"}`]))));
}
function renderPricingSchedulePreview(box){
  if(!box) return;
  const rows = pricingEditorDraftRows().length ? pricingEditorDraftRows() : pricingEditorRows();
  const analysis = scheduleEditorAnalysis(rows);
  box.innerHTML = "";
  box.appendChild(el("h4",{},["Automatic schedule preview"]));
  rows.sort((a,b)=>Number(a.Sequence||0)-Number(b.Sequence||0)).forEach(row => box.appendChild(el("div",{class:"pricing-preview-row"},[`${row.DisplayLabel || healthMonthLabel(row)}: ${truthy(row.DisplayAsFree) ? "FREE" : (row.Price === "" ? "No price entered" : money(row.Price))}${row.StrikeThroughPrice ? ` (strike ${bareMoney(row.StrikeThroughPrice)})` : ""}`])));
  (analysis.records.length ? analysis.records : [{message:"No overlapping ranges or invalid labels detected."}]).forEach(record => box.appendChild(el("p",{class:record.type ? "editor-warning" : "muted"},[record.message])));
}
function addPricingEditorRow(){
  const rows = pricingEditorDraftRows();
  const template = rows[rows.length - 1] || {ScheduleID:editorSelectedScheduleID, ReferenceID:"", Sequence:0, StartMonth:1, EndMonth:1, DisplayLabel:"Month 1", Price:"", DisplayAsFree:"FALSE", StrikeThroughPrice:""};
  rows.push({...template, Sequence:rows.length + 1, StartMonth:"", EndMonth:"", DisplayLabel:"", Price:"", StrikeThroughPrice:""});
  renderPricingScheduleRowsForm(rows);
}
function duplicatePricingEditorRow(index){ const rows = pricingEditorDraftRows(); rows.splice(index + 1, 0, {...rows[index], Sequence:index + 2}); rows.forEach((row,i)=>row.Sequence=i+1); renderPricingScheduleRowsForm(rows); }
function movePricingEditorRow(index, direction){ const rows = pricingEditorDraftRows(); const swap = index + direction; if(swap < 0 || swap >= rows.length) return; [rows[index], rows[swap]] = [rows[swap], rows[index]]; rows.forEach((row,i)=>row.Sequence=i+1); renderPricingScheduleRowsForm(rows); }
function removePricingEditorRow(index){ if(!window.confirm("Remove this pricing row from the working copy?")) return; const rows = pricingEditorDraftRows(); rows.splice(index,1); rows.forEach((row,i)=>row.Sequence=i+1); renderPricingScheduleRowsForm(rows); }
function createPricingScheduleEditor(){
  const id = window.prompt("New ScheduleID");
  if(!id) return;
  if(pricingScheduleIDs().includes(id)){ alert("ScheduleID already exists."); return; }
  startEditingSession();
  editorSelectedScheduleID = id;
  renderPricingScheduleRowsForm([{ScheduleID:id, ReferenceID:"", Sequence:1, StartMonth:1, EndMonth:36, DisplayLabel:"36 Months", Price:"", DisplayAsFree:"FALSE", StrikeThroughPrice:""}]);
  renderPricingScheduleUsage(document.getElementById("pricingScheduleUsage"));
  renderPricingSchedulePreview(document.getElementById("pricingSchedulePreview"));
}
function savePricingScheduleEditor(){
  const rows = pricingEditorDraftRows();
  const type = document.getElementById("pricingStructureType")?.value || "";
  const validation = validatePricingScheduleRows(rows, {scheduleID:editorSelectedScheduleID, isNew:!pricingScheduleIDs().includes(editorSelectedScheduleID), pricingType:type});
  if(!validation.valid){ alert(Object.entries(validation.errors).map(([field,msg]) => `${field}: ${msg}`).join("\n")); renderPricingSchedulePreview(document.getElementById("pricingSchedulePreview")); return; }
  savePricingScheduleRows(editorSelectedScheduleID, rows, {isNew:!pricingScheduleIDs().includes(editorSelectedScheduleID), pricingType:type});
  runDatabaseHealth();
  renderAll();
  setAdminSection("health");
}

function appVersion(){
  return "Personaville v1.0";
}
function formattedLastBuild(){
  if(!DB.lastBuildAt) return "Not available";
  const parsed = new Date(DB.lastBuildAt);
  if(!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
  return DB.lastBuildAt;
}
function renderSourceBanner(){
  const box = document.getElementById("sourceBanner");
  if(!box) return;
  const source = DB.loadedFromWorkbook ? "Uploaded Workbook" : "Bundled JSON";
  box.className = `source-banner ${DB.loadedFromWorkbook ? "workbook" : "bundled"}`;
  box.innerHTML = "";
  box.appendChild(el("span",{class:"source-dot"},["●"]));
  box.appendChild(el("strong",{},[`Using ${source}`]));
  box.appendChild(el("span",{},[` • ${DB.sourceFilename || "No database loaded"}`]));
}
function healthReady(){
  return currentBuildSummary().healthErrors === 0;
}
function renderPublishPanel(){
  const box = document.getElementById("publishPanel");
  if(!box) return;
  const built = Boolean(DB.personas.length || DB.speedOptions.length || DB.loadedFromWorkbook);
  const downloaded = !document.getElementById("downloadInstructions")?.hidden;
  const ready = built && healthReady();
  const steps = [
    ["Upload Workbook", DB.loadedFromWorkbook],
    ["Load workbook into browser memory", DB.loadedFromWorkbook],
    ["Review Database Health", databaseHealthReviewed()],
    ["Download v2 Publishing Package", downloaded],
    ["Replace database/persona-db.json in GitHub", downloaded],
    ["GitHub Pages publishes automatically", downloaded]
  ];
  box.innerHTML = "";
  box.appendChild(el("div",{class:"publish-head"},[
    el("div",{},[el("h3",{},["Publish Workflow"]), el("p",{class:"muted"},["Follow these steps after updating the workbook."])]),
    el("div",{class:`publish-ready ${ready ? "ok" : "warn"}`},[ready ? "✔ Ready to Publish" : "⚠ Resolve Database Health issues before publishing."])
  ]));
  box.appendChild(el("ol",{class:"publish-steps"},steps.map(([label, done]) => el("li",{class:done ? "done" : ""},[
    el("span",{class:"step-check"},[done ? "✓" : ""]),
    el("span",{},[label])
  ]))));
}
function renderBuildSummary(){
  const box = document.getElementById("buildSummary");
  if(!box) return;
  if(!DB.loadedFromWorkbook){
    box.hidden = true;
    box.innerHTML = "";
    const instructions = document.getElementById("downloadInstructions");
    if(instructions) instructions.hidden = true;
    return;
  }
  const summary = currentBuildSummary();
  box.hidden = false;
  box.innerHTML = "";
  box.appendChild(el("div",{class:"build-summary-title"},["Upload Workbook completed successfully"]));
  box.appendChild(el("div",{class:"build-summary-grid"},[
    summaryMetric("personas", summary.personas),
    summaryMetric("speed options", summary.speedOptions),
    summaryMetric("pricing schedules", summary.pricingSchedules),
    summaryMetric("disclaimers", summary.disclaimers),
    summaryMetric("modifiers", summary.modifiers),
    summaryMetric("icons", summary.icons),
    summaryMetric("health errors", summary.healthErrors, summary.healthErrors ? "bad" : "ok"),
    summaryMetric("health warnings", summary.healthWarnings, summary.healthWarnings ? "warn" : "ok")
  ]));
}
function summaryMetric(label, value, status=""){
  return el("div",{class:`summary-metric ${status}`},[
    el("div",{class:"summary-value"},[String(value)]),
    el("div",{class:"summary-label"},[label])
  ]);
}
function renderKpis(){
  const summary = currentBuildSummary();
  const healthText = `${summary.healthOk} OK • ${summary.healthWarnings} Warnings • ${summary.healthErrors} Errors`;
  const kpis = [
    ["Current Personaville Version", appVersion()],
    ["Database Filename", DB.sourceFilename || "No database loaded"],
    ["Last Build", formattedLastBuild()],
    ["Personas", DB.personas.length],
    ["Speed Options", DB.speedOptions.length],
    ["Pricing Schedule Rows", DB.schedules.length],
    ["Modifiers", DB.modifiers.length],
    ["Disclaimers", DB.disclaimers.length],
    ["Icons", DB.icons.length],
    ["Database Health", healthText]
  ];
  const box = document.getElementById("kpis");
  box.innerHTML="";
  kpis.forEach(([label,value]) => box.appendChild(el("div",{class:"kpi status-card"},[
    el("div",{class:"num"},[String(value)]),
    el("div",{class:"label"},[label])
  ])));
}
function fillFilters(){
  const pricingBox = document.getElementById("pricingFilter");
  const familyBox = document.getElementById("familyFilter");
  const currentPricing = selectedPricingFilter();
  const currentFamilies = selectedFamilyFilters();
  if(pricingBox){
    pricingBox.innerHTML="";
    ["All", "Standard", "3 Months Free", "3 Year Price Lock"].forEach((label, index) => {
      const value = index === 0 ? "" : label;
      const id = `pricingFilter-${index}`;
      pricingBox.appendChild(el("label",{class:"choice-pill"},[
        el("input",{type:"radio", name:"pricingFilter", id, value, checked:value === currentPricing}),
        el("span",{},[label])
      ]));
    });
  }
  if(familyBox){
    familyBox.innerHTML="";
    familyBox.appendChild(el("button",{class:"choice-pill family-choice family-clear-choice", type:"button", onclick:clearFamilyGroupFilter},[
      el("span",{},["All Family Groups"])
    ]));
    getUnique(DB.personas,"FamilyGroup").forEach((family, index)=>{
      const id = `familyFilter-${index}`;
      familyBox.appendChild(el("label",{class:"choice-pill family-choice"},[
        el("input",{type:"checkbox", id, value:family, checked:currentFamilies.includes(family)}),
        el("span",{},[family])
      ]));
    });
  }
  updateFilterSummary();
}
function selectedPricingFilter(){
  return document.querySelector('input[name="pricingFilter"]:checked')?.value || "";
}
function selectedFamilyFilters(){
  return [...document.querySelectorAll('#familyFilter input[type="checkbox"]:checked')].map(input=>input.value);
}
function selectedLifecycleFilter(){ return document.getElementById("lifecycleFilter")?.value || "Active"; }
function personaFiltersActive(){
  const query = document.getElementById("globalSearch")?.value || "";
  const families = selectedFamilyFilters();
  const pricing = selectedPricingFilter();
  const lifecycle = selectedLifecycleFilter();
  return Boolean(query.trim() || families.length || pricing || lifecycle);
}
function visiblePersonas(){
  const query = document.getElementById("globalSearch")?.value || "";
  const families = selectedFamilyFilters();
  const pricing = selectedPricingFilter();
  if(!personaFiltersActive()) return [];
  const lifecycle = selectedLifecycleFilter();
  const rows = searchPersonas(query, families, pricing);
  return lifecycle === "all" ? rows : rows.filter(p => personaLifecycleStatus(p) === lifecycle);
}
function updateFilterSummary(){
  const summary = document.getElementById("activeFilterSummary");
  if(!summary) return;
  const query = (document.getElementById("globalSearch")?.value || "").trim();
  const pricing = selectedPricingFilter();
  const families = selectedFamilyFilters();
  const lifecycle = selectedLifecycleFilter();
  const parts = [];
  if(lifecycle && lifecycle !== "all") parts.push(`Lifecycle: ${lifecycle}`);
  if(pricing) parts.push(`Pricing: ${pricing}`);
  if(families.length) parts.push(`Families: ${families.join(", ")}`);
  if(query) parts.push(`Search: “${query}”`);
  summary.textContent = parts.length ? parts.join(" • ") : "No filters applied";
}
function resetPersonaDetail(){
  selectedPersona=null;
  const p=document.getElementById("detailPanel");
  if(!p) return;
  p.className="detail empty";
  p.innerHTML="";
  p.appendChild(emptyState("Select a persona to view details."));
}
function clearFamilyGroupFilter(){
  document.querySelectorAll('#familyFilter input[type="checkbox"]').forEach(input => { input.checked = false; });
  renderTiles();
}
function clearPersonaFilters(){
  const search = document.getElementById("globalSearch");
  if(search) search.value = "";
  document.querySelectorAll('#familyFilter input[type="checkbox"]').forEach(input => { input.checked = false; });
  const allPricing = document.querySelector('input[name="pricingFilter"][value=""]');
  if(allPricing) allPricing.checked = true;
  resetPersonaDetail();
  renderTiles();
}
function renderTiles(){
  const active = personaFiltersActive();
  const personas = visiblePersonas();
  const count = document.getElementById("personaResultCount");
  if(count) count.textContent = personas.length ? `${personas.length} persona${personas.length === 1 ? "" : "s"} found` : "No personas found";
  updateFilterSummary();
  const d2 = document.getElementById("personaTiles");
  [d2].forEach(box => {
    if(!box) return;
    box.innerHTML="";
    if(!active){
      box.appendChild(emptyState("Search or choose a filter to view personas.", "Use Pricing Set, Family Group, or Search to narrow the library."));
      return;
    }
    if(!personas.length){
      const empty = emptyState("No personas match the current filters.");
      empty.appendChild(el("button",{class:"btn small empty-action", type:"button", onclick:clearPersonaFilters},["Clear Filters"]));
      box.appendChild(empty);
      return;
    }
    personas.forEach(p => box.appendChild(personaTile(p)));
  });
}
function emptyState(title, message){
  return el("div",{class:"empty-state-panel", role:"status"},[
    el("strong",{},[title]),
    message ? el("p",{class:"muted"},[message]) : null
  ]);
}
function personaTile(p){
  const checked = exportSelection.has(p.PersonaID);
  const chips=[];
  if(truthy(p.EquipInc)) chips.push(el("span",{class:"chip feature"},["✓ Equip Inc"]));
  if(truthy(p.SymSpeed)) chips.push(el("span",{class:"chip feature"},["✓ Sym Speed"]));
  if(truthy(p.Fiber)) chips.push(el("span",{class:"chip feature"},["✓ Fiber"]));
  (p.modifiers||[]).forEach(m => chips.push(modifierChip(m)));
  const rows = (p.speeds||[]).map(s => el("tr",{},[
    el("td",{class:"so", "aria-label":s.SpeedOption || "Speed option"},[compactSpeedOptionMarker()]),
    el("td",{},[s.DisplaySpeed || ""]),
    el("td",{class:"price schedule-summary"},[pricingSummaryNode(s)]),
    el("td",{},[money(s.RegularRate)])
  ]));
  return el("article",{
    class:`tile ${checked ? "selected" : ""}`,
    "data-persona-id":p.PersonaID,
    role:"button",
    tabindex:"0",
    "aria-label":`View details for ${p.PersonaName || "persona"}`,
    onclick:()=>selectPersona(p),
    onkeydown:event=>{
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        selectPersona(p);
      }
    }
  },[
    el("div",{class:"tile-select"},[
      el("label",{class:"select-persona", onclick:event=>event.stopPropagation()},[
        el("input",{type:"checkbox", value:p.PersonaID, checked, "aria-label":`Add ${p.PersonaName || "persona"} to Export Cart`, onchange:event=>toggleExportPersona(p.PersonaID, event.currentTarget.checked)}),
        el("span",{},["Add to Export Cart"])
      ])
    ]),
    el("div",{class:"tile-head"},[
      el("div",{},[
        el("h3",{},[p.PersonaName || "Untitled"]),
        el("div",{class:"meta"},[`Family Group: ${p.FamilyGroup || "—"} • ${p.PricingSet || ""}`])
      ]),
      iconSlot(p.IconPath, `${p.PersonaName || "Persona"} icon`, {type:"Persona", id:p.PersonaID, name:p.PersonaName, file:p.PromoIcon})
    ]),
    el("div",{class:"chips"},chips.length?chips:[el("span",{class:"chip gray"},["No modifiers"])]),
    el("table",{class:"speed-table"},[
      el("thead",{},[el("tr",{},[el("th",{},["Option"]),el("th",{},["Speed"]),el("th",{},["Pricing"]),el("th",{},["Reg. Rate"])])]),
      el("tbody",{},rows)
    ])
  ]);
}
function compactSpeedOptionMarker(){
  return "•";
}
function pricingSummaryNode(s){
  const rows = s.schedules || [];
  if(!rows.length) return el("span",{},[money(s.FirstPaidPrice)]);
  if(rows.length === 1 && !truthy(rows[0].DisplayAsFree)) return el("span",{},[money(rows[0].Price ?? s.FirstPaidPrice)]);

  return el("div",{class:"pricing-summary-list"},rows.map(pricingSummaryRow));
}
function pricingSummaryRow(row){
  const label = row.DisplayLabel || monthLabel(row);
  if(truthy(row.DisplayAsFree)){
    return el("div",{class:"pricing-summary-row"},[
      el("span",{class:"pricing-summary-price free"},["Free"]),
      el("span",{class:"pricing-summary-months"},[label])
    ]);
  }
  return el("div",{class:"pricing-summary-row"},[
    el("span",{class:"pricing-summary-price"},[money(row.Price)]),
    el("span",{class:"pricing-summary-months"},[label])
  ]);
}

function selectPersona(p){
  selectedPersona = p;
  renderDetail(p);
  if(typeof setView === "function") setView("personas", {focus:false});
}
function renderDetail(p){
  const panel = document.getElementById("detailPanel");
  panel.className="detail";
  const mods = (p.modifiers||[]).map(m=>m.ModifierName).join(" | ") || "None";
  panel.innerHTML="";
  panel.appendChild(el("div",{class:"detail-title"},[
    iconSlot(p.IconPath, `${p.PersonaName || "Persona"} icon`, {type:"Persona", id:p.PersonaID, name:p.PersonaName, file:p.PromoIcon}),
    el("h3",{},[p.PersonaName])
  ]));
  panel.appendChild(el("div",{class:"meta"},[`Persona ID: ${p.PersonaID} • Family Group: ${p.FamilyGroup}`]));
  const chips = el("div",{class:"chips"},[]);
  if(truthy(p.EquipInc)) chips.appendChild(el("span",{class:"chip feature"},["✓ Equip Inc"]));
  if(truthy(p.SymSpeed)) chips.appendChild(el("span",{class:"chip feature"},["✓ Sym Speed"]));
  if(truthy(p.Fiber)) chips.appendChild(el("span",{class:"chip feature"},["✓ Fiber"]));
  (p.modifiers||[]).forEach(m=>chips.appendChild(modifierChip(m)));
  panel.appendChild(chips);
  panel.appendChild(el("div",{class:"detail-section"},[
    el("strong",{},["Ratecard modifiers: "]), mods
  ]));
  (p.speeds||[]).forEach(s => panel.appendChild(speedDetail(s)));
  panel.appendChild(el("div",{class:"detail-section"},[
    el("strong",{},["Notes"]),
    el("p",{class:"muted"},[p.Notes || "No additional notes."])
  ]));
  panel.appendChild(el("div",{class:"detail-section disclaimer"},[
    p.disclaimer?.DisclaimerText || "No disclaimer attached."
  ]));
}
function speedDetail(s){
  const cards = (s.schedules||[]).map(sc => {
    let amount;
    if(truthy(sc.DisplayAsFree)){
      amount = [
        el("span",{class:"free"},["Free"]),
        el("span",{class:"strike"},[money(sc.StrikeThroughPrice || s.FirstPaidPrice)])
      ];
    } else {
      amount = money(sc.Price);
    }
    const amountChildren = Array.isArray(amount) ? amount : [amount];
    return el("div",{class:"schedule-card"},[
      el("div",{class:"label"},[sc.DisplayLabel || monthLabel(sc)]),
      el("div",{class:"amount"},amountChildren)
    ]);
  });
  return el("div",{class:"detail-section"},[
    el("h4",{class:"speed-detail-heading"},[s.DisplaySpeed || s.SpeedOption || "Speed option"]),
    el("div",{class:"meta"},[`Reference ID: ${s.ReferenceID} • Up: ${s.UploadSpeed || s.UploadMbps || "—"} • Reg. Rate: ${money(s.RegularRate)}`]),
    el("div",{class:"schedule-grid"},cards)
  ]);
}
function monthLabel(sc){
  if(sc.StartMonth === sc.EndMonth) return `Month ${sc.StartMonth}`;
  return `Months ${sc.StartMonth}-${sc.EndMonth}`;
}
function renderModifiers(){
  const box = document.getElementById("modifierList");
  if(!box) return;
  box.innerHTML="";
  if(!DB.modifiers.length){
    box.appendChild(emptyState("No modifiers are available.", "Load the published database or upload a workbook to review modifiers."));
    return;
  }
  DB.modifiers.forEach(m => {
    const used = DB.personaModifiers.filter(pm=>pm.ModifierID===m.ModifierID && truthy(pm.Active)).length;
    box.appendChild(el("div",{class:"modifier"},[
      el("div",{class:"modifier-title"},[
        iconSlot(m.IconPath, `${m.ModifierName || "Modifier"} icon`, {type:"Modifier", id:m.ModifierID, name:m.ModifierName, file:m.IconFile}),
        el("h3",{},[m.ModifierName])
      ]),
      el("div",{class:"meta"},[`${m.Category || "Modifier"} • Used by ${used} personas`]),
      el("p",{class:"muted"},[m.Description || ""])
    ]));
  });
}
function renderHealth(){
  const box = document.getElementById("healthList");
  if(!box) return;
  box.innerHTML="";
  const rows = buildHealth();
  if(!rows.length){
    box.appendChild(emptyState("No health checks are available.", "Load the published database or upload a workbook to review database health."));
    return;
  }
  box.appendChild(el("div",{class:"health-review-actions"},[
    el("button",{class:"btn primary",type:"button",onclick:()=>{ markDatabaseHealthReviewed(); renderAll(); }},["Mark Health Reviewed"]),
    el("span",{class:"muted"},[DB.healthReviewedAt ? `Reviewed ${new Date(DB.healthReviewedAt).toLocaleString()}` : "Required before v2 package download"])
  ]));
  rows.forEach((h, index) => {
    const st = String(h.Status||"").toUpperCase();
    const failed = st && st !== "OK";
    const records = h.Records || [];
    const detailId = `health-detail-${index}`;
    const row = el("button",{
      class:`health-row ${failed ? "failed" : ""}`,
      type:"button",
      "aria-expanded":"false",
      "aria-controls":detailId,
      disabled:failed ? null : "disabled",
      onclick:()=>toggleHealthDetails(detailId, row)
    },[
      el("div",{class:"muted"},[h.Section || ""]),
      el("div",{},[h.Check || ""]),
      el("div",{class:st==="OK"?"status-ok":st==="WARN"?"status-warn":"status-bad"},[st || "—"]),
      el("div",{},[String(h.Count ?? "")]),
      el("div",{class:"health-details muted", title:h.Details || ""},[failed ? "Click to inspect offending records" : (h.Details || "—")])
    ]);
    box.appendChild(row);
    box.appendChild(healthDetailPanel(h, records, detailId));
  });
}
function toggleHealthDetails(detailId, row){
  const panel = document.getElementById(detailId);
  if(!panel || row.disabled) return;
  const open = panel.hidden;
  panel.hidden = !open;
  row.setAttribute("aria-expanded", String(open));
}
function healthDetailPanel(h, records, id){
  const failed = String(h.Status||"").toUpperCase() !== "OK";
  const panel = el("div",{class:"health-detail-panel", id},[]);
  panel.hidden = true;
  if(!failed){
    return panel;
  }
  panel.appendChild(el("h3",{},[`${h.Check || "Health check"} details`]));
  panel.appendChild(el("p",{class:"muted"},[records.length ? `${records.length} offending record${records.length===1?"":"s"}.` : "No record-level details were provided for this failed check."]));
  if(!records.length){
    panel.appendChild(el("pre",{},[h.Details || "No details available."]));
    return panel;
  }
  records.forEach(record => {
    const fields = record.Fields || {};
    panel.appendChild(el("div",{class:"health-record"},[
      el("div",{class:"health-record-title"},[record.Record || "Unknown record"]),
      el("div",{class:"health-record-reason"},[record.Reason || "No reason provided."]),
      el("dl",{class:"health-record-fields"},Object.entries(fields).flatMap(([key,value]) => [
        el("dt",{},[key]),
        el("dd",{},[String(value ?? "")])
      ]))
    ]));
  });
  return panel;
}
function fillExportPicker(){
  const sel = document.getElementById("exportPersona");
  if(!sel) return;
  sel.innerHTML="";
  if(!DB.personas.length){
    sel.appendChild(el("option",{value:""},["No personas available"]));
  }
  DB.personas.forEach(p => sel.appendChild(el("option",{value:p.PersonaID},[p.PersonaName])));
  syncExportSelectionUI();
  renderPrintArea();
  renderExportCartList();
}
function selectedExportPersonas(){
  return [...exportSelection]
    .map(id => DB.personas.find(p => p.PersonaID === id))
    .filter(Boolean);
}
function currentExportPersona(){
  const sel = document.getElementById("exportPersona");
  return DB.personas.find(x=>x.PersonaID===sel?.value) || DB.personas[0];
}
function toggleExportPersona(personaID, checked){
  if(!personaID) return;
  if(checked) exportSelection.add(personaID);
  else exportSelection.delete(personaID);
  syncExportSelectionUI();
  renderPrintArea();
  renderExportCartTray();
  renderTiles();
}
function removeExportPersona(personaID){
  exportSelection.delete(personaID);
  syncExportSelectionUI();
  renderPrintArea();
  renderExportCartTray();
  renderTiles();
}
function selectAllVisiblePersonas(){
  visiblePersonas().forEach(p => { if(p.PersonaID) exportSelection.add(p.PersonaID); });
  syncExportSelectionUI();
  renderPrintArea();
  renderExportCartTray();
  renderTiles();
}
function clearExportSelection(){
  exportSelection.clear();
  syncExportSelectionUI();
  renderPrintArea();
  renderExportCartTray();
  renderTiles();
}
function syncExportSelectionUI(){
  const count = exportSelection.size;
  const label = count === 1 ? "1 persona in Export Cart" : `${count} personas in Export Cart`;
  const countEl = document.getElementById("selectedCount");
  if(countEl) countEl.textContent = label;
  const pageCount = document.getElementById("exportCartCount");
  if(pageCount) pageCount.textContent = label;
  document.querySelectorAll(".select-persona input[type='checkbox']").forEach(input => {
    input.checked = exportSelection.has(input.closest("article")?.dataset?.personaId || input.value);
  });
}

function renderExportCartTray(){
  const tray = document.getElementById("exportCartTray");
  if(!tray) return;
  const count = exportSelection.size;
  tray.hidden = count === 0;
  document.body.classList.toggle("has-export-cart-tray", count > 0);
  if(!count) return;
  const countText = `${count} persona${count === 1 ? "" : "s"}`;
  const message = `${countText} added to Export Cart`;
  tray.innerHTML = "";
  tray.appendChild(el("div",{class:"export-cart-tray-copy", role:"status", "aria-live":"polite"},[
    el("strong",{},[countText]),
    el("span",{},[message])
  ]));
  tray.appendChild(el("div",{class:"export-cart-tray-actions"},[
    el("button",{class:"btn primary", type:"button", onclick:()=>{ if(typeof setView === "function") setView("export"); }},["Open Export Cart"]),
    el("button",{class:"btn", type:"button", onclick:clearExportSelection},["Clear Selection"])
  ]));
}
function renderExportCartList(){
  const list = document.getElementById("exportCartList");
  const empty = document.getElementById("exportCartEmpty");
  const actions = document.getElementById("exportCartActions");
  if(!list) return;
  const personas = selectedExportPersonas();
  list.innerHTML = "";
  if(empty) empty.hidden = personas.length > 0;
  if(actions) actions.hidden = personas.length === 0;
  personas.forEach((p, index) => list.appendChild(el("li",{class:"export-cart-item"},[
    el("div",{},[
      el("strong",{},[p.PersonaName || "Untitled persona"]),
      el("div",{class:"meta"},[`${index + 1}. ${p.FamilyGroup || "—"} • ${p.PricingSet || "—"}`])
    ]),
    el("button",{class:"btn small", type:"button", "aria-label":`Remove ${p.PersonaName || "persona"} from Export Cart`, onclick:()=>removeExportPersona(p.PersonaID)},["Remove"])
  ])));
}

function renderPrintArea(){
  renderExportCartList();
  const area = document.getElementById("printArea");
  if(!area) return;
  area.innerHTML="";
  const selected = selectedExportPersonas();
  if(selected.length){
    selected.forEach((p, index) => area.appendChild(printablePersonaCard(p, index, selected.length)));
    return;
  }
  const p = currentExportPersona();
  if(!p){
    area.appendChild(el("div",{class:"print-card empty-state"},["No personas are available to export."]));
    return;
  }
  area.appendChild(el("div",{class:"print-card empty-state"},[
    el("strong",{},["No personas selected for multi-export."]),
    el("p",{class:"muted"},["Use the tile checkboxes or Select All Visible to print multiple personas. The single-persona preview remains below."])
  ]));
  area.appendChild(printablePersonaCard(p, 0, 1));
}
function printablePersonaCard(p, index=0, total=1){
  const safeName = p.PersonaName || "Untitled persona";
  const card = el("section",{class:"print-card print-persona-page"},[]);
  const inner = el("div",{class:"print-card-inner"},[]);
  card.appendChild(el("header",{class:"print-page-header"},[
    el("div",{},[
      el("div",{class:"print-page-kicker"},[`Persona ${index + 1} of ${total}`]),
      el("h1",{},[safeName])
    ]),
    el("div",{class:"print-page-meta"},[
      el("span",{},[`Family Group: ${p.FamilyGroup || "—"}`]),
      el("span",{},[`Pricing Set: ${p.PricingSet || "—"}`]),
      el("span",{class:"internal-ref"},[`PersonaID: ${p.PersonaID || "—"}`])
    ])
  ]));
  card.appendChild(inner);
  card.appendChild(el("footer",{class:"print-page-footer"},[
    el("span",{},["Personaville"]),
    el("span",{},[p.PersonaID ? `${safeName} • ${p.PersonaID}` : safeName]),
    el("span",{},[`Generated ${new Date().toLocaleDateString()}`]),
    el("span",{class:"print-page-number"},[])
  ]));
  inner.appendChild(el("div",{class:"print-title"},[
    iconSlot(p.IconPath, `${safeName} icon`, {type:"Persona", id:p.PersonaID, name:p.PersonaName, file:p.PromoIcon}),
    el("h2",{},[safeName])
  ]));
  inner.appendChild(el("div",{class:"meta"},[`Family Group: ${p.FamilyGroup || "—"} • Pricing Set: ${p.PricingSet || "—"}`]));
  const chips = el("div",{class:"chips"},[]);
  if(truthy(p.EquipInc)) chips.appendChild(el("span",{class:"chip feature"},["✓ Equip Inc"]));
  if(truthy(p.SymSpeed)) chips.appendChild(el("span",{class:"chip feature"},["✓ Sym Speed"]));
  if(truthy(p.Fiber)) chips.appendChild(el("span",{class:"chip feature"},["✓ Fiber"]));
  (p.modifiers||[]).forEach(m=>chips.appendChild(modifierChip(m)));
  inner.appendChild(chips);
  p.speeds.forEach(s => inner.appendChild(speedDetail(s)));
  inner.appendChild(el("div",{class:"detail-section disclaimer"},[p.disclaimer?.DisclaimerText || ""]));
  return card;
}

function selectedSummaryText(){
  const personas = selectedExportPersonas();
  const list = personas.length ? personas : [currentExportPersona()].filter(Boolean);
  if(!list.length) return "";
  const lines=[];
  list.forEach((p, index)=>{
    if(index) lines.push("", "---", "");
    lines.push(p.PersonaName,`Family Group: ${p.FamilyGroup}`,`Pricing Set: ${p.PricingSet}`,"");
    p.speeds.forEach(s=>lines.push(`${s.SpeedOption} ${s.DisplaySpeed} - ${money(s.FirstPaidPrice)} - Reg. ${money(s.RegularRate)}`));
  });
  return lines.join("\n");
}
function copySelectedSummary(){
  const summary = selectedSummaryText();
  if(!summary) return;
  navigator.clipboard.writeText(summary);
  const countEl = document.getElementById("selectedCount");
  if(countEl) countEl.textContent = "Summary copied";
}

function downloadSelectedSummary(){
  const summary = selectedSummaryText();
  if(!summary) return;
  const blob = new Blob([summary], {type:"text/plain"});
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${exportPdfDocumentTitle()}-Summary.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  const countEl = document.getElementById("selectedCount");
  if(countEl) countEl.textContent = "Summary downloaded";
}

function filenameSafeText(value){
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function exportTimestamp(date=new Date()){
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

let normalDocumentTitle = null;
let activePrintContainer = null;
function exportPdfDocumentTitle(date=new Date()){
  const personas = selectedExportPersonas();
  const timestamp = exportTimestamp(date);
  const personaNames = personas.map(persona => filenameSafeText(persona.PersonaName)).filter(Boolean);
  if(personas.length === 1 && personaNames[0]) return personaNames[0];
  if(personaNames.length) return `Personaville-${personas.length}-Personas-${timestamp}`;
  return `Personaville-Export-${timestamp}`;
}
function removeDedicatedPrintDocument(){
  if(activePrintContainer){
    activePrintContainer.remove();
    activePrintContainer = null;
  }
}
function selectedPersonaPrintLayouts(personas){
  const source = document.createElement("div");
  personas.forEach((persona, index) => source.appendChild(printablePersonaCard(persona, index, personas.length)));
  return Array.from(source.querySelectorAll(".print-persona-page"), card => card.cloneNode(true));
}
function createDedicatedPrintDocument(personas){
  removeDedicatedPrintDocument();
  const container = document.createElement("div");
  container.className = "persona-print-document";
  container.setAttribute("aria-hidden", "true");
  selectedPersonaPrintLayouts(personas).forEach(card => container.appendChild(card));
  document.body.appendChild(container);
  activePrintContainer = container;
  return container;
}
function printCombinedExportPdf(){
  const personas = selectedExportPersonas();
  if(!personas.length) return;
  normalDocumentTitle = document.title;
  document.title = exportPdfDocumentTitle();
  createDedicatedPrintDocument(personas);
  window.print();
}
function restorePrintDocumentTitle(){
  if(normalDocumentTitle === null) return;
  document.title = normalDocumentTitle;
  normalDocumentTitle = null;
}

function resetPrintScaling(){
  document.querySelectorAll(".print-persona-page").forEach(card => {
    card.style.removeProperty("--print-scale");
  });
}
function fitPrintCardsToLetter(){
  resetPrintScaling();
  const maxScale = 1;
  const minScale = 0.82;
  document.querySelectorAll(".print-persona-page").forEach(card => {
    const inner = card.querySelector(".print-card-inner");
    if(!inner) return;
    const availableHeight = card.clientHeight || 0;
    const availableWidth = card.clientWidth || 0;
    const heightScale = availableHeight ? availableHeight / inner.scrollHeight : maxScale;
    const widthScale = availableWidth ? availableWidth / inner.scrollWidth : maxScale;
    const scale = Math.max(minScale, Math.min(maxScale, heightScale, widthScale));
    card.style.setProperty("--print-scale", String(scale));
  });
}

let editorSelectedModifierID = "";
let editorSelectedDisclaimerID = "";
function renderModifierEditor(){
  const list=document.getElementById("modifierEditorList"), form=document.getElementById("modifierEditorForm"), count=document.getElementById("modifierEditorCount"); if(!list||!form) return;
  if(!editorSelectedModifierID&&DB.modifiers[0]) editorSelectedModifierID=DB.modifiers[0].ModifierID;
  list.innerHTML=""; DB.modifiers.forEach(m=>list.appendChild(el("button",{class:`persona-editor-row${m.ModifierID===editorSelectedModifierID?" active":""}${truthy(m.Active)?"":" inactive"}`,type:"button",onclick:()=>{editorSelectedModifierID=m.ModifierID; renderModifierEditor();}},[el("strong",{},[m.ModifierName||"Untitled"]),el("span",{},[`${m.ModifierID} • ${m.Category||"No category"} • ${truthy(m.Active)?"Active":"Inactive"}`])])));
  if(count) count.textContent=`${DB.modifiers.length} modifier${DB.modifiers.length===1?"":"s"}`;
  renderModifierEditorForm(DB.modifiers.find(m=>m.ModifierID===editorSelectedModifierID)||null);
}
function modifierEditorField(name,value,errors={}){ const id=`modifierEdit-${name}`; const input=name==="Description"?el("textarea",{id,name,rows:"3"},[value||""]):name==="Active"?el("select",{id,name},[["TRUE","True"],["FALSE","False"]].map(([v,l])=>el("option",{value:v,selected:String(value).toUpperCase()===v},[l]))):el("input",{id,name,value:value??""}); return el("label",{class:`editor-field ${errors[name]?"invalid":""}`},[el("span",{},[name]),input,errors[name]?el("em",{},[errors[name]]):null]); }
function renderModifierEditorForm(modifier, errors={}){ const form=document.getElementById("modifierEditorForm"); form.innerHTML=""; if(!modifier){form.appendChild(emptyState("Select or create a modifier.")); return;} form.dataset.originalModifierId=modifier.ModifierID||""; MODIFIER_EDITOR_FIELDS.forEach(f=>form.appendChild(modifierEditorField(f,modifier[f],errors))); const uses=modifierRelationships(modifier.ModifierID); form.appendChild(el("div",{class:"usage-card"},[el("h4",{},["Personas using this modifier"]), uses.length?el("ul",{},uses.map(u=>el("li",{},[`${u.persona.PersonaName||u.PersonaID} (${u.PersonaID}) • ${truthy(u.Active)?"Active":"Inactive"} • order ${u.DisplayOrder||"—"}`]))):el("p",{class:"muted"},["No personas use this modifier."])])); }
function modifierEditorDraft(){ const form=document.getElementById("modifierEditorForm"), d={}; MODIFIER_EDITOR_FIELDS.forEach(f=>d[f]=form.elements[f]?.value??""); return d; }
function saveModifierEditor(){ const form=document.getElementById("modifierEditorForm"), original=form.dataset.originalModifierId||"", draft=modifierEditorDraft(), validation=validateModifierDraft(draft,original); if(!validation.valid){renderModifierEditorForm(draft,validation.errors); return;} const saved=saveModifierDraft(draft,original); runDatabaseHealth(); editorSelectedModifierID=saved.ModifierID; renderAll(); }
function createModifierEditor(){ startEditingSession(); editorSelectedModifierID=""; renderModifierEditorForm({ModifierID:nextSafeModifierID(), Active:"TRUE", Category:"Ratecard Modifier"}); }
function activeSelectedModifierEditor(active){ if(!editorSelectedModifierID) return; setModifierActive(editorSelectedModifierID,active); runDatabaseHealth(); renderAll(); }
function renderPersonaModifierEditor(){ const box=document.getElementById("personaModifierList"), select=document.getElementById("personaModifierAddSelect"), warn=document.getElementById("personaModifierWarnings"); if(!box||!select) return; const personaID=editorSelectedPersonaID; select.innerHTML=""; DB.modifiers.forEach(m=>select.appendChild(el("option",{value:m.ModifierID},[`${m.ModifierID} — ${m.ModifierName}`]))); box.innerHTML=""; if(!personaID){box.appendChild(emptyState("Select a persona first.")); return;} const rows=DB.personaModifiers.filter(r=>r.PersonaID===personaID).sort((a,b)=>Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0)); rows.forEach(r=>{ const m=DB.modifiers.find(x=>x.ModifierID===r.ModifierID)||{}; box.appendChild(el("div",{class:"persona-editor-row relationship-row"},[el("strong",{},[m.ModifierName||r.ModifierID]),el("span",{},[`${r.ModifierID} • ${truthy(r.Active)?"Active":"Inactive"} • order ${r.DisplayOrder||"—"}`]),el("div",{class:"persona-editor-toolbar"},[el("button",{class:"btn",type:"button",onclick:()=>{movePersonaModifier(personaID,r.ModifierID,-1);runDatabaseHealth();renderAll();}},["Up"]),el("button",{class:"btn",type:"button",onclick:()=>{movePersonaModifier(personaID,r.ModifierID,1);runDatabaseHealth();renderAll();}},["Down"]),el("button",{class:"btn danger",type:"button",onclick:()=>{if(confirm("Remove this modifier from the persona?")){removePersonaModifier(personaID,r.ModifierID);runDatabaseHealth();renderAll();}}},["Remove"])] )])); }); if(warn){ const warnings=expectedModifierWarningsForPersona(personaID); warn.innerHTML=""; warn.appendChild(el("h4",{},["Expected modifier warnings"])); warn.appendChild(warnings.length?el("ul",{},warnings.map(w=>el("li",{class:"editor-warning"},[w]))):el("p",{class:"muted"},["No expected modifier warnings for this persona."])); } }
function addPersonaModifierEditor(){ if(!editorSelectedPersonaID) return; const modifierID=document.getElementById("personaModifierAddSelect")?.value; try{ savePersonaModifierDraft({PersonaID:editorSelectedPersonaID, ModifierID:modifierID, DisplayOrder:DB.personaModifiers.filter(r=>r.PersonaID===editorSelectedPersonaID).length+1, Active:"TRUE"}); runDatabaseHealth(); renderAll(); }catch(e){ alert(e.message); } }
function renderDisclaimerEditor(){ const list=document.getElementById("disclaimerEditorList"), form=document.getElementById("disclaimerEditorForm"), count=document.getElementById("disclaimerEditorCount"); if(!list||!form) return; if(!editorSelectedDisclaimerID&&DB.disclaimers[0]) editorSelectedDisclaimerID=DB.disclaimers[0].DisclaimerID; list.innerHTML=""; DB.disclaimers.forEach(d=>list.appendChild(el("button",{class:`persona-editor-row${d.DisclaimerID===editorSelectedDisclaimerID?" active":""}${truthy(d.Active)?"":" inactive"}`,type:"button",onclick:()=>{editorSelectedDisclaimerID=d.DisclaimerID; renderDisclaimerEditor();}},[el("strong",{},[d.Title||d.DisclaimerID]),el("span",{},[`${d.DisclaimerID} • ${personasUsingDisclaimer(d.DisclaimerID).length} linked persona(s)`])]))); if(count) count.textContent=`${DB.disclaimers.length} disclaimer${DB.disclaimers.length===1?"":"s"}`; renderDisclaimerEditorForm(DB.disclaimers.find(d=>d.DisclaimerID===editorSelectedDisclaimerID)||null); }
function disclaimerField(name,value,errors={}){ const input=name==="DisclaimerText"?el("textarea",{name,rows:"10",spellcheck:"false"},[value||""]):name==="Active"?el("select",{name},[["TRUE","True"],["FALSE","False"]].map(([v,l])=>el("option",{value:v,selected:String(value).toUpperCase()===v},[l]))):el("input",{name,value:value??""}); return el("label",{class:`editor-field ${errors[name]?"invalid":""}`},[el("span",{},[name]),input,errors[name]?el("em",{},[errors[name]]):null]); }
function renderDisclaimerEditorForm(disclaimer, errors={}){ const form=document.getElementById("disclaimerEditorForm"); form.innerHTML=""; if(!disclaimer){form.appendChild(emptyState("Select a disclaimer.")); return;} form.dataset.originalDisclaimerId=disclaimer.DisclaimerID||""; DISCLAIMER_EDITOR_FIELDS.forEach(f=>form.appendChild(disclaimerField(f,disclaimer[f],errors))); renderDisclaimerPreviewAndUsage(disclaimer); form.addEventListener("input",()=>renderDisclaimerPreviewAndUsage(disclaimerEditorDraft()),{once:true}); }
function disclaimerEditorDraft(){ const form=document.getElementById("disclaimerEditorForm"), d={}; DISCLAIMER_EDITOR_FIELDS.forEach(f=>d[f]=form.elements[f]?.value??""); return d; }
function renderDisclaimerPreviewAndUsage(disclaimer){ const preview=document.getElementById("disclaimerPreview"), usage=document.getElementById("disclaimerUsage"); if(preview){preview.innerHTML=""; preview.appendChild(el("h4",{},["Formatted preview"])); preview.appendChild(el("div",{class:"disclaimer"},[disclaimer.DisclaimerText||""]));} if(usage){ const linked=personasUsingDisclaimer(disclaimer.DisclaimerID), missing=missingDisclaimerRelationships(); usage.innerHTML=""; usage.appendChild(el("h4",{},["Linked personas"])); usage.appendChild(linked.length?el("ul",{},linked.map(p=>el("li",{},[`${p.PersonaName||p.PersonaID} (${p.PersonaID})`]))):el("p",{class:"editor-warning"},["No personas link to this disclaimer."])); if(linked.length>1) usage.appendChild(el("p",{class:"editor-warning"},["Warning: this disclaimer is used by multiple personas."])); usage.appendChild(el("h4",{},["Missing disclaimer relationships"])); usage.appendChild(missing.length?el("ul",{},missing.map(p=>el("li",{class:"editor-warning"},[`${p.PersonaName||p.PersonaID} (${p.PersonaID}) has ${p.DisclaimerID||"no DisclaimerID"}`]))):el("p",{class:"muted"},["All personas link to an existing disclaimer."])); } }
function saveDisclaimerEditor(){ const form=document.getElementById("disclaimerEditorForm"), original=form.dataset.originalDisclaimerId||"", draft=disclaimerEditorDraft(), linked=personasUsingDisclaimer(original); if(original&&linked.length>1&&!confirm(`This disclaimer is used by ${linked.length} personas. Change shared legal copy anyway?`)) return; const validation=validateDisclaimerDraft(draft,original); if(!validation.valid){renderDisclaimerEditorForm(draft,validation.errors); return;} const saved=saveDisclaimerDraft(draft,original); runDatabaseHealth(); editorSelectedDisclaimerID=saved.DisclaimerID; renderAll(); }
function duplicateDisclaimerEditor(){ if(!editorSelectedDisclaimerID) return; const saved=duplicateDisclaimer(editorSelectedDisclaimerID); runDatabaseHealth(); editorSelectedDisclaimerID=saved.DisclaimerID; renderAll(); }

function renderChangeReview(){
  const list = document.getElementById("changeList");
  const summary = document.getElementById("reviewSummary");
  const countPill = document.getElementById("reviewChangeCount");
  const filter = document.getElementById("changeTypeFilter");
  if(!list || !summary || !countPill) return;
  const session = editingSessionState();
  if(session.initState !== "ready"){
    countPill.textContent = "Loading…";
    summary.innerHTML = "";
    list.innerHTML = "";
    list.appendChild(emptyState(`Change Review is waiting for startup to finish (${session.initState || "loading"}).`));
    return;
  }
  if(session.notice){
    const notice = el("div",{class:"notice warn"},[session.notice]);
    summary.innerHTML = "";
    summary.appendChild(notice);
  }
  const changes = editingChangeList();
  const types = [...new Set(changes.map(c => c.recordType))].sort();
  if(filter){
    const current = editingSessionState().changeFilter || "all";
    filter.innerHTML = "";
    filter.appendChild(el("option",{value:"all", selected:current === "all"},["All record types"]));
    types.forEach(type => filter.appendChild(el("option",{value:type, selected:current === type},[type])));
  }
  const filtered = changes.filter(change => !filter || filter.value === "all" || change.recordType === filter.value);
  countPill.textContent = `${changes.length} change${changes.length === 1 ? "" : "s"}`;
  countPill.setAttribute("aria-label", `${changes.length} uncommitted change${changes.length === 1 ? "" : "s"}`);
  const review = editingChangeSummary();
  if(!session.notice) summary.innerHTML = "";
  [
    ["Personas changed", review.personas],
    ["Speed options changed", review.speedOptions],
    ["Pricing rows changed", review.pricingRows],
    ["Modifiers changed", review.modifiers],
    ["Disclaimers changed", review.disclaimers],
    ["Assets staged", (typeof AssetManager !== "undefined" ? AssetManager.staged.length : 0) + review.assets],
    ["Health errors", review.healthErrors],
    ["Health warnings", review.healthWarnings]
  ].forEach(([label, value]) => summary.appendChild(el("div",{class:"status-card kpi"},[el("div",{class:"num"},[String(value)]), el("div",{class:"label"},[label])])));
  list.innerHTML = "";
  if(!filtered.length){ list.appendChild(emptyState(changes.length ? "No changes match this record type." : "No uncommitted changes yet.")); return; }
  filtered.forEach(change => list.appendChild(el("article",{class:"change-row"},[
    el("div",{class:"change-row-head"},[el("strong",{},[`${change.recordType}: ${change.recordName}`]), el("span",{class:"pill gray"},[change.kind])]),
    el("div",{class:"change-field"},[`${change.field}: `, el("span",{class:"change-before"},[change.before]), " → ", el("span",{class:"change-after"},[change.after])]),
    el("div",{class:"persona-editor-toolbar"},[
      el("button",{class:"btn small",type:"button",onclick:()=>jumpToChangeEditor(change)},["Jump to editor"]),
      el("button",{class:"btn small",type:"button",onclick:()=>{ if(confirm("Discard this uncommitted change?")){ discardUncommittedChange(change.id); runDatabaseHealth(); renderAll(); } }},["Discard change"])
    ])
  ])));
}
function jumpToChangeEditor(change){
  const target = change.editorTarget || {};
  if(change.sheet === SHEET_MAP.personas) editorSelectedPersonaID = (change.recordKey.split(":").pop() || editorSelectedPersonaID);
  if(change.sheet === SHEET_MAP.speedOptions){ const row = DB.speedOptions.find((r,i)=>sheetRecordKey(SHEET_MAP.speedOptions,r,i)===change.recordKey); if(row){ editorSelectedPersonaID=row.PersonaID; editorSelectedSpeedKey=speedOptionKey(row); } }
  if(change.sheet === SHEET_MAP.modifiers) editorSelectedModifierID = change.recordKey.split(":").pop() || editorSelectedModifierID;
  if(change.sheet === SHEET_MAP.disclaimers) editorSelectedDisclaimerID = change.recordKey.split(":").pop() || editorSelectedDisclaimerID;
  setView(target.view || "manage");
  if(target.adminSection) setAdminSection(target.adminSection);
  renderAll();
}
