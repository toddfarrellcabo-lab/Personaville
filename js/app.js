
function setView(name, options = {}){
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
  setView("personas", {focus:false});
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
  document.getElementById("loadBundled").addEventListener("click", async ()=>{
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
  document.getElementById("clearSelection").addEventListener("click", resetPersonaDetail);
  document.getElementById("clearFilters").addEventListener("click", clearPersonaFilters);
  document.getElementById("clearFamilyGroup").addEventListener("click", clearFamilyGroupFilter);
  document.getElementById("exportPersona").addEventListener("change", renderPrintArea);
  document.getElementById("selectAllVisible").addEventListener("click", selectAllVisiblePersonas);
  document.getElementById("clearExportSelection").addEventListener("click", clearExportSelection);
  document.getElementById("printPersona").addEventListener("click", ()=>window.print());
  document.getElementById("savePdf").addEventListener("click", ()=>window.print());
  document.getElementById("copySummary").addEventListener("click", copySelectedSummary);
  window.addEventListener("beforeprint", fitPrintCardsToLetter);
  window.addEventListener("afterprint", resetPrintScaling);

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
    renderPublishPanel();
  }catch(err){
    alert(err.message);
  }
}
