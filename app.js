/**
 * Arana CRM Offline (PWA) — no server, no fees.
 * Data: IndexedDB. UI: vanilla JS.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    "id-" + Math.random().toString(16).slice(2) + "-" + Date.now();
}
function nowMs(){ return Date.now(); }
function fmtDate(ms){
  if(!ms) return "-";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

class DB {
  constructor(){ this.db = null; }
  open(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("arana_crm_pwa", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const mk = (name, keyPath) => db.createObjectStore(name, { keyPath });
        mk("stages","id").createIndex("ord","ord",{unique:false});
        mk("contacts","id").createIndex("updatedAt","updatedAt",{unique:false});
        mk("deals","id").createIndex("updatedAt","updatedAt",{unique:false});
        mk("activities","id").createIndex("createdAt","createdAt",{unique:false});
        mk("stageHistory","id").createIndex("createdAt","createdAt",{unique:false});
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }
  tx(names, mode="readonly"){ return this.db.transaction(names, mode); }
  async getAll(store, index=null, dir="next"){
    return new Promise((resolve,reject)=>{
      const tx = this.tx([store]);
      const s = tx.objectStore(store);
      if(index){
        const req = s.index(index).openCursor(null, dir);
        const out=[];
        req.onsuccess = () => {
          const c = req.result;
          if(!c){ resolve(out); return; }
          out.push(c.value); c.continue();
        };
        req.onerror = () => reject(req.error);
      } else {
        const req = s.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }
    });
  }
  async put(store, obj){
    return new Promise((resolve,reject)=>{
      const tx = this.tx([store],"readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async get(store, id){
    return new Promise((resolve,reject)=>{
      const tx = this.tx([store]);
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async clear(store){
    return new Promise((resolve,reject)=>{
      const tx = this.tx([store],"readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

const db = new DB();
const state = {
  tab: "pipeline",
  stageId: null,
  closedStatus: "won",
  cache: { stages:[], contacts:[], deals:[], activities:[], stageHistory:[] }
};

async function seedIfEmpty(){
  const stages = await db.getAll("stages","ord","next");
  if(stages.length>0) return;
  const defaults = [
    {name:"1. Potensial Prospek", ord:0},
    {name:"2. Meet/Discovery", ord:1},
    {name:"3. Proposal/Penawaran", ord:2},
    {name:"4. Follow-up/Negosiasi", ord:3},
  ];
  for(const s of defaults){
    await db.put("stages", {id:uid(), name:s.name, ord:s.ord});
  }
}

async function loadCache(){
  state.cache.stages = await db.getAll("stages","ord","next");
  state.cache.contacts = await db.getAll("contacts","updatedAt","prev");
  state.cache.deals = await db.getAll("deals","updatedAt","prev");
  state.cache.activities = await db.getAll("activities","createdAt","prev");
  state.cache.stageHistory = await db.getAll("stageHistory","createdAt","prev");
  if(!state.stageId && state.cache.stages.length) state.stageId = state.cache.stages[0].id;
}

function toast(msg){
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position="fixed";
  el.style.left="50%";
  el.style.bottom="18px";
  el.style.transform="translateX(-50%)";
  el.style.padding="10px 12px";
  el.style.border="1px solid var(--line)";
  el.style.background="rgba(17,27,52,.92)";
  el.style.borderRadius="12px";
  el.style.zIndex="999";
  document.body.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 2000);
}

function switchTab(tab){
  state.tab = tab;
  $$(".tab").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  $$(".panel").forEach(p=>p.classList.toggle("active", p.id===`tab-${tab}`));
  render();
}

function renderStageChips(){
  const host = $("#stageChips");
  host.innerHTML="";
  for(const s of state.cache.stages){
    const b = document.createElement("button");
    b.className = "chip" + (s.id===state.stageId ? " active":"");
    b.textContent = s.name;
    b.onclick = ()=>{ state.stageId = s.id; render(); };
    host.appendChild(b);
  }
}

function renderPipeline(){
  renderStageChips();
  const list = $("#pipelineList");
  const empty = $("#pipelineEmpty");
  list.innerHTML="";
  const deals = state.cache.deals.filter(d => d.status==="open" && d.stageId===state.stageId);
  if(!deals.length){ empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  for(const d of deals){
    const contact = state.cache.contacts.find(c=>c.id===d.contactId);
    const sub = [
      contact ? contact.name : null,
      d.value ? `Value: ${d.value}` : null,
      d.expectedCloseAt ? `Close: ${fmtDate(d.expectedCloseAt)}` : null
    ].filter(Boolean).join(" • ");

    const item = document.createElement("div");
    item.className="item";
    item.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(d.title)}</div>
        <div class="itemSub">${escapeHtml(sub || "-")}</div>
      </div>
      <div class="itemRight">
        <span class="badge">OPEN</span>
        <button class="ghost">Detail →</button>
      </div>
    `;
    item.querySelector("button").onclick = ()=> openDealModal(d.id);
    list.appendChild(item);
  }
}

function renderContacts(){
  const q = ($("#contactSearch").value||"").trim().toLowerCase();
  const list = $("#contactsList");
  const empty = $("#contactsEmpty");
  list.innerHTML="";
  let contacts = state.cache.contacts;
  if(q){
    contacts = contacts.filter(c => (c.name||"").toLowerCase().includes(q)
      || (c.phone||"").toLowerCase().includes(q)
      || (c.email||"").toLowerCase().includes(q)
      || (c.company||"").toLowerCase().includes(q));
  }
  if(!contacts.length){ empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  for(const c of contacts){
    const sub = [c.company, c.phone, c.email].filter(Boolean).join(" • ");
    const item = document.createElement("div");
    item.className="item";
    item.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(c.name)}</div>
        <div class="itemSub">${escapeHtml(sub || "-")}</div>
      </div>
      <div class="itemRight">
        <button class="ghost">Edit →</button>
      </div>
    `;
    item.querySelector("button").onclick = ()=> openContactModal(c.id);
    list.appendChild(item);
  }
}

function renderClosed(){
  const list = $("#closedList");
  const empty = $("#closedEmpty");
  list.innerHTML="";
  const deals = state.cache.deals.filter(d => d.status===state.closedStatus);
  if(!deals.length){ empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  for(const d of deals){
    const item = document.createElement("div");
    item.className="item";
    const badge = d.status.toUpperCase();
    const sub = d.status==="lost" ? (d.lostReason || "-") : (d.wonAt ? `Won at: ${fmtDate(d.wonAt)}` : "-");
    item.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(d.title)}</div>
        <div class="itemSub">${escapeHtml(sub)}</div>
      </div>
      <div class="itemRight">
        <span class="badge">${badge}</span>
        <button class="ghost">Detail →</button>
      </div>
    `;
    item.querySelector("button").onclick = ()=> openDealModal(d.id);
    list.appendChild(item);
  }
}

function renderStagesAdmin(){
  const host = $("#stagesAdmin");
  host.innerHTML="";
  const stages = state.cache.stages;

  for(let i=0;i<stages.length;i++){
    const s = stages[i];
    const row = document.createElement("div");
    row.className="item";
    row.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(s.name)}</div>
        <div class="itemSub">Order: ${s.ord}</div>
      </div>
      <div class="itemRight">
        <div style="display:flex; gap:6px;">
          <button class="ghost" ${i===0?"disabled":""}>↑</button>
          <button class="ghost" ${i===stages.length-1?"disabled":""}>↓</button>
          <button class="ghost">Rename</button>
        </div>
      </div>
    `;
    const [up,down,ren] = row.querySelectorAll("button");
    up.onclick = async ()=> { if(i===0) return; await swapStageOrd(stages[i], stages[i-1]); };
    down.onclick = async ()=> { if(i===stages.length-1) return; await swapStageOrd(stages[i], stages[i+1]); };
    ren.onclick = async ()=> {
      const name = prompt("Rename stage:", s.name);
      if(!name || !name.trim()) return;
      await db.put("stages", {...s, name:name.trim()});
      await refresh();
    };
    host.appendChild(row);
  }
}

async function swapStageOrd(a,b){
  await db.put("stages", {...a, ord:b.ord});
  await db.put("stages", {...b, ord:a.ord});
  await refresh();
}

function render(){
  if(state.tab==="pipeline") renderPipeline();
  if(state.tab==="contacts") renderContacts();
  if(state.tab==="closed") renderClosed();
  if(state.tab==="settings") renderStagesAdmin();
}

function openModal(title, html){
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal(){
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML="";
}

async function openContactModal(contactId=null){
  const c = contactId ? await db.get("contacts", contactId) : null;
  openModal(contactId ? "Edit Contact" : "New Contact", `
    <div class="grid2">
      <div><div class="label">Name *</div><input id="c_name" class="input" value="${escapeHtml(c?.name||"")}" /></div>
      <div><div class="label">Company</div><input id="c_company" class="input" value="${escapeHtml(c?.company||"")}" /></div>
      <div><div class="label">Phone</div><input id="c_phone" class="input" value="${escapeHtml(c?.phone||"")}" /></div>
      <div><div class="label">Email</div><input id="c_email" class="input" value="${escapeHtml(c?.email||"")}" /></div>
    </div>
    <div style="margin-top:10px">
      <div class="label">Notes</div>
      <textarea id="c_notes" class="input" rows="4">${escapeHtml(c?.notes||"")}</textarea>
    </div>
    <div class="hr"></div>
    <div class="row">
      <button id="btnSaveContact" class="primary">Save</button>
      <button id="btnCancel" class="ghost">Cancel</button>
    </div>
  `);

  $("#btnCancel").onclick = closeModal;
  $("#btnSaveContact").onclick = async () => {
    const name = ($("#c_name").value||"").trim();
    if(!name){ toast("Name wajib diisi"); return; }
    const obj = {
      id: c?.id || uid(),
      name,
      phone: ($("#c_phone").value||"").trim() || null,
      email: ($("#c_email").value||"").trim() || null,
      company: ($("#c_company").value||"").trim() || null,
      notes: ($("#c_notes").value||"").trim() || null,
      createdAt: c?.createdAt || nowMs(),
      updatedAt: nowMs()
    };
    await db.put("contacts", obj);
    closeModal();
    await refresh();
    toast("Saved");
  };
}

async function openNewDealModal(){
  const stages = state.cache.stages;
  const contacts = state.cache.contacts;
  if(!stages.length){ toast("Stage kosong. Tambah stage dulu."); return; }

  const stageOptions = stages.map(s => `<option value="${s.id}" ${s.id===state.stageId?"selected":""}>${escapeHtml(s.name)}</option>`).join("");
  const contactOptions = [`<option value="">-</option>`].concat(
    contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
  ).join("");

  openModal("New Deal", `
    <div>
      <div class="label">Deal title *</div>
      <input id="d_title" class="input" placeholder="Contoh: Konsultan Manajemen - PT X" />
    </div>
    <div class="grid2" style="margin-top:10px">
      <div>
        <div class="label">Contact (optional)</div>
        <select id="d_contact" class="input">${contactOptions}</select>
      </div>
      <div>
        <div class="label">Stage</div>
        <select id="d_stage" class="input">${stageOptions}</select>
      </div>
      <div>
        <div class="label">Value (optional)</div>
        <input id="d_value" class="input" placeholder="mis. 20000000" />
      </div>
      <div>
        <div class="label">Expected close (optional)</div>
        <input id="d_close" class="input" type="date" />
      </div>
    </div>
    <div class="hr"></div>
    <div class="row">
      <button id="btnCreateDeal" class="primary">Create</button>
      <button id="btnCancel" class="ghost">Cancel</button>
    </div>
  `);

  $("#btnCancel").onclick = closeModal;
  $("#btnCreateDeal").onclick = async () => {
    const title = ($("#d_title").value||"").trim();
    if(!title){ toast("Title wajib"); return; }
    const contactId = ($("#d_contact").value||"").trim() || null;
    const stageId = ($("#d_stage").value||"").trim();
    const valueRaw = ($("#d_value").value||"").trim().replaceAll(",",".");
    const value = valueRaw ? Number(valueRaw) : null;
    const closeStr = ($("#d_close").value||"").trim();
    const expectedCloseAt = closeStr ? new Date(closeStr+"T00:00:00").getTime() : null;

    const id = uid();
    const obj = {
      id, contactId, title, stageId,
      status:"open",
      value: (Number.isFinite(value) ? value : null),
      expectedCloseAt,
      wonAt:null, lostAt:null, lostReason:null,
      createdAt: nowMs(),
      updatedAt: nowMs()
    };
    await db.put("deals", obj);
    await db.put("stageHistory", {id:uid(), dealId:id, fromStageId:null, toStageId:stageId, note:"Created", createdAt:nowMs()});
    closeModal();
    await refresh();
    toast("Deal created");
  };
}

function ordOfStage(stageId){
  const s = state.cache.stages.find(x=>x.id===stageId);
  return s ? s.ord : 0;
}

function parseVcf(text){
  const cards = [];
  const parts = text.split(/BEGIN:VCARD/i);
  for(const part of parts){
    if(!part || !/END:VCARD/i.test(part)) continue;
    const body = part.split(/END:VCARD/i)[0];
    const lines = body.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const card = {name:"", phone:"", email:"", company:"", notes:""};
    for(const line of lines){
      const [rawKey, ...rest] = line.split(":");
      if(!rest.length) continue;
      const value = rest.join(":").trim();
      const key = rawKey.toUpperCase();
      if((key==="FN" || key.startsWith("FN;")) && !card.name) card.name = value;
      if((key.startsWith("TEL")) && !card.phone) card.phone = value.replace(/[^0-9+]/g,"");
      if((key.startsWith("EMAIL")) && !card.email) card.email = value;
      if((key==="ORG" || key.startsWith("ORG;")) && !card.company) card.company = value;
      if((key==="NOTE" || key.startsWith("NOTE;")) && !card.notes) card.notes = value;
    }
    if(card.name) cards.push(card);
  }
  return cards;
}

async function importVcfFile(file){
  const text = await file.text();
  const cards = parseVcf(text);
  if(!cards.length){ toast("VCF kosong / tidak terbaca"); return 0; }
  let n=0;
  for(const c of cards){
    const obj = {
      id: uid(),
      name: (c.name||"").trim(),
      phone: (c.phone||"").trim() || null,
      email: (c.email||"").trim() || null,
      company: (c.company||"").trim() || null,
      notes: (c.notes||"").trim() || null,
      createdAt: nowMs(),
      updatedAt: nowMs()
    };
    if(!obj.name) continue;
    await db.put("contacts", obj);
    n++;
  }
  return n;
}

async function openDealModal(dealId){
  const d = await db.get("deals", dealId);
  if(!d){ toast("Deal not found"); return; }

  const contact = d.contactId ? state.cache.contacts.find(c=>c.id===d.contactId) : null;
  const stage = d.stageId ? state.cache.stages.find(s=>s.id===d.stageId) : null;

  const stageOptions = state.cache.stages.map(s => `
    <option value="${s.id}" ${s.id===d.stageId?"selected":""}>${escapeHtml(s.name)}</option>
  `).join("");

  const acts = state.cache.activities.filter(a=>a.dealId===d.id);
  const actHtml = acts.length ? acts.map(a => `
    <div class="item">
      <div>
        <div class="itemTitle">${escapeHtml(a.type.toUpperCase())} — ${escapeHtml(a.note)}</div>
        <div class="itemSub">Created: ${escapeHtml(new Date(a.createdAt).toISOString())}</div>
      </div>
      <div class="itemRight">
        <button class="ghost" data-act="${a.id}">${a.done? "✓ Done":"Mark done"}</button>
      </div>
    </div>
  `).join("") : `<div class="empty"><div class="emptyTitle">No activities</div><div class="emptySub">Tambahkan call/meeting/task untuk tracking follow-up.</div></div>`;

  openModal("Deal Detail", `
    <div class="card" style="margin:0">
      <div class="cardTitle">${escapeHtml(d.title)}</div>
      <div class="cardSub">
        ${escapeHtml(d.status.toUpperCase())}
        ${d.status==="open" ? ` • Stage: ${escapeHtml(stage?.name||"-")}` : ""}
        ${contact ? ` • Contact: ${escapeHtml(contact.name)}` : ""}
      </div>
      ${d.status==="lost" && d.lostReason ? `<div class="hint">Lost reason: <b>${escapeHtml(d.lostReason)}</b></div>` : ""}
    </div>

    <div class="hr"></div>

    <div class="grid2">
      <div>
        <div class="label">Edit title</div>
        <input id="ed_title" class="input" value="${escapeHtml(d.title)}" />
      </div>
      <div>
        <div class="label">Value (optional)</div>
        <input id="ed_value" class="input" value="${d.value ?? ""}" />
      </div>
      <div>
        <div class="label">Expected close</div>
        <input id="ed_close" class="input" type="date" value="${d.expectedCloseAt ? fmtDate(d.expectedCloseAt) : ""}" />
      </div>
      <div>
        <div class="label">Save changes</div>
        <button id="btnSaveDeal" class="primary">Save</button>
      </div>
    </div>

    ${d.status==="open" ? `
      <div class="hr"></div>
      <div class="grid2">
        <div>
          <div class="label">Move stage</div>
          <select id="mv_stage" class="input">${stageOptions}</select>
          <div class="small">Jika mundur stage, reason wajib.</div>
        </div>
        <div>
          <div class="label">Action</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button id="btnMoveStage" class="primary">Move</button>
            <button id="btnWon" class="primary">Close WON</button>
            <button id="btnLost" class="danger">Close LOST</button>
          </div>
        </div>
      </div>
    ` : ""}

    <div class="hr"></div>
    <div class="row">
      <div class="cardTitle">Activities</div>
      <button id="btnAddAct" class="primary">+ Activity</button>
    </div>
    <div id="actList">${actHtml}</div>

    <div class="hr"></div>
    <div class="row">
      <button id="btnClose" class="ghost">Close</button>
    </div>
  `);

  $("#btnClose").onclick = closeModal;

  $("#btnSaveDeal").onclick = async ()=>{
    const title = ($("#ed_title").value||"").trim();
    if(!title){ toast("Title wajib"); return; }
    const valueRaw = ($("#ed_value").value||"").trim().replaceAll(",",".");
    const value = valueRaw ? Number(valueRaw) : null;
    const closeStr = ($("#ed_close").value||"").trim();
    const expectedCloseAt = closeStr ? new Date(closeStr+"T00:00:00").getTime() : null;

    await db.put("deals", {
      ...d,
      title,
      value: Number.isFinite(value) ? value : null,
      expectedCloseAt,
      updatedAt: nowMs()
    });
    closeModal();
    await refresh();
    toast("Saved");
  };

  if(d.status==="open"){
    $("#btnMoveStage").onclick = async ()=>{
      const toStageId = ($("#mv_stage").value||"").trim();
      if(!toStageId || toStageId===d.stageId){ toast("Stage sama"); return; }
      const backward = ordOfStage(toStageId) < ordOfStage(d.stageId);
      let note = "";
      if(backward){
        note = prompt("Reason (wajib) - mundur stage:", "");
        if(!note || !note.trim()){ toast("Reason wajib"); return; }
      } else {
        note = prompt("Note (opsional):", "") || "";
      }
      await db.put("deals", {...d, stageId:toStageId, updatedAt:nowMs()});
      await db.put("stageHistory", {id:uid(), dealId:d.id, fromStageId:d.stageId, toStageId, note: note.trim()||null, createdAt:nowMs()});
      closeModal();
      await refresh();
      toast("Stage moved");
    };

    $("#btnWon").onclick = async ()=>{
      await db.put("deals", {...d, status:"won", wonAt:nowMs(), updatedAt:nowMs()});
      closeModal();
      await refresh();
      toast("Closed WON");
    };

    $("#btnLost").onclick = async ()=>{
      const reason = prompt("Lost reason (wajib):", "");
      if(!reason || !reason.trim()){ toast("Reason wajib"); return; }
      await db.put("deals", {...d, status:"lost", lostAt:nowMs(), lostReason:reason.trim(), updatedAt:nowMs()});
      closeModal();
      await refresh();
      toast("Closed LOST");
    };
  }

  $("#btnAddAct").onclick = async ()=>{
    const type = prompt("Type: call / meeting / task / note", "call");
    if(!type || !type.trim()) return;
    const note = prompt("Activity note (wajib):", "");
    if(!note || !note.trim()){ toast("Note wajib"); return; }
    await db.put("activities", {id:uid(), dealId:d.id, type:type.trim().toLowerCase(), note:note.trim(), dueAt:null, done:0, createdAt:nowMs()});
    closeModal();
    await refresh();
    toast("Activity added");
    openDealModal(d.id);
  };

  $$("#actList button[data-act]").forEach(btn=>{
    btn.onclick = async ()=>{
      const actId = btn.getAttribute("data-act");
      const a = await db.get("activities", actId);
      if(!a) return;
      await db.put("activities", {...a, done:1});
      closeModal();
      await refresh();
      toast("Done");
      openDealModal(d.id);
    };
  });
}

function parseCsv(text){
  const rows = [];
  let cur = "", inQ=false, row=[];
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];
    if(ch === '"' ){
      if(inQ && next === '"'){ cur+='"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if(!inQ && (ch === ",")){ row.push(cur); cur=""; continue; }
    if(!inQ && (ch === "\n")){
      row.push(cur); rows.push(row.map(x=>x.trim())); cur=""; row=[]; continue;
    }
    if(ch === "\r") continue;
    cur += ch;
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row.map(x=>x.trim())); }
  return rows.filter(r => r.some(x=>x && x.trim()));
}

async function importCsvFile(file){
  const text = await file.text();
  const rows = parseCsv(text);
  if(!rows.length){ toast("CSV kosong"); return 0; }
  const first = rows[0].map(x => (x||"").toLowerCase());
  const hasHeader = first.includes("name") || first.includes("phone") || first.includes("email");
  let header = []; let start = 0;
  if(hasHeader){ header = first; start = 1; }
  let n=0;
  for(let i=start;i<rows.length;i++){
    const r = rows[i];
    let name="", phone="", email="", company="", notes="";
    if(hasHeader){
      const get = (key)=> {
        const idx = header.indexOf(key);
        return (idx>=0 && idx<r.length) ? r[idx] : "";
      };
      name = get("name"); phone = get("phone"); email = get("email"); company = get("company"); notes = get("notes");
    } else {
      name = r[0] || ""; phone = r[1] || ""; email = r[2] || ""; company = r[3] || ""; notes = r[4] || "";
    }
    if(!name.trim()) continue;
    await db.put("contacts", {
      id: uid(),
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      company: company.trim() || null,
      notes: notes.trim() || null,
      createdAt: nowMs(),
      updatedAt: nowMs()
    });
    n++;
  }
  return n;
}

async function exportBackup(){
  const payload = {
    exportedAt: new Date().toISOString(),
    stages: state.cache.stages,
    contacts: state.cache.contacts,
    deals: state.cache.deals,
    activities: state.cache.activities,
    stageHistory: state.cache.stageHistory
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0,16).replaceAll(":","").replaceAll("-","");
  a.href = url;
  a.download = `arana_crm_backup_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

async function restoreBackup(file){
  const text = await file.text();
  let payload;
  try{ payload = JSON.parse(text); } catch(e){ toast("JSON invalid"); return; }
  const stores = ["stages","contacts","deals","activities","stageHistory"];
  for(const s of stores){ await db.clear(s); }
  for(const s of (payload.stages||[])) await db.put("stages", s);
  for(const c of (payload.contacts||[])) await db.put("contacts", c);
  for(const d of (payload.deals||[])) await db.put("deals", d);
  for(const a of (payload.activities||[])) await db.put("activities", a);
  for(const h of (payload.stageHistory||[])) await db.put("stageHistory", h);
  await refresh();
}

async function refresh(){ await loadCache(); render(); }

function wireUI(){
  $$(".tab").forEach(b => b.onclick = ()=> switchTab(b.dataset.tab));
  $("#btnSync").onclick = ()=> refresh();

  $("#btnNewDeal").onclick = openNewDealModal;

  $("#btnNewContact").onclick = ()=> openContactModal(null);
  $("#contactSearch").addEventListener("input", ()=> renderContacts());

  $$(".segbtn").forEach(b=>{
    b.onclick = ()=>{
      state.closedStatus = b.dataset.closed;
      $$(".segbtn").forEach(x=>x.classList.toggle("active", x===b));
      renderClosed();
    };
  });

  $("#btnAddStage").onclick = async ()=>{
    const name = ($("#newStageName").value||"").trim();
    if(!name){ toast("Nama stage wajib"); return; }
    const ord = state.cache.stages.length ? Math.max(...state.cache.stages.map(s=>s.ord))+1 : 0;
    await db.put("stages", {id:uid(), name, ord});
    $("#newStageName").value="";
    await refresh();
    toast("Stage added");
  };

  $("#btnImportCsv").onclick = async ()=>{
    const file = $("#csvFile").files?.[0];
    if(!file){ toast("Pilih file CSV dulu"); return; }
    const n = await importCsvFile(file);
    await refresh();
    toast(`Imported: ${n} contact(s)`);
  };

  $("#btnImportVcf").onclick = async ()=>{
    const file = $("#vcfFile").files?.[0];
    if(!file){ toast("Pilih file VCF dulu"); return; }
    const n = await importVcfFile(file);
    await refresh();
    toast(`Imported: ${n} contact(s)`);
  };

  $("#btnExport").onclick = exportBackup;

  $("#btnRestore").onclick = async ()=>{
    const file = $("#jsonFile").files?.[0];
    if(!file){ toast("Pilih file JSON backup"); return; }
    const ok = confirm("Restore akan overwrite semua data. Lanjut?");
    if(!ok) return;
    await restoreBackup(file);
    toast("Restored");
  };

  $("#modalClose").onclick = closeModal;
  $("#modal").addEventListener("click", (e)=>{ if(e.target.id==="modal") closeModal(); });
}

(async function main(){
  await db.open();
  await seedIfEmpty();
  await loadCache();
  wireUI();
  render();
})();
