/* =============================================================================
   Bills & Paychecks — shared core (used by the Excel panel and the full view)
   -----------------------------------------------------------------------------
   The workbook is the engine. This code only reads the export/contract tables,
   shows them, and writes the few input columns listed below. No numbers live
   in this file; everything comes from the open workbook.

   READS : tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory,
           tblExportCategory, tblExportChecks, tblRegister, tblDebts, tblCardLog,
           tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory, tblDadSchedule
   WRITES: tblRegister input columns (matched by RowID); new rows in tblCardLog,
           tblCashLog, tblOther; tblMonths[Month closed?] (matched by Month)

   change = { table, rowId, values }  → update one row
          = { table, append: [rows] } → add rows (fills the first blank row, else adds one)
   ============================================================================= */
"use strict";

const TABLES = ["tblExportMeta", "tblExportPlan", "tblExportCardPlan", "tblExportHistory", "tblExportCategory", "tblExportChecks",
  "tblRegister", "tblDebts", "tblCardLog", "tblCashLog", "tblOther", "tblPaychecks", "tblMonths", "tblDadHistory", "tblDadSchedule"];
const ROW_KEY = { tblRegister: "RowID", tblMonths: "Month" };
/* Columns the dashboard is allowed to write. Anything else is refused, so a bug here can never overwrite a formula. */
const WRITABLE = {
  tblRegister: ["Paid date", "Paid amount", "Extra paid date", "Extra paid amount", "Reason if different", "Notes"],
  tblMonths: ["Month closed?"],
  tblCardLog: ["Date", "Card or loan", "Balance", "Minimum", "Note"],
  tblCashLog: ["Date", "PNC balance", "Note"],
  tblOther: ["Date", "Description", "Category", "Amount", "Status", "Note"],
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const serialToIso = v => new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
const isoToSerial = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5 + 25569; };
const isDateFormat = f => { f = String(f || ""); if (f === "General" || f === "@") return false; const bare = f.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""); return /[dmy]/i.test(bare) && !/[0#$?%]/.test(bare); };
const toCell = v => (v === null || v === undefined) ? "" : (typeof v === "string" && ISO_RE.test(v)) ? isoToSerial(v) : v;
const fromCell = (v, fmt) => { if (v === "") return null; if (typeof v === "number" && isDateFormat(fmt)) return v > 0 ? serialToIso(v) : null; return v; };

/* ---------------------------------------------------------------- Excel (the panel) */
const ExcelSource = {
  kind: "excel",
  available() { return !!(window.Office && window.Excel && Office.context && Office.context.host === Office.HostType.Excel); },
  async load() {
    return Excel.run(async ctx => {
      const out = {}, ranges = {};
      for (const n of TABLES) { ranges[n] = ctx.workbook.tables.getItem(n).getRange(); ranges[n].load("values, numberFormat"); }
      await ctx.sync();
      for (const n of TABLES) {
        const [hdr, ...rows] = ranges[n].values, fmts = ranges[n].numberFormat;
        out[n] = rows.map((r, i) => Object.fromEntries(hdr.map((h, j) => [h, fromCell(r[j], fmts[i + 1][j])])));
      }
      return out;
    });
  },
  /* Runs `fn` with the table's sheet unprotected (if it was), then puts the same protection back. */
  async withSheet(ctx, table, fn) {
    const prot = table.worksheet.protection; prot.load("protected, options"); await ctx.sync();
    const was = prot.protected, opts = was ? prot.options : null;
    if (was) { prot.unprotect(); await ctx.sync(); }
    try { await fn(); }
    finally { if (was) { prot.protect(opts); await ctx.sync(); } }
  },
  async write(change) {
    const allowed = WRITABLE[change.table] || [];
    const rows = change.append || [change.values];
    for (const r of rows) for (const k of Object.keys(r)) if (!allowed.includes(k)) throw new Error(`Not allowed to write ${change.table}[${k}]`);
    return Excel.run(async ctx => {
      const t = ctx.workbook.tables.getItem(change.table);
      const hdrR = t.getHeaderRowRange(), body = t.getDataBodyRange();
      hdrR.load("values"); body.load("values, formulas, numberFormat, rowCount"); await ctx.sync();
      const cols = hdrR.values[0];
      await this.withSheet(ctx, t, async () => {
        if (change.append) {
          for (const r of change.append) {
            // Reuse the first row whose input columns are all blank (pre-sized tables); otherwise add a row.
            const blank = body.values.findIndex(v => allowed.every(c => cols.indexOf(c) < 0 || v[cols.indexOf(c)] === ""));
            if (blank >= 0) {
              for (const [k, v] of Object.entries(r)) body.getCell(blank, cols.indexOf(k)).values = [[toCell(v)]];
              body.values[blank] = body.values[blank].map((x, j) => (cols[j] in r ? toCell(r[cols[j]]) : x));
            } else {
              // Copy the calculated-column formulas from the last row so they keep working on the new row.
              const last = body.formulas[body.rowCount - 1] || [];
              t.rows.add(null, [cols.map((c, j) => (c in r) ? toCell(r[c]) : (typeof last[j] === "string" && last[j].startsWith("=") ? last[j] : ""))]);
            }
            await ctx.sync();
          }
          return;
        }
        const keyCol = cols.indexOf(ROW_KEY[change.table]);
        const idx = body.values.findIndex((r, i) => String(fromCell(r[keyCol], body.numberFormat[i][keyCol])) === String(change.rowId));
        if (idx < 0) throw new Error(`Row ${change.rowId} not found in ${change.table}`);
        for (const [k, v] of Object.entries(change.values)) body.getCell(idx, cols.indexOf(k)).values = [[toCell(v)]];
        await ctx.sync();
      });
    });
  },
  /* Advanced view: jump to a register row in the workbook. */
  async select(table, rowId) {
    return Excel.run(async ctx => {
      const t = ctx.workbook.tables.getItem(table), hdr = t.getHeaderRowRange(), body = t.getDataBodyRange();
      hdr.load("values"); body.load("values, numberFormat"); t.worksheet.load("name"); await ctx.sync();
      const keyCol = hdr.values[0].indexOf(ROW_KEY[table]);
      const idx = body.values.findIndex((r, i) => String(fromCell(r[keyCol], body.numberFormat[i][keyCol])) === String(rowId));
      if (idx < 0) return;
      t.worksheet.activate(); body.getRow(idx).select(); await ctx.sync();
    });
  },
};

/* ---------------------------------------------------------------- Sample (local testing only — never hosted with data) */
const SampleSource = {
  kind: "sample",
  async load() { return window.__SAMPLE__; },
  async write(change) {
    const t = window.__SAMPLE__[change.table];
    if (change.append) { change.append.forEach(r => t.push(r)); return; }
    const row = t.find(r => r[ROW_KEY[change.table]] === change.rowId);
    Object.assign(row, change.values);
    if (change.table === "tblRegister") localRecalc(row);
  }
};
let source = SampleSource;

/* ---------------------------------------------------------------- people (from tblPaychecks, so no names live in the code) */
let PEOPLE = [];
const personColor = name => PEOPLE.indexOf(name) === 1 ? "var(--series-2)" : "var(--series-1)";
const peopleLabel = set => PEOPLE.filter(p => set.has(p)).join(" + ");

/* ========================================================================= helpers */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n, d = 2) => (n === null || n === undefined || n === "") ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const D = iso => new Date(iso + "T12:00:00");
const fmtD = (iso, o) => iso ? D(iso).toLocaleDateString("en-US", o || { weekday: "short", month: "short", day: "numeric" }) : "—";
const shortD = iso => iso ? fmtD(iso, { month: "short", day: "numeric" }) : "—";
const monthKey = iso => iso ? iso.slice(0, 7) + "-01" : null;
const addMonths = (key, n) => { const d = D(key); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) + "-01"; };
const monthName = (key, o) => D(key).toLocaleDateString("en-US", o || { month: "long", year: "numeric" });
const daysInMonth = key => { const d = D(key); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
const isoOf = (key, day) => key.slice(0, 8) + String(day).padStart(2, "0");
const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const GROUP_ORDER = ["Last month's bills", "Housing", "Utilities", "Auto", "Insurance", "Debt — Loans", "Debt — Credit Cards", "Other"];
const REASONS = ["Seasonal / usage", "Price or rate change", "One-time charge", "Paid early (timing)", "Paid late (timing)", "Extra debt payment", "Budget estimate off", "Other — see note"];

let DB, META, debtsById, plan, paydays, adjust = {}, undoStack = [];
const state = { view: "month", vm: null, openRow: null, cat: null, detailed: false };

function index() {
  META = Object.fromEntries(DB.tblExportMeta.map(r => [r.Key, r.Value]));
  debtsById = Object.fromEntries(DB.tblDebts.map(d => [d.DebtID, d]));
  plan = DB.tblExportPlan.filter(p => p.Valid === true && p.Payday);
  const seen = {};
  DB.tblPaychecks.filter(p => p["Deposit date"] >= META.modelStart).forEach(p => {
    const d = p["Deposit date"]; seen[d] = seen[d] || { date: d, people: new Set(), amount: 0 };
    seen[d].people.add(p.Person); seen[d].amount += +p["Amount used"] || 0;
  });
  PEOPLE = [];
  DB.tblPaychecks.forEach(p => { if (p.Person && !PEOPLE.includes(p.Person)) PEOPLE.push(p.Person); });
  paydays = Object.values(seen).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!state.vm) state.vm = META.viewMonth || monthKey(META.asOf);
}

