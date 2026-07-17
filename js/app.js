
let exportSound = null;

function playExportSound(){
  if(typeof Audio !== "function") return;
  if(!exportSound){
    exportSound = new Audio("assets/audio/uhoh.mp3");
  }
  exportSound.currentTime = 0;
  exportSound.play().catch(() => {});
}

function runExportAction(action){
  playExportSound();
  action();
}


function statusForHealthExport(kind, message){
  const ids = kind === "review" ? ["reviewHealthExportStatus"] : kind === "admin" ? ["adminHealthExportStatus"] : ["reviewHealthExportStatus", "adminHealthExportStatus"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = message;
  });
}
function downloadHealthExport(kind, source="all"){
  try{
    const payload = healthExportPayload(kind);
    const labels = {report:"Health Report", warnings:"Warnings Only", errors:"Errors Only"};
    if(kind !== "log" && payload.count === 0){
      statusForHealthExport(source, `No ${labels[kind] || "health"} findings found in the live working copy.`);
      return;
    }
    const blob = new Blob([payload.text], {type:payload.type});
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = payload.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    statusForHealthExport(source, `Downloaded ${payload.filename}`);
  }catch(err){
    alert(err.message);
  }
}
function runHealthExportAction(kind, source){
  if(typeof playExportSound === "function") playExportSound();
  downloadHealthExport(kind, source);
}

function warnIfUnsavedChanges(message){
  if(typeof editingHasUnsavedChanges !== "function" || !editingHasUnsavedChanges()) return true;
  return window.confirm(message || "You have unsaved working-copy changes. Continue and lose those changes?");
}
function refreshEditingStatus(){
  if(typeof renderEditingStatus === "function") renderEditingStatus();
}

const VIEW_ALIASES = {
  "manage-personas":"manage",
  "database-manager":"manage",
  database:"manage"
};

const VIEW_TITLES = {
  personas:"View Personas",
  review:"Data Explorer",
  export:"Export Cart",
  manage:"Database Manager",
  admin:"Admin"
};

