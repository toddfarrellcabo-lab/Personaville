const ASSET_MANAGER_FILES = [
  {filename:"icon-3MonthsFree.png", path:"assets/icons/icon-3MonthsFree.png", category:"Promotion Icons", active:true},
  {filename:"icon-PriceLock.png", path:"assets/icons/icon-PriceLock.png", category:"Promotion Icons", active:true},
  {filename:"icon-Standard.png", path:"assets/icons/icon-Standard.png", category:"Promotion Icons", active:true},
  {filename:"icon-Gig40.png", path:"assets/icons/icon-Gig40.png", category:"Modifier Icons", active:true},
  {filename:"icon-Equipment.png", path:"assets/icons/icon-Equipment.png", category:"Modifier Icons", active:true},
  {filename:"icon-Symmetrical.png", path:"assets/icons/icon-Symmetrical.png", category:"Modifier Icons", active:true},
  {filename:"personaville-header.png", path:"assets/images/personaville-header.png", category:"Hero Images", active:true}
];
const ASSET_CATEGORIES = ["Promotion Icons", "Modifier Icons", "Hero Images", "Supporting Images"];
const ASSET_FILTERS = ["All", "Used", "Unused", "Missing", "Staged", "Inactive"];
const ASSET_EXTENSIONS = ["png","jpg","jpeg","webp","svg"];
const ASSET_MIME_TYPES = {png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", svg:"image/svg+xml"};
const ASSET_MAX_BYTES = 5 * 1024 * 1024;
const ASSET_MAX_DIMENSION = 6000;
const AssetManager = {view:"grid", category:"All", usageFilter:"All", query:"", selected:"", staged:[], meta:{}, history:[], historyIndex:-1};

function assetExt(name){ return String(name||"").split(".").pop().toLowerCase(); }
function assetType(name){ return assetExt(name).toUpperCase() || "Unknown"; }
function assetFolderFor(category){ return ["Hero Images","Supporting Images"].includes(category) ? "assets/images/" : "assets/icons/"; }
function normalizeAssetFilename(name){ return String(name||"").trim().replace(/^.*[\\/]/, ""); }
function assetKey(asset){ return asset?.stagedId || asset?.path || asset?.filename; }
function canonicalAssetCategory(category){ const found=ASSET_CATEGORIES.find(c=>c.toLowerCase()===String(category||"").toLowerCase()); return found || "Supporting Images"; }
function assetMetaFor(filename){ return AssetManager.meta[filename.toLowerCase()] || {}; }
function safeAssetFilename(filename){ return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) && !filename.includes("..") && ASSET_EXTENSIONS.includes(assetExt(filename)); }
function assetDataUrl(asset){ return asset?.dataUrl || asset?.objectUrl || asset?.path || ""; }
function isAssetInactive(asset){ return assetMetaFor(asset.filename).active === false || asset.retired; }
function existingAssetNames(except=""){ return new Set(assetRecords().filter(a=>a.filename.toLowerCase()!==String(except).toLowerCase()).map(a=>a.filename.toLowerCase())); }
function assetByteLabel(bytes){ if(!bytes && bytes!==0) return "Unknown"; return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(2)} MB`; }
function sanitizeSvgText(text){ if(/<script|<foreignObject|on\w+\s*=|javascript:|data:text\/html/i.test(text)) throw new Error("SVG contains unsafe script, event, or embedded HTML content."); return text; }
function dataUrlToText(dataUrl){ const body=String(dataUrl).split(",")[1] || ""; return decodeURIComponent(escape(atob(body))); }
function readFileAsDataUrl(file){ return new Promise((res,rej)=>{const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file);}); }
function imageDimensionsFromUrl(url){ return new Promise((res)=>{ if(!url || assetExt(url)==="svg") return res({width:"SVG", height:"SVG"}); const img=new Image(); img.onload=()=>res({width:img.naturalWidth,height:img.naturalHeight}); img.onerror=()=>res({width:"Unknown",height:"Unknown"}); img.src=url; }); }
function validateAssetFile(file, filename){ const ext=assetExt(filename); if(!safeAssetFilename(filename)) throw new Error("Use a safe filename with letters, numbers, dashes, underscores, dots, and PNG/JPG/JPEG/WEBP/SVG extension."); if(file.size > ASSET_MAX_BYTES) throw new Error("Asset is larger than the 5 MB browser staging limit."); const expected=ASSET_MIME_TYPES[ext]; if(file.type && expected && file.type !== expected) throw new Error(`MIME type ${file.type} does not match .${ext}.`); }
function pushAssetHistory(reason){ AssetManager.history=AssetManager.history.slice(0,AssetManager.historyIndex+1); AssetManager.history.push({reason, staged:AssetManager.staged.map(a=>({...a})), meta:JSON.parse(JSON.stringify(AssetManager.meta))}); AssetManager.historyIndex=AssetManager.history.length-1; }
function restoreAssetHistory(offset){ const next=AssetManager.historyIndex+offset; if(next<0||next>=AssetManager.history.length) return false; AssetManager.historyIndex=next; const snap=AssetManager.history[next]; AssetManager.staged=snap.staged.map(a=>({...a})); AssetManager.meta=JSON.parse(JSON.stringify(snap.meta)); renderAll(); return true; }
function undoAssetEdit(){ return restoreAssetHistory(-1); }
function redoAssetEdit(){ return restoreAssetHistory(1); }

function assetUsage(){
  const uses = new Map(); const add=(file, record)=>{ const f=normalizeIconFile(file).toLowerCase(); if(!f) return; if(!uses.has(f)) uses.set(f, []); uses.get(f).push(record); };
  DB.icons.forEach(i=>add(i.FileName,{type:"Icon table", id:i.IconID, name:i.IconName, field:"FileName"}));
  DB.personas.forEach(p=>add(p.PromoIcon,{type:"Persona", id:p.PersonaID, name:p.PersonaName, field:"PromoIcon"}));
  DB.modifiers.forEach(m=>add(m.IconFile,{type:"Modifier", id:m.ModifierID, name:m.ModifierName, field:"IconFile"}));
  (activeDatabaseSnapshot()[SHEET_MAP.pricingSets] || []).forEach(ps=>add(ps.DefaultIcon,{type:"Pricing Set", id:ps.PricingSetID, name:ps.PricingSetName, field:"DefaultIcon"}));
  return uses;
}
function assetRecords(){
  const usage = assetUsage(); const listed = ASSET_MANAGER_FILES.concat(AssetManager.staged).map(asset=>{ const meta=assetMetaFor(asset.filename); return {...asset, ...meta, displayName:meta.displayName || asset.displayName || asset.filename.replace(/\.[^.]+$/, ""), altText:meta.altText || asset.altText || "", description:meta.description || asset.description || "", tags:meta.tags || asset.tags || "", active:meta.active !== false && asset.active !== false, type:assetType(asset.filename), staged:Boolean(asset.stagedId), uses:usage.get(asset.filename.toLowerCase())||[]}; });
  const known = new Set(listed.map(a=>a.filename.toLowerCase()));
  usage.forEach((records, filename)=>{ if(!known.has(filename)) listed.push({filename, path:assetFolderFor("Promotion Icons") + filename, category:"Missing", type:assetType(filename), missing:true, active:false, uses:records}); });
  return listed;
}
function filteredAssets(){ const q=AssetManager.query.toLowerCase(); return assetRecords().filter(a=>(AssetManager.category==="All" || a.category===AssetManager.category || (AssetManager.category==="All" && a.missing)) && (!q || [a.filename,a.displayName,a.tags].join(" ").toLowerCase().includes(q)) && (AssetManager.usageFilter==="All" || (AssetManager.usageFilter==="Used"&&a.uses.length) || (AssetManager.usageFilter==="Unused"&&!a.uses.length&&!a.missing) || (AssetManager.usageFilter==="Missing"&&a.missing) || (AssetManager.usageFilter==="Staged"&&a.staged) || (AssetManager.usageFilter==="Inactive"&&isAssetInactive(a)))); }
function renderAssetManager(){
  const root=document.getElementById("assetManagerRoot"); if(!root) return; if(!AssetManager.history.length) pushAssetHistory("initial");
  const assets=filteredAssets(); const selected=assetRecords().find(a=>assetKey(a)===AssetManager.selected) || assets[0]; if(selected) AssetManager.selected=assetKey(selected);
  root.innerHTML="";
  root.appendChild(el("div",{class:"asset-manager-toolbar"},[
    el("input",{class:"search",type:"search",placeholder:"Search filenames, names, tags",value:AssetManager.query,oninput:e=>{AssetManager.query=e.target.value;renderAssetManager();}}),
    el("select",{onchange:e=>{AssetManager.category=e.target.value;renderAssetManager();}},["All",...ASSET_CATEGORIES].map(c=>el("option",{value:c,selected:c===AssetManager.category},[c]))),
    el("select",{onchange:e=>{AssetManager.usageFilter=e.target.value;renderAssetManager();}},ASSET_FILTERS.map(c=>el("option",{value:c,selected:c===AssetManager.usageFilter},[c]))),
    el("button",{class:`btn ${AssetManager.view==="grid"?"primary":""}`,type:"button",onclick:()=>{AssetManager.view="grid";renderAssetManager();}},["Grid"]),
    el("button",{class:`btn ${AssetManager.view==="list"?"primary":""}`,type:"button",onclick:()=>{AssetManager.view="list";renderAssetManager();}},["List"]),
    el("button",{class:"btn",type:"button",onclick:createNewAsset},["New Asset"]),
    el("label",{class:"btn primary"},["Upload Asset", el("input",{type:"file",accept:".png,.jpg,.jpeg,.webp,.svg",hidden:true,onchange:stageAssetUpload})]),
    el("button",{class:"btn",type:"button",onclick:undoAssetEdit,disabled:AssetManager.historyIndex<=0},["Undo Asset"]),
    el("button",{class:"btn",type:"button",onclick:redoAssetEdit,disabled:AssetManager.historyIndex>=AssetManager.history.length-1},["Redo Asset"])
  ]));
  root.appendChild(el("div",{class:"asset-manager-note"},["Uploads are staged in browser memory only, appear in Change Review, support undo/redo, and are included in publishing packages. They are not uploaded to GitHub by the app."]));
  root.appendChild(el("div",{class:"asset-manager-summary"},[
    el("span",{class:"pill gray"},[`${assets.length} shown`]), el("span",{class:"pill gray"},[`${assetRecords().filter(a=>!a.missing&&!a.uses.length).length} unused`]), el("span",{class:"pill gray"},[`${assetRecords().filter(a=>a.missing).length} missing`]), el("span",{class:"pill gray"},[`${AssetManager.staged.length} staged`]), el("span",{class:"pill gray"},[`${assetRecords().filter(isAssetInactive).length} inactive`])
  ]));
  const browser=el("div",{class:"asset-manager-browser"}); const list=el("div",{class:`asset-list ${AssetManager.view}`}); assets.forEach(a=>list.appendChild(assetCard(a))); browser.append(list, assetDetail(selected)); root.appendChild(browser);
}
function assetCard(a){ return el("button",{class:`asset-card ${AssetManager.view} ${assetKey(a)===AssetManager.selected?"selected":""} ${a.missing?"missing":""}`,type:"button",onclick:()=>{AssetManager.selected=assetKey(a);renderAssetManager();}},[assetThumb(a), el("strong",{},[a.displayName || a.filename]), el("span",{class:"muted"},[`${a.filename} • ${a.category} • ${a.type}`]), el("span",{class:`pill ${a.missing?"bad":a.staged?"warn":a.uses.length?"ok":"gray"}`},[a.missing?"Missing":a.staged?"Staged":a.uses.length?`${a.uses.length} uses`:"Unused"])]); }
function assetThumb(a){ return el("div",{class:"asset-thumb"},[a.missing?el("span",{},["Missing"]):el("img",{src:assetDataUrl(a),alt:a.altText||"",loading:"lazy",onload:e=>{const m=e.currentTarget.closest(".asset-card,.asset-detail"); const d=m?.querySelector("[data-dimensions]"); if(d) d.textContent=`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`;},onerror:e=>{e.currentTarget.replaceWith(el("span",{},["Preview unavailable"]));}})]); }
function assetDetail(a){ if(!a) return el("aside",{class:"asset-detail empty-state-panel"},["No assets found."]); return el("aside",{class:"asset-detail"},[
  assetThumb(a), el("h3",{},[a.displayName || a.filename]), assetMetadataForm(a),
  el("h4",{},["Database usage"]), a.uses.length?el("ul",{class:"asset-usage"},a.uses.map(u=>el("li",{},[`${u.type} ${u.id}: ${u.name||"Unnamed"} (${u.field})`]))):el("p",{class:"muted"},["No database records use this asset."]),
  el("h4",{},["Assign asset"]), assignmentControls(a), el("h4",{},["Replace / retire"]), assetLifecycleControls(a)
]); }
function assetMetadataForm(a){ const field=(label,name,value,control="input")=>el("label",{class:"asset-field"},[el("span",{},[label]), control==="textarea"?el("textarea",{rows:2,value:value||"",onchange:e=>saveAssetMeta(a,{[name]:e.target.value})},[]):el("input",{value:value||"",onchange:e=>saveAssetMeta(a,{[name]:e.target.value})})]); return el("div",{class:"asset-editor"},[
  field("Display Name","displayName",a.displayName), field("Filename","filename",a.filename), el("label",{class:"asset-field"},[el("span",{},["Category"]), el("select",{value:a.category,onchange:e=>saveAssetMeta(a,{category:e.target.value})},ASSET_CATEGORIES.map(c=>el("option",{value:c,selected:c===a.category},[c])))]),
  field("Alt Text","altText",a.altText), field("Description","description",a.description,"textarea"), field("Tags","tags",a.tags), el("label",{class:"choice-pill"},[el("input",{type:"checkbox",checked:a.active!==false,onchange:e=>saveAssetMeta(a,{active:e.target.checked})}), el("span",{},[a.active!==false?"Active":"Inactive"])]),
  el("dl",{class:"asset-meta"},[el("dt",{},["Path"]),el("dd",{},[a.path]),el("dt",{},["Size"]),el("dd",{},[assetByteLabel(a.size)]),el("dt",{},["Dimensions"]),el("dd",{"data-dimensions":""},[a.missing?"Missing":"Loading…"]),el("dt",{},["Status"]),el("dd",{},[a.missing?"Missing reference":a.staged?"Staged working-copy asset":a.uses.length?"Used":"Unused"] )])
]); }
function saveAssetMeta(a, patch){ if(a.missing) return; if(patch.filename && (!safeAssetFilename(patch.filename) || existingAssetNames(a.filename).has(patch.filename.toLowerCase()))) return alert("Choose a safe, unique filename."); const key=a.filename.toLowerCase(); const next={...assetMetaFor(a.filename), ...patch}; if(patch.filename){ next.filename=patch.filename; const staged=AssetManager.staged.find(x=>x.filename===a.filename); if(staged){ staged.filename=patch.filename; staged.path=assetFolderFor(staged.category)+patch.filename; } delete AssetManager.meta[key]; AssetManager.meta[patch.filename.toLowerCase()]=next; AssetManager.selected=assetKey(staged || {...a, filename:patch.filename}); } else AssetManager.meta[key]=next; pushAssetHistory("metadata"); renderAssetManager(); }
function assignmentControls(a){ if(a.missing) return el("p",{class:"muted"},["Add the missing file before assignment."]); const persona=el("select",{},DB.personas.map(p=>el("option",{value:p.PersonaID},[`${p.PersonaID} — ${p.PersonaName}`]))); const mod=el("select",{},DB.modifiers.map(m=>el("option",{value:m.ModifierID},[`${m.ModifierID} — ${m.ModifierName}`]))); const pricingRows=activeDatabaseSnapshot()[SHEET_MAP.pricingSets] || []; const pricing=el("select",{},pricingRows.map(ps=>el("option",{value:ps.PricingSetID},[`${ps.PricingSetID} — ${ps.PricingSetName||ps.PricingSetID}`]))); return el("div",{class:"asset-assign"},[persona, el("button",{class:"btn",type:"button",onclick:()=>assignPersonaAsset(persona.value,a.filename)},["Assign to Persona PromoIcon"]), mod, el("button",{class:"btn",type:"button",onclick:()=>assignModifierAsset(mod.value,a.filename)},["Assign to Modifier IconFile"]), pricing, el("button",{class:"btn",type:"button",onclick:()=>assignPricingAsset(pricing.value,a.filename),disabled:!pricingRows.length},["Assign to Pricing DefaultIcon"])]); }
function assetLifecycleControls(a){ if(a.missing) return el("p",{class:"muted"},["Resolve missing assets by uploading a matching filename."]); return el("div",{class:"asset-assign"},[el("label",{class:"btn"},["Replace Asset",el("input",{type:"file",accept:".png,.jpg,.jpeg,.webp,.svg",hidden:true,onchange:e=>replaceAssetUpload(e,a)})]), el("button",{class:"btn",type:"button",onclick:()=>retireAsset(a)},["Retire Asset"]), el("button",{class:"btn",type:"button",onclick:()=>deleteAsset(a),disabled:a.uses.length>0},["Delete Unused Staged Asset"])]); }
async function stageValidatedAsset(file, desiredCategory, replacing){ const filename=normalizeAssetFilename(replacing?.filename || file.name); validateAssetFile(file, filename); const ext=assetExt(filename); let dataUrl=await readFileAsDataUrl(file); if(ext==="svg") sanitizeSvgText(dataUrlToText(dataUrl)); const objectUrl=URL.createObjectURL(file); const dims=await imageDimensionsFromUrl(objectUrl); if(Number(dims.width)>ASSET_MAX_DIMENSION || Number(dims.height)>ASSET_MAX_DIMENSION) throw new Error("Image dimensions exceed 6000px."); const category=canonicalAssetCategory(desiredCategory || replacing?.category || (filename.toLowerCase().startsWith("icon-")?"Promotion Icons":"Supporting Images")); const staged={stagedId:`staged:${Date.now()}:${filename}`, filename, path:assetFolderFor(category)+filename, category, size:file.size, objectUrl, dataUrl, width:dims.width, height:dims.height, replacing:replacing?.path || ""}; AssetManager.staged=AssetManager.staged.filter(a=>a.filename.toLowerCase()!==filename.toLowerCase()); AssetManager.staged.push(staged); AssetManager.selected=staged.stagedId; pushAssetHistory(replacing?"replace":"upload"); renderAll(); }
async function stageAssetUpload(e){ const file=e.target.files?.[0]; e.target.value=""; if(!file) return; try{ const filename=normalizeAssetFilename(file.name); const collision=existingAssetNames().has(filename.toLowerCase()); if(collision && !confirm(`Replace existing filename ${filename}? The old/new previews, dimensions, sizes, and affected records are shown after staging. This does not upload to GitHub.`)) return; await stageValidatedAsset(file, null, collision ? assetRecords().find(a=>a.filename.toLowerCase()===filename.toLowerCase()) : null); }catch(err){ alert(err.message); } }
async function replaceAssetUpload(e,a){ const file=e.target.files?.[0]; e.target.value=""; if(!file) return; if(!confirm(`Replace ${a.filename}?\nOld size: ${assetByteLabel(a.size)}\nAffected records: ${a.uses.length}\nUndo is available before publishing.`)) return; try{ await stageValidatedAsset(file, a.category, a); }catch(err){ alert(err.message); } }
function createNewAsset(){ const name=prompt("New asset filename (PNG, JPG, JPEG, WEBP, or sanitized SVG):"); if(!name) return; const filename=normalizeAssetFilename(name); if(!safeAssetFilename(filename) || existingAssetNames().has(filename.toLowerCase())) return alert("Choose a safe, unique filename."); const category=canonicalAssetCategory(prompt("Category: Promotion Icons, Modifier Icons, Hero Images, or Supporting Images", "Supporting Images")); AssetManager.staged.push({stagedId:`staged:${Date.now()}:${filename}`, filename, path:assetFolderFor(category)+filename, category, size:0, dataUrl:"", placeholder:true}); AssetManager.selected=AssetManager.staged.at(-1).stagedId; pushAssetHistory("new"); renderAll(); }
function retireAsset(a){ if(a.uses.length && !confirm(`${a.filename} is used by ${a.uses.length} record(s). Retire it only after reassignment. Continue?`)) return; saveAssetMeta(a,{active:false, retiredAt:new Date().toISOString()}); }
function deleteAsset(a){ if(a.uses.length) return alert("Reassign in-use assets before deletion. Prefer Retire for published assets."); if(!a.staged) return alert("Published assets are retired, not deleted, from this static editor."); AssetManager.staged=AssetManager.staged.filter(x=>assetKey(x)!==assetKey(a)); pushAssetHistory("delete"); renderAll(); }
function assignPersonaAsset(id, filename){ const p=DB.personas.find(x=>x.PersonaID===id); if(!p) return; savePersonaDraft({...p, PromoIcon:filename}, id, "Asset Manager"); renderAll(); }
function assignModifierAsset(id, filename){ const m=DB.modifiers.find(x=>x.ModifierID===id); if(!m) return; saveModifierDraft({...m, IconFile:filename}, id); renderAll(); }
function assignPricingAsset(id, filename){ if(!id) return; if(!EditingSession.isEditing) startEditingSession(); const raw=activeDatabaseSnapshot(); const rows=Array.isArray(raw[SHEET_MAP.pricingSets])?raw[SHEET_MAP.pricingSets]:[]; const row=rows.find(x=>x.PricingSetID===id); if(!row) return; row.DefaultIcon=normalizeIconFile(filename); updateWorkingCopy(raw,"asset-assignment",{sheet:SHEET_MAP.pricingSets, PricingSetID:id, field:"DefaultIcon"}); renderAll(); }
function downloadAssetPublishingPackage(){ return downloadPublishingPackage(); }