/* After a payment is recorded in preview mode, update the row the way Excel would. */
function localRecalc(r) {
  const paid = (+r["Paid amount"] || 0) + (+r["Extra paid amount"] || 0);
  const before = (+r["Remaining must"] || 0) + (+r["Extra planned"] || 0);
  r["Paid total"] = paid;
  if (r.Source === "Debt") r.Remaining = r["Paid date"] ? 0 : Math.max(0, r.Amount - paid);
  else r.Remaining = Math.max(0, Math.round((r.Amount - paid) * 100) / 100);
  r["Remaining must"] = Math.min(r.Remaining, Math.max(0, (r["Must pay"] || 0) - paid));
  if (r["Planned date"] && r.Remaining === 0) adjust[r["Planned date"]] = (adjust[r["Planned date"]] || 0) + before;
  if (r.Remaining === 0) { r["Payday amount"] = 0; r["Planned date"] = r["Planned date"]; }
  r["Pay from"] = r.Remaining === 0 && paid > 0 ? "Paid " + fmtD(r["Paid date"], { weekday: "short", month: "numeric", day: "numeric" }) : r["Pay from"];
  r["Cash month"] = r["Paid date"] ? monthKey(r["Paid date"]) : r["Cash month"];
  r.Variance = r.Source === "Bill" && paid > 0 ? Math.round((paid - r.Budget) * 100) / 100 : null;
  r["Needs reason"] = r.Variance !== null && Math.abs(r.Variance) > META.varianceAmount && Math.abs(r.Variance) > META.variancePct * r.Budget && !r["Reason if different"];
}