function canonicalViewName(name){
  const normalized = String(name || "personas").replace(/^#/, "");
  return VIEW_ALIASES[normalized] || normalized;
}

function viewNameFromLocation(){
  const hash = window.location.hash.replace(/^#/, "");
  const candidate = canonicalViewName(hash);
  return document.getElementById(candidate)?.classList.contains("view") ? candidate : "personas";
}

function setView(name, options = {}){
  name = canonicalViewName(name);
  document.querySelectorAll(".nav").forEach(n=>{
    const active = n.dataset.view===name;
    n.classList.toggle("active", active);
    n.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id===name));
  const headerContainer = document.getElementById("personaville-header-container");
  if(headerContainer){
    headerContainer.hidden = false;
  }
  if(typeof window.setPersonavilleHeaderState === "function"){
    window.setPersonavilleHeaderState(name === "personas" ? "full" : "compact");
  }
  if(VIEW_TITLES[name]){
    document.title = `Personaville v2 Preview — ${VIEW_TITLES[name]}`;
  }
  if(options.updateHash !== false && window.location.hash !== `#${name}`){
    window.history.replaceState(null, "", `#${name}`);
  }
  const heading = document.getElementById(name)?.querySelector("h2");
  if(heading && options.focus !== false){
    heading.setAttribute("tabindex", "-1");
    heading.focus({preventScroll:true});
  }
}

function setAdminSection(name, options = {}){
  document.querySelectorAll(".admin-tab").forEach(tab=>{
    const active = tab.dataset.adminSection === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".admin-panel").forEach(panel=>{
    const active = panel.id === `admin-${name}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  if(options.focus){
    const panel = document.getElementById(`admin-${name}`);
    const heading = panel?.querySelector("h3") || panel;
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({preventScroll:true});
  }
}

async function loadPersonavilleHeader(){
  const container = document.getElementById("personaville-header-container");
  if(!container || container.dataset.loaded === "true") return;

  try{
    const response = await fetch("components/header.html");
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    container.innerHTML = await response.text();
    container.dataset.loaded = "true";
    if(typeof window.initPersonavilleHeader === "function"){
      window.initPersonavilleHeader(container);
    }
    if(typeof window.setPersonavilleHeaderState === "function"){
      const activeView = document.querySelector(".view.active")?.id || "personas";
      window.setPersonavilleHeaderState(activeView === "personas" ? "full" : "compact");
    }
  }catch(err){
    container.hidden = true;
    console.warn("Personaville header could not be loaded; continuing without hero header.", err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  loadPersonavilleHeader();
  setView(viewNameFromLocation(), {focus:false, updateHash:false});
  window.addEventListener("hashchange", () => setView(viewNameFromLocation(), {focus:false, updateHash:false}));
  document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => setAdminSection(tab.dataset.adminSection, {focus:true}));
    tab.addEventListener("keydown", event => {
      if(!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll(".admin-tab")];
      const index = tabs.indexOf(tab);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      setAdminSection(tabs[nextIndex].dataset.adminSection);
    });
  });
  document.getElementById("workbookUpload").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(file && !warnIfUnsavedChanges("Loading another workbook will discard unsaved working-copy changes. Continue?")){
      e.target.value = "";
      return;
    }
    if(!file) return;
    try{
      await loadWorkbookFile(file);
      const instructions = document.getElementById("downloadInstructions");
      if(instructions) instructions.hidden = true;
      renderAll();
      setView("admin");
      setAdminSection("publish");
    }catch(err){
      alert("Could not load database from workbook: " + err.message);
    }
  });
  document.getElementById("downloadUpdatedJson").addEventListener("click", downloadUpdatedJson);
  document.getElementById("downloadPublishingPackage")?.addEventListener("click", downloadPublishingPackage);
  document.getElementById("exportPublishedWorkbook")?.addEventListener("click", () => downloadDatabaseWorkbook("published"));
  document.getElementById("exportWorkingWorkbook")?.addEventListener("click", () => downloadDatabaseWorkbook("working"));
  document.getElementById("workbookImport")?.addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    e.target.value = "";
    if(!file) return;
    try{
      await prepareWorkbookImportFile(file);
      renderAll();
    }catch(err){
      if(typeof resetWorkbookImportState === "function") resetWorkbookImportState();
      alert("Could not prepare workbook import: " + err.message);
      renderAll();
    }
  });
  document.getElementById("loadBundled").addEventListener("click", async ()=>{
    if(!warnIfUnsavedChanges("Loading the published database will discard unsaved working-copy changes. Continue?")) return;
    try{
      await loadBundledDatabase();
      renderAll();
    }catch(err){
      alert("Could not load published database: " + err.message + "\\nIf opening from local file, use Upload Workbook instead.");
    }
  });
  document.getElementById("globalSearch").addEventListener("input", renderTiles);
  document.getElementById("familyFilter").addEventListener("change", renderTiles);
  document.getElementById("pricingFilter").addEventListener("change", renderTiles);
  document.getElementById("lifecycleFilter")?.addEventListener("change", renderTiles);
  document.getElementById("clearSelection").addEventListener("click", resetPersonaDetail);
  document.getElementById("clearFilters").addEventListener("click", clearPersonaFilters);
  document.getElementById("clearFamilyGroup").addEventListener("click", clearFamilyGroupFilter);
  document.getElementById("exportPersona").addEventListener("change", renderPrintArea);
  document.getElementById("selectAllVisible").addEventListener("click", selectAllVisiblePersonas);
  document.getElementById("clearExportSelection").addEventListener("click", clearExportSelection);
  document.getElementById("selectAllPersonas")?.addEventListener("click", selectAllPersonas);
  document.getElementById("deselectAllPersonas")?.addEventListener("click", deselectAllPersonas);
  document.getElementById("selectVisiblePersonas")?.addEventListener("click", selectAllVisiblePersonas);
  document.getElementById("deselectVisiblePersonas")?.addEventListener("click", deselectVisiblePersonas);
  document.getElementById("viewExportCart")?.addEventListener("click", () => setView("export"));
  document.getElementById("clearPersonaCart")?.addEventListener("click", clearExportSelection);
  document.getElementById("printPersona").addEventListener("click", () => runExportAction(printCombinedExportPdf));
  document.getElementById("savePdf").addEventListener("click", () => runExportAction(printCombinedExportPdf));
  document.getElementById("downloadSummary").addEventListener("click", () => runExportAction(downloadSelectedSummary));
  document.getElementById("copySummary").addEventListener("click", () => runExportAction(copySelectedSummary));
  document.getElementById("reviewExportHealthReport")?.addEventListener("click", () => runHealthExportAction("report", "review"));
  document.getElementById("reviewExportHealthWarnings")?.addEventListener("click", () => runHealthExportAction("warnings", "review"));
  document.getElementById("reviewExportHealthErrors")?.addEventListener("click", () => runHealthExportAction("errors", "review"));
  document.getElementById("reviewDownloadHealthLog")?.addEventListener("click", () => runHealthExportAction("log", "review"));
  document.getElementById("adminExportHealthReport")?.addEventListener("click", () => runHealthExportAction("report", "admin"));
  document.getElementById("adminExportHealthWarnings")?.addEventListener("click", () => runHealthExportAction("warnings", "admin"));
  document.getElementById("adminExportHealthErrors")?.addEventListener("click", () => runHealthExportAction("errors", "admin"));
  document.getElementById("adminDownloadHealthLog")?.addEventListener("click", () => runHealthExportAction("log", "admin"));
  window.addEventListener("beforeprint", fitPrintCardsToLetter);
  document.getElementById("startEditing")?.addEventListener("click", () => {
    startEditingSession();
    renderAll();
    setView("manage");
  });
  document.getElementById("discardWorkingCopy")?.addEventListener("click", () => {
    if(!window.confirm("Discard the current working copy and return to the last saved/downloaded snapshot?")) return;
    discardWorkingChanges();
    renderAll();
  });
  document.getElementById("resetWorkingCopy")?.addEventListener("click", () => {
    resetWorkingCopyFromPublished();
    renderAll();
  });
  document.getElementById("undoEdit")?.addEventListener("click", () => { if(!undoLastEdit() && typeof undoAssetEdit === "function") undoAssetEdit(); runDatabaseHealth(); renderAll(); });
  document.getElementById("redoEdit")?.addEventListener("click", () => { if(!redoLastEdit() && typeof redoAssetEdit === "function") redoAssetEdit(); runDatabaseHealth(); renderAll(); });
  document.getElementById("changeTypeFilter")?.addEventListener("change", event => { editingSessionState().changeFilter = event.target.value; renderChangeReview(); });
  document.getElementById("personaEditorSearch")?.addEventListener("input", renderPersonaEditor);
  document.getElementById("personaCreateNew")?.addEventListener("click", createNewPersonaEditor);
  document.getElementById("personaCreateFromExisting")?.addEventListener("click", startPersonaCreateFromExisting);
  document.getElementById("personaViewExisting")?.addEventListener("click", startPersonaViewExisting);
  document.getElementById("personaCreateUpdatedVersion")?.addEventListener("click", createUpdatedVersionPersonaEditor);
  document.getElementById("personaDuplicate")?.addEventListener("click", duplicateSelectedPersonaEditor);
  document.getElementById("personaActivate")?.addEventListener("click", () => statusSelectedPersonaEditor("Active"));
  document.getElementById("personaDeactivate")?.addEventListener("click", () => statusSelectedPersonaEditor("Inactive"));
  document.getElementById("personaMarkDeleted")?.addEventListener("click", deleteSelectedPersonaEditor);
  document.getElementById("personaEditAnyway")?.addEventListener("click", editActivePersonaAnyway);
  document.getElementById("personaEditorSave")?.addEventListener("click", savePersonaEditor);
  document.getElementById("personaEditorCancel")?.addEventListener("click", startPersonaViewExisting);
  document.getElementById("personaEditorSchedule")?.addEventListener("click", savePersonaEditor);
  document.getElementById("speedOptionCreateNew")?.addEventListener("click", createSpeedOptionEditor);
  document.getElementById("speedOptionDuplicate")?.addEventListener("click", duplicateSelectedSpeedOptionEditor);
  document.getElementById("speedOptionActivate")?.addEventListener("click", () => activeSelectedSpeedOptionEditor(true));
  document.getElementById("speedOptionDeactivate")?.addEventListener("click", () => activeSelectedSpeedOptionEditor(false));
  document.getElementById("speedOptionMoveUp")?.addEventListener("click", () => moveSelectedSpeedOptionEditor(-1));
  document.getElementById("speedOptionMoveDown")?.addEventListener("click", () => moveSelectedSpeedOptionEditor(1));
  document.getElementById("speedOptionRemove")?.addEventListener("click", removeSelectedSpeedOptionEditor);
  document.getElementById("speedOptionEditorSave")?.addEventListener("click", saveSpeedOptionEditor);
  document.getElementById("pricingScheduleSelect")?.addEventListener("change", event => { editorSelectedScheduleID = event.target.value; renderPricingScheduleEditor(); });
  document.getElementById("pricingScheduleAddRow")?.addEventListener("click", addPricingEditorRow);
  document.getElementById("pricingScheduleCreateNew")?.addEventListener("click", createPricingScheduleEditor);
  document.getElementById("pricingScheduleSave")?.addEventListener("click", savePricingScheduleEditor);
  document.getElementById("pricingStructureType")?.addEventListener("change", () => renderPricingSchedulePreview(document.getElementById("pricingSchedulePreview")));
  document.getElementById("pricingScheduleEditorForm")?.addEventListener("input", () => renderPricingSchedulePreview(document.getElementById("pricingSchedulePreview")));
  document.getElementById("modifierCreateNew")?.addEventListener("click", createModifierEditor);
  document.getElementById("modifierActivate")?.addEventListener("click", () => activeSelectedModifierEditor(true));
  document.getElementById("modifierDeactivate")?.addEventListener("click", () => activeSelectedModifierEditor(false));
  document.getElementById("modifierEditorSave")?.addEventListener("click", saveModifierEditor);
  document.getElementById("personaModifierAdd")?.addEventListener("click", addPersonaModifierEditor);
  document.getElementById("disclaimerEditorSave")?.addEventListener("click", saveDisclaimerEditor);
  document.getElementById("disclaimerDuplicate")?.addEventListener("click", duplicateDisclaimerEditor);
  document.getElementById("disclaimerEditorForm")?.addEventListener("input", () => renderDisclaimerPreviewAndUsage(disclaimerEditorDraft()));
  window.addEventListener("beforeunload", event => {
    if(!editingHasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("afterprint", () => {
    resetPrintScaling();
    removeDedicatedPrintDocument();
    restorePrintDocumentTitle();
  });

  // Try published database on load. If local browser blocks fetch, user can still upload workbook.
  try{
    await loadBundledDatabase();
    renderAll();
  }catch(err){
    console.warn(err);
  }
});

function downloadUpdatedJson(){
  try{
    if(hasBlockingHealthErrors()){
      const ok = window.confirm("Database health includes BAD/Error rows. Download persona-db.json anyway?");
      if(!ok) return;
    }
    const blob = new Blob([updatedDatabaseJson()], {type:"application/json"});
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = "persona-db.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    const instructions = document.getElementById("downloadInstructions");
    if(instructions) instructions.hidden = false;
    if(typeof markWorkingCopyDownloaded === "function") markWorkingCopyDownloaded();
    renderAll();
  }catch(err){
    alert(err.message);
  }
}

async function downloadPublishingPackage(){
  try{
    if(!databaseHealthReviewed()){
      alert("Review Database Health before creating a v2 publishing package. Open Admin > Database Health, inspect results, then click Mark Health Reviewed.");
      setView("admin");
      setAdminSection("health", {focus:true});
      return;
    }
    const summary = currentBuildSummary();
    let overrideHealthErrors = false;
    if(summary.healthErrors){
      overrideHealthErrors = window.confirm(`Database Health contains ${summary.healthErrors} BAD/Error result(s). Normal publication is blocked. Create an override package anyway?`);
      if(!overrideHealthErrors) return;
    }else if(summary.healthWarnings){
      if(!window.confirm(`Database Health contains ${summary.healthWarnings} warning(s). Continue packaging?`)) return;
    }
    const blob = await publishingPackageBlob({overrideHealthErrors});
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = publishingPackageFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    alert("Review the downloaded package, then commit the included database, assets, reports, and release notes to GitHub. Never modify the published site directly.");
    if(typeof markWorkingCopyDownloaded === "function") markWorkingCopyDownloaded();
    renderAll();
  }catch(err){
    alert(err.message);
  }
}


function downloadDatabaseWorkbook(source){
  try{
    const healthRows = typeof workbookHealthRows === "function" ? workbookHealthRows(sourceRawForWorkbook(source)) : buildHealth();
    const health = typeof workbookHealthCounts === "function" ? workbookHealthCounts(healthRows) : {errors:0, warnings:0};
    const status = document.getElementById("workbookExportStatus");
    let confirmedHealthErrors = false;
    if(source === "working" && health.errors > 0){
      confirmedHealthErrors = window.confirm(`The working copy has ${health.errors} health error(s). Export a backup workbook anyway?`);
      if(!confirmedHealthErrors) return;
    }else if(health.warnings > 0 && status){
      status.textContent = `Export includes ${health.warnings} health warning(s).`;
    }
    const date = new Date();
    const bytes = databaseWorkbookBytes(source, {date, confirmedHealthErrors});
    const blob = new Blob([bytes], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = databaseWorkbookFilename(source, date);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if(status) status.textContent = `Downloaded ${link.download}`;
  }catch(err){
    alert(err.message);
  }
}
