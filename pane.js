/* =============================================================================
   Bills & Paychecks — Excel side panel
   Narrow, guided view of the weekly job: what to pay today, the Friday update,
   and recording payments. "Open full dashboard" opens the complete dashboard in
   a large Excel window. Shared logic lives in core.js.
   ============================================================================= */
"use strict";
state.pane = "today";      // today | friday | bills
state.billFilter = "todo"; // todo | paid | all
let fullDialog = null;

/* ------------------------------------------------------------------ render */
function render() {
  document.querySelectorAll(".p-tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.pane === state.pane)));
  const v = { today: paneToday, friday: paneFriday, bills: paneBills }[state.pane];
  $("#app").innerHTML = keyLine() + v();
  const fails = +META.checksFailing || 0;
  $("#pStatus").innerHTML = `<span>${fmtD(META.asOf, { weekday: "short", month: "short", day: "numeric" })}</span>
    <button class="p-health ${fails ? "bad" : ""}" data-act="open-details" title="Open the model checks"><span class="dot"></span>${fails ? `${fails} check${fails === 1 ? "" : "s"} failing` : "Checks OK"}</button>`;
}

const pKpi = (label, value, sub, cls = "") => `<div class="p-kpi"><div class="kpi-label">${label}</div><div class="p-kpi-v ${cls}">${value}</div><div class="p-kpi-s">${sub}</div></div>`;

function paneToday() {
  const vm = monthKey(META.asOf), k = kpis(vm), cur = META.currentPayday, curPlan = planFor(cur);
  const payRows = reg().filter(r => (+r["Payday amount"] || 0) > 0 || (r["Paid date"] === META.asOf && r.Remaining <= 0 && r["Paid total"] > 0));
  const toPay = payRows.filter(r => r.Remaining > 0);
  const routine = fridayRoutine();
  const nextP = META.nextPayday, nextRows = reg().filter(r => r["Planned date"] === nextP && r.Remaining > 0);
  const planAmt = r => (+r["Remaining must"] || 0) + (+r["Extra planned"] || 0), nextPlan = planFor(nextP);
  const eom = endOfMonth(vm);
  return `
  <section class="p-card payday">
    <div class="payday-head"><h2>Pay today · ${fmtD(cur, { weekday: "short", month: "short", day: "numeric" })}</h2><span>${toPay.length ? `${toPay.length} to pay` : "All done"}</span></div>
    ${payRows.length ? `<ul class="p-list">${payRows.map(r => {
      const done = r.Remaining <= 0, st = status(r);
      return `<li class="${done ? "done" : ""}">
        <div class="p-li-main"><div class="pl-name">${esc(r.Bill)}</div>
          <div class="pl-note"><span class="pill st ${st.c}">${esc(st.t)}</span><span>due ${shortD(r["Due date"])}</span></div></div>
        <div class="p-li-side"><div class="pl-amt">${money(done ? r["Paid total"] : r["Payday amount"])}</div>
          ${done ? `<button class="btn small ghost" data-act="unlock-row" data-id="${esc(r.RowID)}" title="Saved and locked">🔒 Unlock</button>`
                 : `<button class="btn small primary" data-act="quick-pay" data-id="${esc(r.RowID)}" aria-label="Mark ${esc(r.Bill)} paid">Mark paid</button>`}</div>
      </li>`; }).join("")}</ul>` : `<p class="empty">Nothing to pay from this payday.</p>`}
    <div class="p-foot-note">${toPay.length ? `Total <b class="money">${money(sum(toPay, r => r["Payday amount"]))}</b> · ` : ""}After paying, PNC should have about <b class="money">${money(curPlan ? curPlan["Cash after"] : null)}</b> until ${fmtD(nextP, { weekday: "short", month: "short", day: "numeric" })}.</div>
  </section>

  <section class="p-card p-pad">
    <h3 class="p-h">Friday steps</h3>
    <ul class="checklist">${routine.map((x, i) => `<li>${statusMark(x)}<div><div class="ck-label">${x.label}</div><div class="ck-note">${i < 2 && !x.on ? `<button class="linkish" data-act="go-pane" data-pane="friday">Do it now →</button>` : x.note.replace(" tab", "")}</div></div></li>`).join("")}</ul>
  </section>

  <section class="p-kpis" aria-label="Key numbers">
    ${pKpi("Left at month end", money(k.left, 0), "if everything goes to plan", "v-good")}
    ${pKpi("Lowest balance ahead", money(k.low ? k.low["Cash after"] : null, 0), k.low ? `${shortD(k.low.Payday)} · cushion ${money(META.cushion, 0)} ${k.low["Cash after"] >= META.cushion ? "✓" : "— short"}` : "", k.low && k.low["Cash after"] < META.cushion ? "v-bad" : "v-good")}
    ${pKpi("Bills paid", `${k.paidN} of ${k.total}`, `${monthName(vm, { month: "long" })}, incl. last month's`)}
    ${pKpi("Needs attention", `${k.late} late`, `${k.soon} more due within ${META.soonOrangeDays} days`, k.late ? "v-bad" : "")}
  </section>

  <details class="p-card p-pad p-more">
    <summary><span>Next payday · ${shortD(nextP)}</span><span class="money">${nextRows.length} bills · ${money(nextPlan ? planOut(nextPlan) : sum(nextRows, planAmt), 0)}</span></summary>
    <ul class="p-mini">${nextRows.map(r => `<li><span>${esc(r.Bill)}</span><span class="money">${money(planAmt(r))}</span></li>`).join("") || "<li>Nothing planned yet.</li>"}</ul>
  </details>

  <details class="p-card p-pad p-more">
    <summary><span>End of ${monthName(vm, { month: "long" })}</span><span>${eom.filter(x => x.on).length} of 3 done</span></summary>
    <ul class="checklist" style="margin-top:10px">${eom.map(x => `<li>${statusMark(x)}<div><div class="ck-label">${x.label}</div><div class="ck-note">${x.note}</div></div></li>`).join("")}</ul>
    ${!eom[2].on ? `<button class="btn small" style="margin-top:10px" data-act="close-month" data-month="${vm}">Mark ${monthName(vm, { month: "long" })} closed</button>` : ""}
  </details>`;
}

function paneFriday() {
  const vm = state.vm, picker = fridayPicker(vm), i = fridayInfo(state.fri.date);
  const main = i.cards.filter(d => d["Expected category"] !== "$0 Balance" || d["Has balance"] === true || i.saved[d.Name]);
  const zero = i.cards.filter(d => !main.includes(d));
  const row = d => { const sv = i.saved[d.Name], prev = DB.tblCardLog.filter(l => l["Card or loan"] === d.Name && isVal(l.Balance) && l.Date < i.date).at(-1); return `<div class="p-card-row">
      <div class="p-cr-name"><b>${esc(d.Name)}</b><span class="hint">${prev ? `${money(prev.Balance)} on ${shortD(prev.Date)}` : "no earlier balance"}</span></div>
      <label class="p-in">Balance${fridayField(i, `bal-${d.DebtID}`, `${d.Name} balance`, sv ? sv.Balance : null)}</label>
      <label class="p-in">Minimum${fridayField(i, `min-${d.DebtID}`, `${d.Name} minimum`, sv ? sv.Minimum : null, isVal(d["Latest minimum"]) ? `keep ${d["Latest minimum"]}` : "")}</label>
    </div>`; };
  return `<div class="p-monthnav"><button class="icon-btn" data-act="prev-month" aria-label="Previous month">‹</button><b>${monthName(vm)}</b><button class="icon-btn" data-act="next-month" aria-label="Next month">›</button></div>
  ${picker}
  <form data-form="friday" class="p-stack">
    ${i.date ? fridayBanner(i) : ""}
    <section class="p-card p-pad">
      <label class="p-in big">PNC checking balance${fridayField(i, "bank", "PNC checking balance", i.bank ? i.bank["PNC balance"] : null)}</label>
      <p class="hint" style="margin:6px 0 0">Includes that day's paychecks. The plan expected ${money(META.expectedBankToday)} today.</p>
    </section>
    <section class="p-card">
      <h3 class="p-h p-pad-x">Cards in use</h3>
      ${main.map(row).join("")}
    </section>
    ${zero.length ? `<details class="p-card p-more">
      <summary class="p-pad-x"><span>Cards at $0 (${zero.length})</span><span class="hint">only if a balance shows up</span></summary>
      ${zero.map(row).join("")}
    </details>` : ""}
    ${i.editable ? `<div class="p-sticky"><button class="btn primary wide" type="submit">Save Friday update</button></div>` : ""}
  </form>`;
}

function paneBills() {
  const vm = state.vm;
  let rows = viewRows(vm).sort((a, b) => GROUP_ORDER.indexOf(groupOf(a, vm)) - GROUP_ORDER.indexOf(groupOf(b, vm)) || (a["Due date"] < b["Due date"] ? -1 : 1));
  const counts = { todo: rows.filter(r => r.Remaining > 0 || status(r).c === "info").length, paid: rows.filter(r => r.Remaining <= 0 && r["Paid total"] > 0).length, all: rows.length };
  if (state.billFilter === "todo") rows = rows.filter(r => r.Remaining > 0 || status(r).c === "info");
  if (state.billFilter === "paid") rows = rows.filter(r => r.Remaining <= 0 && r["Paid total"] > 0);
  let html = "", g = null;
  for (const r of rows) {
    const grp = groupOf(r, vm);
    if (grp !== g) { g = grp; html += `<li class="p-group ${grp === "Last month's bills" ? "last" : ""}">${esc(grp)}</li>`; }
    const st = status(r), open = state.openRow === r.RowID;
    html += `<li class="p-bill ${open ? "open" : ""}">
      <button class="p-bill-btn" ${st.c === "info" ? `data-act="go-pane" data-pane="friday"` : `data-act="open-row" data-id="${esc(r.RowID)}"`} aria-expanded="${open}">
        <span class="pill st ${st.c}">${esc(st.t)}</span>
        <span class="p-bill-name">${esc(r.Bill)}<small>${r["Paid date"] ? `🔒 Paid ${shortD(r["Paid date"])} · ${open ? "unlocked" : "tap to unlock"}` : `due ${shortD(r["Due date"])} · ${esc(r["Pay from"] || "")}`}</small></span>
        <span class="money">${money(r["Paid date"] ? r["Paid total"] : r.Amount)}</span>
      </button>
      ${open ? `<div class="p-form">${payForm(r)}${source.kind === "excel" ? `<button class="linkish" type="button" data-act="show-row" data-id="${esc(r.RowID)}">Show this row in the workbook</button>` : ""}</div>` : ""}
    </li>`;
  }
  return `<div class="p-monthnav"><button class="icon-btn" data-act="prev-month" aria-label="Previous month">‹</button><b>${monthName(vm)}</b><button class="icon-btn" data-act="next-month" aria-label="Next month">›</button></div>
    <div class="seg p-seg" role="group" aria-label="Show">${[["todo", "To pay"], ["paid", "Paid"], ["all", "All"]].map(([k, l]) => `<button data-act="filter" data-f="${k}" aria-pressed="${state.billFilter === k}">${l} <span class="hint">${counts[k]}</span></button>`).join("")}</div>
    ${statusKey()}
    <ul class="p-bills">${html || `<li class="empty">${state.billFilter === "todo" ? "Everything this month is paid. 🎉" : "Nothing here."}</li>`}</ul>`;
}