/* ========================================================================= derived data */
const reg = () => DB.tblRegister;
function status(r) {
  if (!r.Applies) return { t: "Not needed", c: "muted" };
  const flag = r.Source === "Debt" ? (debtsById[r.ItemID] || {}).Flag : "";
  if (r.Source === "Debt" && !r["Paid date"] && flag === "Needs Friday balance") return { t: "Enter balance", c: "info" };
  if (r.Remaining <= 0) return r["Paid total"] > 0 ? { t: "Paid ✓", c: "paid" } : { t: "—", c: "muted" };
  if (r["Paid total"] > 0) return { t: "Part paid", c: "yellow" };
  const d = r["Days out"];
  if (d < 0) return { t: `Late · ${-d} day${d === -1 ? "" : "s"}`, c: "late" };
  if (d === 0) return { t: "Due today", c: "red" };
  if (d === 1) return { t: "Due tomorrow", c: "red" };
  if (d <= META.soonOrangeDays) return { t: `${d} days`, c: "orange" };
  if (d <= META.soonYellowDays) return { t: `${d} days`, c: "yellow" };
  return { t: "Upcoming", c: "up" };
}
function inView(r, vm) {
  if (!r.Applies) return false;
  if (r.Month === vm) return true;
  if (r.Month === addMonths(vm, -1)) {
    if (!r["Paid date"]) return r.Remaining > 0 && (!r["Planned date"] || r["Planned date"] >= vm);
    return r["Paid date"] >= vm;
  }
  return false;
}
const viewRows = vm => reg().filter(r => inView(r, vm));
const groupOf = (r, vm) => r.Month < vm ? "Last month's bills" : r.Category;
const paidInRange = (a, b) => sum(reg(), r => ((r["Paid date"] && r["Paid date"] >= a && r["Paid date"] <= b) ? +r["Paid amount"] || 0 : 0) + ((r["Extra paid date"] && r["Extra paid date"] >= a && r["Extra paid date"] <= b) ? +r["Extra paid amount"] || 0 : 0));
const otherSpent = (a, b) => sum(DB.tblOther, o => o.Status === "Spent" && o.Date >= a && o.Date <= b ? o.Amount : 0);
const planOut = p => Math.max(0, (+p["Total out"] || 0) - (adjust[p.Payday] || 0));
const paydaysIn = vm => paydays.filter(p => monthKey(p.date) === vm);
const planFor = date => plan.find(p => p.Payday === date);
const whoOf = p => p.people.size > 1 ? "both" : (PEOPLE.indexOf([...p.people][0]) === 0 ? "both" : "single");

function kpis(vm) {
  const end = isoOf(vm, daysInMonth(vm));
  const pcs = DB.tblPaychecks.filter(p => p.Month === vm && p["Deposit date"] >= META.modelStart);
  const comingIn = sum(pcs, p => p["Amount used"]);
  const received = sum(pcs.filter(p => p["Deposit date"] <= META.asOf), p => p["Amount used"]);
  const paidSoFar = paidInRange(vm, end);
  const planned = sum(plan.filter(p => p.Payday >= vm && p.Payday <= end), planOut);
  const goingOut = paidSoFar + otherSpent(vm, end) + planned;
  const last = plan.filter(p => p.Payday >= vm && p.Payday <= end).pop();
  const ahead = plan.filter(p => p.Payday >= META.currentPayday);
  const low = ahead.reduce((m, p) => (m === null || p["Cash after"] < m["Cash after"]) ? p : m, null);
  const rows = viewRows(vm);
  const paidN = rows.filter(r => r.Remaining <= 0 && r["Paid total"] > 0).length;
  const late = rows.filter(r => r.Remaining > 0 && r["Days out"] < 0 && status(r).c !== "info").length;
  const soon = rows.filter(r => r.Remaining > 0 && r["Days out"] >= 0 && r["Days out"] <= META.soonOrangeDays && status(r).c !== "info").length;
  return { comingIn, received, paidSoFar, goingOut, left: last ? last["Cash after"] : null, paidN, total: rows.length, late, soon, low };
}