/* ------------------------------------------------------------------ full dashboard window */
function openFull(view = "month") {
  if (!Office.context.requirements.isSetSupported("DialogApi", "1.2")) { toast("This version of Excel can't open the full dashboard window. Update Excel (Help ▸ Check for Updates)."); return; }
  if (fullDialog) { try { fullDialog.close(); } catch (e) {} fullDialog = null; }
  const url = new URL(`dashboard.html?host=dialog#${view}`, location.href).href;
  Office.context.ui.displayDialogAsync(url, { height: 92, width: 92, promptBeforeOpen: false }, res => {
    if (res.status !== Office.AsyncResultStatus.Succeeded) { toast(`Couldn't open the full dashboard (${esc(res.error.message)}).`); return; }
    fullDialog = res.value;
    fullDialog.addEventHandler(Office.EventType.DialogMessageReceived, onDialogMessage);
    fullDialog.addEventHandler(Office.EventType.DialogEventReceived, () => { fullDialog = null; });
  });
}
const DIALOG_CHUNK = 24000;
sendData.seq = 0;
function sendData() {
  if (!fullDialog) return;
  const s = JSON.stringify(DB), n = Math.ceil(s.length / DIALOG_CHUNK), id = ++sendData.seq;
  for (let i = 0; i < n; i++) fullDialog.messageChild(JSON.stringify({ t: "chunk", id, i, n, s: s.slice(i * DIALOG_CHUNK, (i + 1) * DIALOG_CHUNK) }));
}
async function onDialogMessage(arg) {
  let m; try { m = JSON.parse(arg.message); } catch (e) { return; }
  if (m.t === "get") sendData();
  if (m.t === "close") { fullDialog.close(); fullDialog = null; }
  if (m.t === "write") {
    let ok = true, err = "";
    busyUntil = Date.now() + 60000;
    try { await source.write(m.change); await reload(); } catch (e) { ok = false; err = e.message || String(e); }
    finally { busyUntil = Date.now() + 1500; }
    render();
    fullDialog && fullDialog.messageChild(JSON.stringify({ t: "ack", id: m.id, ok, err }));
  }
}