/* Checklists (panel and full view) */
function fridayRoutine() {
  const active = DB.tblDebts.filter(d => d["Expected category"] === "Active");
  const weekAgo = isoOf(META.asOf.slice(0, 8) + "01", 1) && new Date(D(META.asOf) - 6 * 864e5).toISOString().slice(0, 10);
  const cardsDone = active.every(d => d["Latest log date"] && d["Latest log date"] >= weekAgo);
  const bankDone = META.hasBankEntry === true && META.anchor >= weekAgo;
  const left = reg().filter(r => (+r["Payday amount"] || 0) > 0 && r.Remaining > 0).length;
  return [
    { on: cardsDone, label: "Card balances updated this week", note: "Friday update tab" },
    { on: bankDone, label: "PNC balance entered this week", note: "Friday update tab" },
    { step: true, label: "Pay the bills in the green box", note: "On the bank and card websites" },
    { on: left === 0, label: "Mark each one paid", note: left ? `${left} still to mark` : "All marked" },
  ];
}
function endOfMonth(vm) {
  const rows = viewRows(vm);
  const unpaid = rows.filter(r => r.Remaining > 0 || status(r).c === "info").length;
  const reasons = rows.filter(r => r["Needs reason"] === true).length;
  const m = DB.tblMonths.find(x => x.Month === vm);
  return [
    { on: unpaid === 0, label: "Every bill paid", note: `${rows.length - unpaid} of ${rows.length} done` },
    { on: reasons === 0, label: "Reasons picked for big differences", note: reasons ? `${reasons} bill${reasons === 1 ? "" : "s"} need a reason` : "Nothing needs a reason" },
    { on: m && m["Month closed?"] === "Yes", label: "Month marked closed", note: "Locks in the month's story" },
  ];
}

/* ========================================================================= actions */
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${msg}</span>${undo ? `<button type="button" id="toastUndo">Undo</button>` : ""}`;
  t.hidden = false;
  if (undo) $("#toastUndo").onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 6000);
}
/* Every write goes through here: it marks the panel busy (so our own edits don't trigger a refresh loop),
   shows a plain-language error if Excel refuses, and offers Undo. */
let busyUntil = 0;
async function guarded(fn) {
  busyUntil = Date.now() + 60000; document.body.classList.add("busy");
  try { return await fn(); }
  catch (e) { console.error(e); toast(`Couldn't save that to the workbook. ${esc(e.message || e)} — nothing was changed. Try Refresh, then again.`); return false; }
  finally { busyUntil = Date.now() + 1500; document.body.classList.remove("busy"); }
}
async function writeRow(row, values, msg) {
  const prev = Object.fromEntries(Object.keys(values).map(k => [k, row[k] ?? null]));
  const snap = JSON.parse(JSON.stringify(row)), adjSnap = { ...adjust };
  const ok = await guarded(async () => {
    await source.write({ table: "tblRegister", rowId: row.RowID, values });
    if (source.kind !== "sample") await reload();
    return true;
  });
  render();
  if (!ok) return;
  toast(msg, async () => {
    await guarded(async () => {
      if (source.kind === "sample") { Object.assign(row, snap); adjust = adjSnap; }
      else { await source.write({ table: "tblRegister", rowId: row.RowID, values: prev }); await reload(); }
    });
    render();
  });
}
async function reload() { DB = await source.load(); index(); }

/* Friday update: one tblCardLog row per card typed in, plus one tblCashLog row for the bank balance. */
async function saveFriday(fd) {
  const rows = [];
  DB.tblDebts.filter(d => d["Expected category"] !== "Loan").forEach(d => {
    const b = fd.get(`bal-${d.DebtID}`), m = fd.get(`min-${d.DebtID}`);
    if (b !== "" && b !== null) rows.push({ "Date": META.asOf, "Card or loan": d.Name, "Balance": +b, "Minimum": m === "" || m === null ? null : +m, "Note": "Dashboard" });
  });
  const bank = fd.get("bank");
  if (!rows.length && !bank) { toast("Nothing to save — type at least one balance."); return false; }
  const ok = await guarded(async () => {
    if (rows.length) await source.write({ table: "tblCardLog", append: rows });
    if (bank) await source.write({ table: "tblCashLog", append: [{ "Date": META.asOf, "PNC balance": +bank, "Note": "Dashboard" }] });
    if (source.kind === "sample") rows.forEach(r => { const d = DB.tblDebts.find(x => x.Name === r["Card or loan"]); d["Latest balance"] = r.Balance; d["Latest log date"] = r.Date; if (r.Minimum !== null) d["Latest minimum"] = r.Minimum; });
    else await reload();
    return true;
  });
  render();
  if (ok) toast(`Saved ${rows.length} card balance${rows.length === 1 ? "" : "s"}${bank ? " and the PNC balance" : ""}. The plan has been updated.`);
  return ok;
}
async function closeMonth(vm) {
  const ok = await guarded(async () => {
    await source.write({ table: "tblMonths", rowId: vm, values: { "Month closed?": "Yes" } });
    if (source.kind !== "sample") await reload();
    return true;
  });
  render();
  if (ok) toast(`${monthName(vm, { month: "long" })} marked closed`);
}

/* Record-payment form (same form in the panel and the full view). */
function payForm(r) {
  const hasFirst = !!r["Paid date"];
  const amt = hasFirst ? r["Paid amount"] : (+r["Payday amount"] || +r.Remaining || r.Amount);
  return `<form class="payform" data-form="pay" data-id="${esc(r.RowID)}">
    <label class="field">Date paid<input type="date" id="pf-date-${esc(r.RowID)}" name="date" value="${hasFirst ? r["Paid date"] : META.asOf}" required></label>
    <label class="field">Amount paid<input type="number" step="0.01" min="0" id="pf-amt-${esc(r.RowID)}" name="amount" value="${amt}" required></label>
    ${r.Source === "Bill" ? `<label class="field">Reason if different<select id="pf-reason-${esc(r.RowID)}" name="reason"><option value="">—</option>${REASONS.map(x => `<option ${r["Reason if different"] === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>` : ""}
    <label class="field note">Note<input type="text" id="pf-note-${esc(r.RowID)}" name="note" value="${esc(r.Notes || "")}" placeholder="optional"></label>
    ${hasFirst ? `<label class="field">Extra payment<input type="number" step="0.01" min="0" id="pf-extra-${esc(r.RowID)}" name="extra" value="${r["Extra paid amount"] || ""}" placeholder="0.00"></label>` : ""}
    <div class="form-actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="close-row">Cancel</button>${hasFirst ? `<button class="btn ghost" type="button" data-act="clear-row" data-id="${esc(r.RowID)}">Clear payment</button>` : ""}</div>
    <p class="form-msg" id="pf-msg-${esc(r.RowID)}">Budget for this bill: ${money(r.Budget)}. If you pay a different amount by more than ${money(META.varianceAmount, 0)} and ${Math.round(META.variancePct * 100)}%, pick a reason.</p>
  </form>`;
}

async function submitPay(f) {
  const row = reg().find(r => r.RowID === f.dataset.id), fd = new FormData(f);
  const amount = +fd.get("amount"), extra = fd.get("extra") ? +fd.get("extra") : null, reason = fd.get("reason") || null;
  const total = amount + (extra || 0), diff = total - row.Budget;
  const needs = row.Source === "Bill" && Math.abs(diff) > META.varianceAmount && Math.abs(diff) > META.variancePct * row.Budget;
  if (needs && !reason) { const m = $(`#pf-msg-${CSS.escape(row.RowID)}`); m.textContent = `That's ${money(Math.abs(diff))} ${diff > 0 ? "over" : "under"} the budget. Pick a reason from the list, then save.`; m.style.fontWeight = "600"; return; }
  const values = { "Paid date": fd.get("date"), "Paid amount": amount, "Notes": fd.get("note") || null };
  if (row.Source === "Bill") values["Reason if different"] = reason;
  if (f.querySelector('[name="extra"]')) { values["Extra paid amount"] = extra; values["Extra paid date"] = extra ? fd.get("date") : null; }
  state.openRow = null;
  await writeRow(row, values, `Saved ${esc(row.Bill)} · ${money(total)} on ${shortD(fd.get("date"))}`);
}