/* ------------------------------------------------------------------ live refresh when someone types in the workbook */
let refreshTimer = null;
function scheduleRefresh() {
  if (Date.now() < busyUntil) return;          // our own write
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await reload(); render(); sendData(); }, 700);
}
async function watchWorkbook() {
  if (!Office.context.requirements.isSetSupported("ExcelApi", "1.7")) return;
  await Excel.run(async ctx => {
    ["tblRegister", "tblCardLog", "tblCashLog", "tblOther", "tblMonths", "tblDebts", "tblPaychecks"].forEach(n => ctx.workbook.tables.getItem(n).onChanged.add(scheduleRefresh));
    await ctx.sync();
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act], .p-tab"); if (!t) return;
  if (t.classList.contains("p-tab")) { state.pane = t.dataset.pane; state.openRow = null; render(); window.scrollTo({ top: 0 }); return; }
  const act = t.dataset.act, row = t.dataset.id ? reg().find(r => r.RowID === t.dataset.id) : null;
  if (act === "go-pane") { state.pane = t.dataset.pane; state.openRow = null; render(); window.scrollTo({ top: 0 }); }
  if (act === "refresh") { await guarded(async () => { await reload(); }); render(); sendData(); toast("Refreshed from the workbook."); }
  if (act === "open-full") openFull("month");
  if (act === "open-details") openFull("details");
  if (act === "prev-month" || act === "next-month") { state.vm = addMonths(state.vm, act === "prev-month" ? -1 : 1); state.openRow = null; render(); }
  if (act === "filter") { state.billFilter = t.dataset.f; state.openRow = null; render(); }
  if (act === "open-row") { state.openRow = state.openRow === row.RowID ? null : row.RowID; render(); const f = document.querySelector(`[data-form="pay"] input`); if (f) f.focus(); }
  if (act === "close-row") { state.openRow = null; render(); }
  if (act === "show-row") await ExcelSource.select("tblRegister", row.RowID);
  if (act === "quick-pay") { row._paidToday = true; await writeRow(row, { "Paid date": META.asOf, "Paid amount": +row["Payday amount"] }, `Marked ${esc(row.Bill)} paid · ${money(row["Payday amount"])}`); }
  if (act === "undo-row") await writeRow(row, { "Paid date": null, "Paid amount": null }, `Cleared the payment for ${esc(row.Bill)}`);
  if (act === "unlock-row") { state.pane = "bills"; state.vm = row.Month < monthKey(META.asOf) ? monthKey(META.asOf) : state.vm; state.billFilter = "paid"; state.openRow = row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) f.scrollIntoView({ block: "center" }); }
  if (act === "pick-friday") { state.fri.date = t.dataset.date; state.fri.unlocked = false; render(); }
  if (act === "unlock-friday") { state.fri.unlocked = true; render(); const x = document.querySelector('[data-form="friday"] input'); if (x) x.focus(); }
  if (act === "lock-friday") { state.fri.unlocked = false; render(); }
  if (act === "clear-row") { state.openRow = null; await writeRow(row, { "Paid date": null, "Paid amount": null, "Extra paid date": null, "Extra paid amount": null, "Reason if different": null }, `Cleared the payment for ${esc(row.Bill)}`); }
  if (act === "close-month") await closeMonth(t.dataset.month);
  if (["quick-pay", "undo-row", "clear-row", "close-month"].includes(act)) sendData();
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === "pay") await submitPay(f);
  if (f.dataset.form === "friday") await saveFriday(new FormData(f), fridayInfo(state.fri.date));
  sendData();
});

/* ------------------------------------------------------------------ start */
(async () => {
  const show = html => { $("#app").innerHTML = `<section class="p-card p-pad">${html}</section>`; };
  if (window.Office) await Office.onReady();
  if (ExcelSource.available()) source = ExcelSource;
  else if (!window.__SAMPLE__) { show(`<h3 class="p-h">Open this inside Excel</h3><p class="note">This panel works inside the budget workbook. Open the workbook in Excel and click <b>Bills &amp; Paychecks</b> on the Home tab.</p>`); return; }
  try { DB = await source.load(); }
  catch (e) {
    show(`<h3 class="p-h">This workbook isn't the budget model</h3><p class="note">The panel couldn't find the tables it needs (${esc(e.message)}). Open the budget workbook and click <b>Refresh</b>.</p><button class="btn" data-act="refresh">Refresh</button>`);
    return;
  }
  index(); render();
  if (source.kind === "excel") {
    try { Office.context.document.settings.set("Office.AutoShowTaskpaneWithDocument", true); Office.context.document.settings.saveAsync(); } catch (e) {}
    try { await watchWorkbook(); } catch (e) { console.warn("Change tracking unavailable", e); }
  }
})();
