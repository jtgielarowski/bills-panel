/* =============================================================================
   Bills & Paychecks — shared core (used by the Excel panel and the full view)
   -----------------------------------------------------------------------------
   The workbook is the engine. This code only reads the export/contract tables,
   shows them, and writes the few input columns listed below. No numbers live
   in this file; everything comes from the open workbook.
   Dashboard v4 · built for Gielarowski Financial Model (v4).xlsx (the add-in reads whichever workbook is open;
   v4 needs the v4 columns: tblRegister Badge tone / Record allowed / Autopay bill / story columns, tblExportStory, tblPlanLock).

   READS : tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory,
           tblExportCategory, tblExportChecks, tblExportStory, tblRegister, tblDebts, tblCardLog,
           tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory, tblDadSchedule, tblPlanLock
   WRITES: tblRegister payment input columns (matched by RowID) — only where tblRegister[Record allowed] = TRUE
           (or a saved payment being corrected), NEVER an auto pay row (tblRegister[Autopay bill] = TRUE);
           tblRegister[Statement amount] alone through "Set amount" (unpaid Variable bills; never touches
           Paid date/amount, never locks); tblCardLog / tblCashLog rows matched by Date (+ card) — a correction
           REPLACES that Friday's row, never adds a second one; tblPaychecks[Actual amount] (Person + Deposit date);
           tblDebts[BT payment mode, Fixed monthly payment] (DebtID); tblOther new rows; tblMonths[Month closed?];
           tblPlanLock — APPEND ONLY (values, never formulas; existing lock rows are never edited or deleted):
           the panel locks the Current month once, on load, when tblExportStory[Plan locked?] = FALSE.

   change = { table, rowId, values }                  → update one row by its key
          = { table, match:{col:value}, values, upsert } → update the matching row (or add it)
          = { table, append: [rows] }                  → add rows (fills the first blank row, else adds one)

   RULES: never writes a calculated column; a new log row is added empty (Excel fills the
   calculated columns itself) and only its input cells are written. Blank rows are skipped on read.

   LOCKING: after a save, the written input cells are locked (protection.locked = true)
   so typing over them in Excel needs Review ▸ Unprotect Sheet. A register row is
   locked while it has a Paid date and reopened when the payment is cleared.
   ============================================================================= */
"use strict";

const TABLES = ["tblExportMeta", "tblExportPlan", "tblExportCardPlan", "tblExportHistory", "tblExportCategory", "tblExportChecks", "tblExportStory",
  "tblRegister", "tblDebts", "tblCardLog", "tblCashLog", "tblOther", "tblPaychecks", "tblMonths", "tblDadHistory", "tblDadSchedule", "tblPlanLock"];
const VERSION = "v4";   // dashboard version (shown on Model details); the cache key in the .html files is separate (?v=7)
const ROW_KEY = { tblRegister: "RowID", tblMonths: "Month", tblDebts: "DebtID" };
const LOG_TABLES = ["tblCardLog", "tblCashLog", "tblOther"];
/* A row counts as blank (and is skipped on read) when all of these columns are empty. Other tables: when every cell is empty. */
const KEY_COLS = { tblRegister: ["RowID"], tblDebts: ["DebtID"], tblMonths: ["Month"], tblPaychecks: ["Person"],
  tblCardLog: ["Date", "Card or loan", "Balance"], tblCashLog: ["Date", "PNC balance"], tblOther: ["Date", "Description", "Amount"],
  tblBudgetChanges: ["BillID"], tblPlanLock: ["Key"], tblExportStory: ["Month"] };
const blankCell = v => v === null || v === undefined || v === "";
const isBlankRow = (table, row) => (KEY_COLS[table] || Object.keys(row)).every(k => blankCell(row[k]));
/* Columns the dashboard is allowed to write. Anything else is refused, so a bug here can never overwrite a formula. */
const WRITABLE = {
  tblRegister: ["Paid date", "Paid amount", "Extra paid date", "Extra paid amount", "Reason if different", "Notes", "Statement amount"],
  tblPaychecks: ["Actual amount"],                         // paycheck override for one payday (blank = expected)
  tblDebts: ["BT payment mode", "Fixed monthly payment"],  // balance-transfer plan switch (John, Detailed view only)
  tblMonths: ["Month closed?"],
  tblCardLog: ["Date", "Card or loan", "Balance", "Minimum", "Note"],
  tblCashLog: ["Date", "PNC balance", "Note"],
  tblOther: ["Date", "Description", "Category", "Amount", "Status", "Note"],
  tblPlanLock: ["Key", "Month", "Type", "Locked amount", "Locked on", "Note"],   // append only (auto-lock); every column is an input
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
        out[n] = rows.map((r, i) => Object.fromEntries(hdr.map((h, j) => [h, fromCell(r[j], fmts[i + 1][j])]))).filter(row => !isBlankRow(n, row));
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
    // Only the values being written must be writable; match keys (e.g. a paycheck's Person + Deposit date) are just used to find the row.
    const rows = change.append || [{ ...(change.upsert ? change.match : {}), ...change.values }];
    for (const r of rows) for (const k of Object.keys(r)) if (!allowed.includes(k)) throw new Error(`Not allowed to write ${change.table}[${k}]`);
    const isLog = LOG_TABLES.includes(change.table);
    if (change.bulk) return this.appendBulk(change, allowed);
    return Excel.run(async ctx => {
      const t = ctx.workbook.tables.getItem(change.table);
      const hdrR = t.getHeaderRowRange(), body = t.getDataBodyRange();
      hdrR.load("values"); body.load("values, numberFormat, rowCount"); await ctx.sync();
      const cols = hdrR.values[0], ci = c => cols.indexOf(c);
      const cellText = (i, c) => String(fromCell(body.values[i][ci(c)], (body.numberFormat[i] || [])[ci(c)]) ?? "");
      const findRow = crit => body.values.findIndex((_, i) => Object.entries(crit).every(([k, v]) => cellText(i, k) === String(v ?? "")));
      const lockRow = (row, locked) => allowed.forEach(c => { if (ci(c) >= 0) row.getCell(0, ci(c)).format.protection.locked = locked; });
      await this.withSheet(ctx, t, async () => {
        const add = async r => {
          // Reuse the first row whose input columns are all blank (pre-sized tables); otherwise add a row.
          const blank = body.values.findIndex(v => allowed.every(c => ci(c) < 0 || v[ci(c)] === ""));
          if (blank >= 0) {
            for (const [k, v] of Object.entries(r)) body.getCell(blank, ci(k)).values = [[toCell(v)]];
            body.values[blank] = body.values[blank].map((x, j) => (cols[j] in r ? toCell(r[cols[j]]) : x));
            if (isLog) lockRow(body.getRow(blank), true);
          } else {
            // Add an EMPTY row (Excel extends the calculated columns by itself), then write only the input cells.
            // Calculated columns are never written, not even with copied formulas.
            t.rows.add(null);
            await ctx.sync();
            const last = t.getDataBodyRange().getLastRow();
            for (const [k, v] of Object.entries(r)) last.getCell(0, ci(k)).values = [[toCell(v)]];
            if (isLog) lockRow(last, true);
          }
          await ctx.sync();
        };
        if (change.append) { for (const r of change.append) await add(r); return; }
        const idx = findRow(change.match || { [ROW_KEY[change.table]]: change.rowId });
        if (idx < 0) {
          if (change.upsert) { await add({ ...change.match, ...change.values }); return; }
          throw new Error(`Row ${change.rowId || JSON.stringify(change.match)} not found in ${change.table}`);
        }
        for (const [k, v] of Object.entries(change.values)) body.getCell(idx, ci(k)).values = [[toCell(v)]];
        if (change.table === "tblRegister") {
          const paid = "Paid date" in change.values ? change.values["Paid date"] : cellText(idx, "Paid date");
          lockRow(body.getRow(idx), !!paid);     // saved payment = locked; cleared payment = open again
        } else if (isLog) lockRow(body.getRow(idx), true);
        await ctx.sync();
      });
    });
  },
  /* Adds all rows in ONE call (one sync), so a lock is written completely or not at all. Only for tables whose
     every column is an input (tblPlanLock): existing rows are never touched. */
  async appendBulk(change, allowed) {
    return Excel.run(async ctx => {
      const t = ctx.workbook.tables.getItem(change.table), hdrR = t.getHeaderRowRange();
      hdrR.load("values"); await ctx.sync();
      const cols = hdrR.values[0];
      if (!cols.every(c => allowed.includes(c))) throw new Error(`${change.table} has calculated columns — bulk append refused`);
      const rows = change.append.map(r => cols.map(c => toCell(r[c] ?? null)));
      await this.withSheet(ctx, t, async () => { t.rows.add(null, rows); await ctx.sync(); });
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
    if (change.match) {
      const hit = t.filter(r => Object.entries(change.match).every(([k, v]) => String(r[k] ?? "") === String(v ?? ""))).at(-1);
      if (hit) Object.assign(hit, change.values); else if (change.upsert) t.push({ ...change.match, ...change.values });
      return;
    }
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
const state = { view: "month", vm: null, openRow: null, amtRow: null, cat: null, detailed: false, fri: { date: null, unlocked: false } };

/* A month cell can arrive as a serial number when its column is formatted General (tblRegister[Story cash month]). */
const asIso = v => (typeof v === "number" && v > 0) ? serialToIso(v) : v;
const round2 = v => Math.round((+v || 0) * 100) / 100;
function index() {
  META = Object.fromEntries(DB.tblExportMeta.map(r => [r.Key, r.Value]));
  DB.tblRegister.forEach(r => { if ("Story cash month" in r) r["Story cash month"] = asIso(r["Story cash month"]); });
  DB.tblExportStory = DB.tblExportStory || []; DB.tblPlanLock = DB.tblPlanLock || [];
  DB.tblPlanLock.forEach(l => { l.Month = asIso(l.Month); });
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

/* After a payment or a known amount is recorded in preview mode, update the row the way Excel would. */
function localRecalc(r) {
  const paid = (+r["Paid amount"] || 0) + (+r["Extra paid amount"] || 0);
  const before = (+r["Remaining must"] || 0) + (+r["Extra planned"] || 0);
  if (r.Source === "Bill" && typeOf(r) === "Variable") {        // Amount = known amount (Variable bills), else Budget
    r["Amount known?"] = isVal(r["Statement amount"]) && !isNaN(+r["Statement amount"]);
    r.Amount = r["Amount known?"] ? +r["Statement amount"] : +r.Budget || 0;
    r.Suggested = r.Minimum = r["Must pay"] = r.Amount;
    r["Suggested basis"] = r["Amount known?"] ? "statement" : "budget estimate";
  }
  r["Paid total"] = paid;
  r.Remaining = r["Paid date"] ? 0 : Math.max(0, Math.round((r.Amount - paid) * 100) / 100);   // a recorded payment settles the row
  r["Remaining must"] = Math.min(r.Remaining, Math.max(0, (r["Must pay"] || 0) - paid));
  if (r.Source === "Bill" && r["Planned date"] && r.Remaining > 0) {   // a known amount changes what the payday pays
    r["Remaining must"] = r.Remaining; if (r["Payday amount"] > 0) r["Payday amount"] = r.Remaining;
    adjust[r["Planned date"]] = (adjust[r["Planned date"]] || 0) + before - r.Remaining;
  }
  if (r["Planned date"] && r.Remaining === 0) adjust[r["Planned date"]] = (adjust[r["Planned date"]] || 0) + before;
  if (r.Remaining === 0) { r["Payday amount"] = 0; r["Planned date"] = r["Planned date"]; }
  r["Pay from"] = r.Remaining === 0 && paid > 0 ? "Paid " + fmtD(r["Paid date"], { weekday: "short", month: "numeric", day: "numeric" }) : r["Pay from"];
  r["Cash month"] = r["Paid date"] ? monthKey(r["Paid date"]) : r["Cash month"];
  if (r["Paid date"]) { r.Autopaid = false; r["Eff paid date"] = r["Paid date"]; r["Eff paid amount"] = +r["Paid amount"] || 0; }
  r.Status = r.Remaining === 0 && paid > 0 ? "Paid ✓" : null;      // null = let status() work it out
  r.Variance = r.Source === "Bill" && paid > 0 ? Math.round((paid - r.Budget) * 100) / 100 : null;
  r["Over threshold"] = r.Variance !== null && varianceCheck(paid, r.Budget).state === "over";
  r["Needs reason"] = r["Over threshold"] && !r["Reason if different"];
}

/* =========================================================================
   Variance rule (% only). A bill payment needs a reason when
     |paid − budget| > variancePct × budget        (a $0 budget: any non-zero amount)
   variancePct always comes from tblExportMeta (Setup ▸ variance %). There is no $ threshold any more.
   ========================================================================= */
function varianceCheck(amount, budget, pct = +META.variancePct) {
  if (blankCell(amount) || isNaN(+amount)) return { state: "blank" };
  const b = +budget || 0, diff = Math.round((+amount - b) * 100) / 100;
  const over = b === 0 ? Math.abs(diff) >= 0.005 : Math.abs(diff) - pct * b > 1e-9;
  return { state: over ? "over" : "within", diff, pct: b ? Math.abs(diff) / b : null, dir: diff > 0 ? "over" : "under" };
}
const pctText = p => `${+(p * 100).toFixed(1)}%`;                       // 0.1 → "10%", 0.125 → "12.5%"
/* Whole % like the workbook; one decimal when rounding would make an over-threshold amount look like it's at the threshold. */
const varPctText = (p, thr) => Math.round(p * 100) > +(thr * 100).toFixed(1) ? `${Math.round(p * 100)}%` : pctText(p);
function varianceMessage(v, budget, pct = +META.variancePct) {
  const b = money(+budget || 0), t = pctText(pct);
  if (v.state === "blank") return `Budget for this bill: ${b}. If you pay more than ${t} above or below it, pick a reason.`;
  if (v.state === "within") return `Within ${t} of budget (${b})`;
  if (v.pct === null) return `${v.dir === "over" ? "Over" : "Under"} the ${b} budget. Pick a reason.`;
  return `${varPctText(v.pct, pct)} ${v.dir} the ${b} budget (more than ${t}). Pick a reason.`;
}

/* =========================================================================
   Paid or not — from the workbook's Status / Autopaid / Eff paid columns, never from Paid date alone.
   An autopay bill counts as paid once its due date passes (Autopaid = TRUE, Status "Paid ✓", Paid date blank).
   ========================================================================= */
const isAutopaid = r => r.Autopaid === true;
/* ---- Status badge (v4): text = tblRegister[Status], colour = tblRegister[Badge tone]. The workbook decides urgency —
   this code never works it out from due dates. Older workbooks (no Badge tone column) fall back to the v3 logic. */
const TONES = ["red", "orange", "yellow", "blue", "green", "purple", "none"];
const hasTone = r => "Badge tone" in r;
const toneOf = r => TONES.includes(r["Badge tone"]) ? r["Badge tone"] : "none";
const isPaid = r => !!r.Applies && (hasTone(r) ? toneOf(r) === "green"
  : isVal(r.Status) ? String(r.Status).startsWith("Paid") : (isAutopaid(r) || (r.Remaining <= 0 && (+r["Paid total"] || 0) > 0)));
/* ---- Auto pay (v4): the bank drafts it; the model counts it paid on the draft date. Shown, never written to. */
const isAutoBill = r => r["Autopay bill"] === true;
/* Record payment / Set amount / Mark paid only where the workbook allows it (FALSE for auto pay and paid rows). */
const recordOk = r => !isAutoBill(r) && (("Record allowed" in r) ? r["Record allowed"] === true : !!r.Applies && r.Remaining > 0);
/* A saved payment can still be unlocked and corrected — but never on an auto pay row. */
const canUnlock = r => !!r["Paid date"] && !isAutoBill(r);
const needsBalance = r => hasTone(r) ? r.Status === "Enter balance" : (r.Source === "Debt" && !r["Paid date"] && (debtsById[r.ItemID] || {}).Flag === "Needs Friday balance");
const effDate = r => ("Eff paid date" in r) ? r["Eff paid date"] : r["Paid date"];
const effAmt = r => ("Eff paid date" in r) ? (isVal(r["Eff paid date"]) ? +r["Eff paid amount"] || 0 : 0) : (+r["Paid amount"] || 0);
const autoTag = r => isAutoBill(r) ? `<span class="tag autopay" title="Auto pay: the bank drafts it on the due date and the model counts it paid then. Nothing to record.">Auto pay</span>`
  : isAutopaid(r) ? `<span class="tag auto" title="Autopay: counted as paid on the due date.">Autopaid</span>` : "";

/* ========================================================================= derived data */
const reg = () => DB.tblRegister;
function status(r) {
  if (!r.Applies) return { t: "Not needed", c: "muted" };
  if (hasTone(r)) return { t: isVal(r.Status) ? String(r.Status) : "—", c: `t-${toneOf(r)}`, tone: toneOf(r) };
  const flag = r.Source === "Debt" ? (debtsById[r.ItemID] || {}).Flag : "";
  if (r.Source === "Debt" && !r["Paid date"] && flag === "Needs Friday balance") return { t: "Enter balance", c: "info" };
  if (isPaid(r)) return { t: "Paid", c: "paid" };
  if (r.Remaining <= 0) return { t: "—", c: "muted" };
  if (r["Paid total"] > 0) return { t: "Part paid", c: "part" };
  const d = r["Days out"];
  if (d < 0) return { t: `Late · ${-d} day${d === -1 ? "" : "s"}`, c: "late" };
  if (d === 0) return { t: "Due today", c: "red" };
  if (d === 1) return { t: "Due tomorrow", c: "red" };
  if (d <= META.soonOrangeDays) return { t: `In ${d} days`, c: "orange" };
  if (d <= META.soonYellowDays) return { t: `In ${d} days`, c: "yellow" };
  return { t: "Upcoming", c: "up" };
}
function inView(r, vm) {
  if (!r.Applies) return false;
  if (r.Month === vm) return true;
  if (r.Month === addMonths(vm, -1)) {
    const ep = effDate(r);
    if (!ep) return r.Remaining > 0 && (!r["Planned date"] || r["Planned date"] >= vm);
    return ep >= vm;
  }
  return false;
}
const viewRows = vm => reg().filter(r => inView(r, vm));
const groupOf = (r, vm) => r.Month < vm ? "Last month's bills" : r.Category;
/* Money paid out between two dates — Eff paid date / Eff paid amount (includes autopaid bills, like the Export totals) + extra payments. */
const paidInRange = (a, b) => sum(reg(), r => { const d = effDate(r); return ((d && d >= a && d <= b) ? effAmt(r) : 0) + ((r["Extra paid date"] && r["Extra paid date"] >= a && r["Extra paid date"] <= b) ? +r["Extra paid amount"] || 0 : 0); });
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
  const paidN = rows.filter(isPaid).length;
  // Needs attention = badge colours from the workbook (red = urgent, orange = due soon); yellow / blue / green never count.
  const late = rows.filter(r => hasTone(r) ? toneOf(r) === "red" : r.Remaining > 0 && r["Days out"] < 0 && !needsBalance(r)).length;
  const soon = rows.filter(r => hasTone(r) ? toneOf(r) === "orange" : r.Remaining > 0 && r["Days out"] >= 0 && r["Days out"] <= META.soonOrangeDays && !needsBalance(r)).length;
  // Months past the paycheck plan (look-ahead ends at horizonEnd): forecast from tblExportStory instead of $0 / —.
  const st = storyRow(vm), forecast = !last && !!st && end > META.horizonEnd;
  const fGoing = forecast ? (+st["Bills cash this month"] || 0) + (+st["Other expenses"] || 0) : goingOut;
  return { comingIn, received, paidSoFar, goingOut: fGoing, left: last ? last["Cash after"] : forecast ? +st["Expected left over"] : null, forecast, paidN, total: rows.length, late, soon, low };
}

/* tblExportStory row for a month (one row per month). */
const storyRow = vm => DB.tblExportStory.find(s => s.Month === vm) || null;
/* Status marks: round, read-only badges (they tick themselves) — deliberately unlike checkboxes. */
const statusMark = x => `<span class="smark ${x.on ? "on" : x.step ? "step" : ""}" title="Fills in automatically" aria-label="${x.on ? "Done" : x.step ? "Your step" : "Not done yet"}">${x.on ? "✓" : x.step ? "→" : ""}</span>`;
/* Key for the due-date colours (same scale in the panel, the full view and the This Month sheet). */
const statusKey = () => `<div class="stkey" aria-label="What the colours mean"><span>Colours:</span><span class="pill st t-red">Overdue or due within ${+META.soonRedDays || 1} day</span><span class="pill st t-orange">Due in ${(+META.soonRedDays || 1) + 1}–${META.soonOrangeDays} days</span><span class="pill st t-yellow">Due within ${META.soonYellowDays} days, or scheduled</span><span class="pill st t-blue">Auto pay</span><span class="pill st t-purple">Enter card balance</span><span class="pill st t-none">Upcoming</span><span class="pill st t-green">Paid</span></div>`;
const keyLine = () => `<p class="keyline"><span><i class="k-in"></i>You type here</span><span><i class="smark on">✓</i>Fills in automatically</span><span>🔒 Saved — unlock to change</span></p>`;

/* Checklists (panel and full view) */
/* ---- Cards on the Friday update: every switched-on card, every Friday (a $0 card is entered as 0).
   Order: Active, then Balance Transfer, then $0 Balance; within each, highest latest saved balance first. */
const CARD_CATS = ["Active", "Balance Transfer", "$0 Balance"];
function latestSaved(name, onOrBefore) {
  return DB.tblCardLog.filter(l => l["Card or loan"] === name && isVal(l.Balance) && (!onOrBefore || l.Date <= onOrBefore))
    .reduce((best, l) => (!best || l.Date >= best.Date) ? l : best, null);
}
function fridayCards(date) {
  return DB.tblDebts.filter(d => d.Name && d.Show === "Yes" && CARD_CATS.includes(d["Expected category"]))
    .map(d => ({ d, bal: +((latestSaved(d.Name, date) || {}).Balance) || 0 }))
    .sort((a, b) => CARD_CATS.indexOf(a.d["Expected category"]) - CARD_CATS.indexOf(b.d["Expected category"]) || b.bal - a.bal)
    .map(x => x.d);
}
function fridayRoutine() {
  const cards = fridayCards();
  const weekAgo = new Date(D(META.asOf) - 6 * 864e5).toISOString().slice(0, 10);
  const cardsDone = cards.every(d => d["Latest log date"] && d["Latest log date"] >= weekAgo);
  const bankDone = META.hasBankEntry === true && META.anchor >= weekAgo;
  const left = reg().filter(r => (+r["Payday amount"] || 0) > 0 && r.Remaining > 0 && !isAutoBill(r)).length;
  return [
    { on: cardsDone, label: "All card balances entered this week", note: "Friday update tab — every card, 0 if it's $0" },
    { on: bankDone, label: "PNC balance entered this week", note: "Friday update tab" },
    { step: true, label: "Pay the bills in the green box", note: "On the bank and card websites" },
    { on: left === 0, label: "Mark each one paid", note: left ? `${left} still to mark` : "All marked" },
  ];
}
function endOfMonth(vm) {
  const rows = viewRows(vm);
  const unpaid = rows.filter(r => r.Remaining > 0 || needsBalance(r)).length;
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
  if (isAutoBill(row)) { toast(`${esc(row.Bill)} is on auto pay — the workbook counts it paid on the draft date, so there's nothing to record.`); return; }
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
/* Re-read every table (after a month change or any save) so the views update without a manual refresh. */
async function refreshData() { if (source.kind === "sample") return true; return guarded(async () => { await reload(); return true; }); }

/* =========================================================================
   Auto-lock the plan (v4). Runs in the Excel panel only (the full dashboard is always opened from it), once per
   month per session: when the tblExportStory row with Status "Current" has Plan locked? = FALSE, APPEND to
   tblPlanLock (values only): one row per tblRegister row of that month with Applies = TRUE
   (Key = RowID, Month, Type = Source, Locked amount = Plan now, Locked on = now, Note "Auto-locked by dashboard"),
   then the INCOME|yyyy-mm row (Locked amount = tblExportStory[Income plan now]). The Income row is what marks
   the month locked, so it goes last; all rows are added in one call. Existing lock rows are never edited or deleted.
   ========================================================================= */
const lockTried = {};
const nowSerial = () => { const d = new Date(); return Math.round(((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5 + 25569) * 1e6) / 1e6; };
function planLockRows(m) {
  const cur = storyRow(m), now = nowSerial(), note = "Auto-locked by dashboard";
  const rows = reg().filter(r => r.Month === m && r.Applies === true)
    .map(r => ({ "Key": r.RowID, "Month": m, "Type": r.Source, "Locked amount": round2(r["Plan now"]), "Locked on": now, "Note": note }));
  rows.push({ "Key": `INCOME|${m.slice(0, 7)}`, "Month": m, "Type": "Income", "Locked amount": round2(cur["Income plan now"]), "Locked on": now, "Note": note });
  return rows;
}
async function autoLockPlan() {
  const cur = DB.tblExportStory.find(s => s.Status === "Current");
  if (!cur || cur["Plan locked?"] !== false) return false;
  const m = cur.Month;
  if (lockTried[m]) return false;
  if (DB.tblPlanLock.some(l => l.Type === "Income" && l.Month === m)) return false;   // already locked (workbook not recalculated yet)
  lockTried[m] = true;
  const rows = planLockRows(m);
  const ok = await guarded(async () => { await source.write({ table: "tblPlanLock", append: rows, bulk: true }); await reload(); return true; });
  if (ok) toast(`Locked the ${monthName(m, { month: "long" })} plan (${rows.length - 1} bills + paychecks) — the Monthly Story compares against it.`);
  return ok;
}

/* =========================================================================
   Friday update — one saved entry per card per Friday, plus one PNC balance per Friday.
   Saved entries are shown locked; "Unlock to edit" reopens them and saving REPLACES
   that Friday's rows (match on Date + card), so a balance can never be counted twice.
   ========================================================================= */
const isVal = v => v !== null && v !== undefined && v !== "";
/* The Friday an update belongs to: the latest payday on or before today. */
function fridayEntryDate() { const past = paydays.filter(p => p.date <= META.asOf); return past.length ? past.at(-1).date : (paydays[0] || {}).date; }
/* Pay periods (paydays) shown in the picker for the month on screen; keeps the selection valid. */
function fridayPeriods(vm) {
  const list = paydaysIn(vm).map(p => p.date);
  if (!list.includes(state.fri.date)) {
    const entry = fridayEntryDate();
    state.fri.date = list.includes(entry) ? entry : (list.filter(d => d <= META.asOf).at(-1) || list[0] || null);
    state.fri.unlocked = false;
  }
  return list;
}
function fridayInfo(date) {
  const cards = fridayCards(date);
  const saved = {};
  DB.tblCardLog.forEach(l => { if (l.Date === date && isVal(l.Balance)) saved[l["Card or loan"]] = l; });   // last one wins
  const bank = DB.tblCashLog.filter(c => c.Date === date && isVal(c["PNC balance"])).at(-1) || null;
  const any = !!bank || Object.keys(saved).length > 0, entry = fridayEntryDate();
  const st = any ? "saved" : !date || date > META.asOf ? "future" : date === entry ? "open" : "missed";
  return { date, cards, saved, bank, state: st, entry, editable: st === "open" || (st === "saved" && state.fri.unlocked) };
}
function fridayPicker(vm) {
  const list = fridayPeriods(vm);
  if (!list.length) return `<p class="hint">No paydays in ${monthName(vm, { month: "long" })}.</p>`;
  return `<div class="periods" role="group" aria-label="Pay period">${list.map(d => {
    const i = fridayInfo(d), mark = i.state === "saved" ? "🔒" : i.state === "open" ? "•" : "";
    return `<button type="button" class="period ${i.state}" data-act="pick-friday" data-date="${d}" aria-pressed="${d === state.fri.date}"><span>${fmtD(d, { weekday: "short", month: "short", day: "numeric" })}</span><small>${mark} ${{ saved: "Saved", open: "Today", missed: "Not entered", future: "Upcoming" }[i.state]}</small></button>`;
  }).join("")}</div>`;
}
function fridayBanner(i) {
  const d = fmtD(i.date, { weekday: "short", month: "short", day: "numeric" });
  if (i.state === "saved" && !state.fri.unlocked) return `<div class="lockbar"><span>🔒 <b>Saved for ${d}.</b> These values are locked.</span><button type="button" class="btn small" data-act="unlock-friday">Unlock to edit</button></div>`;
  if (i.state === "saved") return `<div class="lockbar editing"><span><b>Editing ${d}.</b> Saving replaces what was saved for that Friday. Blank boxes keep their saved value.</span><button type="button" class="btn small ghost" data-act="lock-friday">Cancel</button></div>`;
  if (i.state === "open") return `<div class="lockbar open"><span><b>${d}:</b> type each balance, then Save. Entries lock once saved.</span></div>`;
  if (i.state === "missed") return `<div class="lockbar muted"><span>Nothing was saved for ${d}.</span></div>`;
  return `<div class="lockbar muted"><span>${d} hasn't come yet.</span></div>`;
}
/* Mid-week spend card, read from that Friday's tblCashLog row (all numbers come from the workbook). */
const PNC_LABEL = "PNC available balance — including today's paychecks, before paying today's bills.";
function midweekCard(c) {
  if (!c || !isVal(c["PNC balance"])) return "";
  if (!isVal(c["Previous date"])) return `<div class="mw-card first">Starting balance — mid-week spend starts next Friday.</div>`;
  const mw = +c["Mid-week spend"] || 0;
  const note = mw > 0.005 ? `<div class="mw-note amber">spent ${money(mw)} more than recorded</div>`
    : mw < -0.005 ? `<div class="mw-note green">${money(-mw)} more cash than expected</div>` : "";
  return `<div class="mw-card"><div class="mw-line">Expected: <b class="money">${money(c["Expected balance"])}</b> · You entered: <b class="money">${money(c["PNC balance"])}</b> · Mid-week spend: <b class="money">${money(mw)}</b></div>${note}</div>`;
}
/* One value cell: a locked value, an input, or a dash. */
function fridayField(i, name, label, saved, placeholder = "") {
  if (i.editable) return `<input type="number" step="0.01" min="0" inputmode="decimal" name="${name}" aria-label="${esc(label)}" value="${isVal(saved) ? saved : ""}" placeholder="${esc(placeholder)}">`;
  return isVal(saved) ? `<span class="locked-val" title="Saved — use Unlock to edit">${money(saved)}</span>` : `<span class="hint">—</span>`;
}
/* ---- Paycheck override (F6): Setup ▸ Paychecks ▸ Actual amount for one payday; blank = the expected amount. */
const paychecksOn = date => DB.tblPaychecks.filter(p => p["Deposit date"] === date && p.Person);
function paycheckRows(date, editable) {
  const list = paychecksOn(date);
  if (!list.length) return "";
  return list.map((p, k) => {
    const exp = +p.Amount || 0, act = isVal(p["Actual amount"]) ? +p["Actual amount"] : null;
    const field = editable
      ? `<input type="number" step="0.01" min="0" inputmode="decimal" name="pay-${k}" aria-label="${esc(p.Person)} paycheck amount" value="${act ?? ""}" placeholder="blank = ${money(exp)}">`
      : (act !== null ? `<span class="locked-val" title="Saved — use Unlock to edit">${money(act)}</span>` : `<span class="auto-chip" title="Fills in automatically">${money(exp)} expected</span>`);
    return `<div class="pc-row"><span class="pc-who"><i class="sw" style="background:${personColor(p.Person)}"></i><b>${esc(p.Person)}</b><small>expected ${money(exp)}</small></span>
      <label class="p-in">${editable ? "Different amount?" : "Amount used"}${field}</label>
      ${editable && act !== null ? `<button type="button" class="linkish" data-act="pay-clear" data-person="${esc(p.Person)}" data-date="${date}">Use expected</button>` : ""}</div>`;
  }).join("");
}
function paycheckWrites(fd, date) {
  const writes = [];
  paychecksOn(date).forEach((p, k) => {
    const v = fd.get(`pay-${k}`);
    if (!isVal(v)) return;                                       // blank = keep (expected, or the saved override)
    if (isVal(p["Actual amount"]) && +p["Actual amount"] === +v) return;
    writes.push({ table: "tblPaychecks", match: { "Person": p.Person, "Deposit date": date }, values: { "Actual amount": +v } });
  });
  return writes;
}
/* Standalone paycheck form for future Fridays (full dashboard): plan a different amount ahead of time. */
function paycheckForm(date) {
  const list = paychecksOn(date); if (!list.length) return "";
  const saved = list.some(p => isVal(p["Actual amount"])), open = !saved || state.fri.payUnlocked === date;
  return `<form class="pc-card" data-form="paychecks" data-date="${date}">
    <div class="pc-head"><b>Paychecks on ${fmtD(date)}</b>${saved && !open ? `<button type="button" class="btn small" data-act="pay-unlock" data-date="${date}">🔒 Unlock to edit</button>` : ""}</div>
    ${paycheckRows(date, open)}
    ${open ? `<div class="form-actions" style="margin-top:8px"><button class="btn primary small" type="submit">Save paychecks</button><span class="hint">Leave blank to use the expected amount.</span></div>` : ""}
  </form>`;
}
async function savePaychecks(fd, date) {
  const writes = paycheckWrites(fd, date);
  if (!writes.length) { state.fri.payUnlocked = null; render(); toast("Nothing changed."); return; }
  const ok = await guarded(async () => { for (const w of writes) await source.write(w); if (source.kind !== "sample") await reload(); else writes.forEach(applySamplePay); return true; });
  if (ok) { state.fri.payUnlocked = null; toast(`Saved the paycheck amount${writes.length === 1 ? "" : "s"} for ${shortD(date)}. The plan uses ${writes.length === 1 ? "it" : "them"} now.`); }
  render();
}
function applySamplePay(w) { const p = DB.tblPaychecks.find(x => x.Person === w.match.Person && x["Deposit date"] === w.match["Deposit date"]); if (p) { p["Actual amount"] = w.values["Actual amount"]; p["Amount used"] = isVal(w.values["Actual amount"]) ? w.values["Actual amount"] : p.Amount; } }
async function clearPaycheck(person, date) {
  const w = { table: "tblPaychecks", match: { "Person": person, "Deposit date": date }, values: { "Actual amount": null } };
  const ok = await guarded(async () => { await source.write(w); if (source.kind !== "sample") await reload(); else applySamplePay(w); return true; });
  render(); if (ok) toast(`${esc(person)}'s paycheck on ${shortD(date)} is back to the expected amount.`);
}

/* ---- Balance-transfer plan switch (G2-b/g): everyone sees it; only the Detailed view can change it. */
const promoLabel = d => d["Promo end"] ? monthName(d["Promo end"], { month: "short", year: "numeric" }) : "promo end";
const btPlanText = d => d["BT payment mode"] === "Payoff by promo end"
  ? `Plan uses: pay off by ${promoLabel(d)} — ${money(d["Payoff payment"])}/month now`
  : `Plan uses: Fixed ${money(d["Fixed monthly payment"])}/month`;
function btForm(d) {
  if (state.btUnlocked !== d.DebtID) return `<div class="bt-line"><span>${esc(btPlanText(d))}</span><button type="button" class="btn small" data-act="bt-unlock" data-id="${esc(d.DebtID)}">Change plan</button></div>`;
  const payoff = d["BT payment mode"] === "Payoff by promo end";
  return `<form class="bt-form" data-form="bt" data-id="${esc(d.DebtID)}">
    <label class="bt-opt"><input type="radio" name="mode" value="Fixed" ${payoff ? "" : "checked"}> Fixed <input type="number" step="5" min="0" name="fixed" value="${+d["Fixed monthly payment"] || 500}" aria-label="Fixed monthly payment"> a month <small>still owed at ${esc(promoLabel(d))}: about ${money(d["Owed at promo end"], 0)}</small></label>
    <label class="bt-opt"><input type="radio" name="mode" value="Payoff by promo end" ${payoff ? "checked" : ""}> Pay off by ${esc(promoLabel(d))}: <b class="money">${money(d["Payoff payment"])}</b> a month now <small>recalculated every Friday from the current balance</small></label>
    <div class="form-actions"><button class="btn primary small" type="submit">Save plan</button><button class="btn small" type="button" data-act="bt-cancel">Cancel</button></div>
  </form>`;
}
async function saveBT(f) {
  const fd = new FormData(f), id = f.dataset.id, mode = fd.get("mode"), fixed = +fd.get("fixed") || 0;
  const ok = await guarded(async () => {
    await source.write({ table: "tblDebts", rowId: id, values: { "BT payment mode": mode, "Fixed monthly payment": fixed } });
    if (source.kind !== "sample") await reload(); else Object.assign(debtsById[id], { "BT payment mode": mode, "Fixed monthly payment": fixed });
    return true;
  });
  state.btUnlocked = null; render();
  if (ok) toast(mode === "Fixed" ? `Balance transfer plan: Fixed ${money(fixed)} a month.` : `Balance transfer plan: pay off by the promo end.`);
}

async function saveFriday(fd, i) {
  const writes = [];
  i.cards.forEach(d => {
    const b = fd.get(`bal-${d.DebtID}`), m = fd.get(`min-${d.DebtID}`);
    if (!isVal(b)) return;                                     // blank = skip (or keep the saved value)
    const old = i.saved[d.Name], vals = { "Balance": +b, "Minimum": isVal(m) ? +m : (old ? old.Minimum : null), "Note": "Dashboard" };
    if (old && +old.Balance === vals.Balance && String(old.Minimum ?? "") === String(vals.Minimum ?? "")) return;   // unchanged
    writes.push({ table: "tblCardLog", match: { "Date": i.date, "Card or loan": d.Name }, upsert: true, values: vals });
  });
  const bank = fd.get("bank");
  if (isVal(bank) && !(i.bank && +i.bank["PNC balance"] === +bank)) writes.push({ table: "tblCashLog", match: { "Date": i.date }, upsert: true, values: { "PNC balance": +bank, "Note": "Dashboard" } });
  const pays = paycheckWrites(fd, i.date);
  writes.push(...pays);
  if (!writes.length) {
    if (i.state === "saved") { state.fri.unlocked = false; render(); toast("Nothing changed — still locked."); return true; }
    toast("Nothing to save — type at least one balance."); return false;
  }
  const ok = await guarded(async () => {
    for (const w of writes) await source.write(w);
    if (source.kind === "sample") { writes.filter(w => w.table === "tblCardLog").forEach(w => { const d = DB.tblDebts.find(x => x.Name === w.match["Card or loan"]); d["Latest balance"] = w.values.Balance; d["Latest log date"] = i.date; if (w.values.Minimum !== null) d["Latest minimum"] = w.values.Minimum; }); pays.forEach(applySamplePay); }
    else await reload();
    return true;
  });
  if (ok) state.fri.unlocked = false;
  render();
  const nCards = writes.filter(w => w.table === "tblCardLog").length, nBank = writes.filter(w => w.table === "tblCashLog").length, nPay = pays.length;
  const parts = [nCards ? `${nCards} card balance${nCards === 1 ? "" : "s"}` : "", nBank ? "the PNC balance" : "", nPay ? `${nPay} paycheck amount${nPay === 1 ? "" : "s"}` : ""].filter(Boolean);
  if (ok) toast(`Saved ${parts.join(" and ")} for ${shortD(i.date)}. They're locked now.`);
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

/* =========================================================================
   Minimum / Suggested (from the workbook) and the record-payment form.
   Minimum   = the least that can be paid (bills: the bill amount; cards & BT: the Friday minimum; loans: the payment)
   Suggested = what the plan says to pay (cards: minimum + spare cash placed by the planner)
   Rules (S1): a card, balance-transfer or loan payment below the minimum can't be saved;
   between the minimum and the suggested amount it saves with a note.
   ========================================================================= */
const typeOf = r => r["Amount type"] || (r.Source === "Debt" ? "Card" : "Fixed");
const typeTag = r => { const t = typeOf(r); return `<span class="typ ${t === "Variable" ? "var" : t === "Card" ? "card" : "fixed"}">${t === "Variable" ? "VARIABLE" : t === "Card" ? "CARD" : "FIXED"}</span>`; };
const minOf = r => (r["Paid date"] && +r["Min at payment"] > 0) ? +r["Min at payment"] : (+r.Minimum || 0);
const sugOf = r => +r.Suggested || 0;
const basisOf = r => r["Suggested basis"] || "";
const blocksBelowMin = r => r.Source === "Debt";
/* Variance on a paid bill (paid − budget), e.g. "−$0.30 vs budget"; empty when none. */
const varText = r => (r.Source === "Bill" && r.Variance !== null && r.Variance !== undefined && r.Variance !== "" && Math.abs(+r.Variance) >= 0.005) ? `${+r.Variance > 0 ? "+" : "−"}${money(Math.abs(+r.Variance)).replace("−", "")} vs budget` : "";
/* =========================================================================
   Known amount ("Set amount") — Variable bills only.
   A known amount is the bill's real amount, entered BEFORE paying (from the statement). It writes only
   tblRegister[Statement amount] by RowID: no Paid date, no Paid amount, no lock. The workbook then uses it
   for Amount, Remaining, the plan and cash after each payday; clearing it goes back to the budget.
   "Known" comes from tblRegister[Amount known?] (v3); on an older workbook it falls back to
   Variable bill + Statement amount entered. The difference vs budget uses the same % rule as payments.
   ========================================================================= */
const isVarBill = r => r.Source === "Bill" && typeOf(r) === "Variable";
const isKnown = r => ("Amount known?" in r) ? r["Amount known?"] === true : (isVarBill(r) && isVal(r["Statement amount"]) && !isNaN(+r["Statement amount"]));
const knownAmt = r => isKnown(r) ? +r["Statement amount"] : null;
/* Set amount is offered on unpaid Variable bills (not yet paid, not autopaid). */
const canSetAmount = r => !!r.Applies && isVarBill(r) && !r["Paid date"] && !isAutopaid(r) && !isPaid(r) && recordOk(r);
const knownVsBudget = r => varianceCheck(knownAmt(r), r.Budget);
/* Badge for an unpaid Variable bill: "Known" (solid) or "Estimate" (dashed). Paid and other rows: none. */
/* ESTIMATE only for Amount type = Variable AND Amount known? = FALSE AND Autopay bill = FALSE (auto pay rows show AUTO PAY). */
function amountBadge(r) {
  if (!isVarBill(r) || isPaid(r) || isAutoBill(r)) return "";
  return isKnown(r) ? `<span class="tag known" title="The amount on the bill is entered (Set amount). The plan uses it.">Known</span>`
    : `<span class="tag est" title="No bill amount yet — the plan uses the budget. Use Set amount when the statement arrives.">Estimate</span>`;
}
/* Shown under the amount when the known amount is more than variancePct away from the budget. */
function knownDiff(r) {
  if (!isVarBill(r) || isPaid(r) || !isKnown(r)) return "";
  const v = knownVsBudget(r);
  if (v.state !== "over") return "";
  const pct = v.pct === null ? "" : ` (${varPctText(v.pct, +META.variancePct)})`;
  return `<span class="kn-diff"><span>budget ${money(r.Budget)}</span> · <span>${v.diff > 0 ? "+" : "−"}${money(Math.abs(v.diff))}${pct}</span></span>`;
}
/* Button that opens the Set amount form. */
const amountBtn = (r, cls = "btn small ghost") => canSetAmount(r) ? `<button type="button" class="${cls}" data-act="open-amount" data-id="${esc(r.RowID)}">${isKnown(r) ? "Change amount" : "Set amount"}</button>` : "";
function knownMsg(raw, budget) {
  const v = varianceCheck(raw === "" ? null : +raw, budget);
  if (v.state === "blank") return { cls: "blank", text: `Leave blank to use the ${money(+budget || 0)} budget.` };
  if (v.state === "within") return { cls: "within", text: `Within ${pctText(+META.variancePct)} of the ${money(+budget || 0)} budget.` };
  return { cls: "over", text: `${v.pct === null ? "" : varPctText(v.pct, +META.variancePct) + " "}${v.dir} the ${money(+budget || 0)} budget. The plan will use the known amount; you'll pick a reason when you record the payment.` };
}
function amountForm(r) {
  const id = esc(r.RowID), has = isKnown(r), cur = has ? knownAmt(r) : "", m = knownMsg(cur === "" ? "" : String(cur), r.Budget);
  return `<form class="payform amtform" data-form="amount" data-id="${id}">
    <p class="lockbar open" style="margin:0;width:100%"><span><b>Set the amount on the bill.</b> This doesn't record a payment — the plan and cash after each payday use it right away.</span></p>
    <label class="field">Amount on the bill<input type="number" step="0.01" min="0" id="af-amt-${id}" name="known" value="${cur}" placeholder="from the statement"></label>
    <div class="form-actions"><button class="btn primary" type="submit">Save amount</button><button class="btn" type="button" data-act="close-amount">Cancel</button>${has ? `<button class="btn ghost" type="button" data-act="clear-amount" data-id="${id}">Clear (use budget)</button>` : ""}</div>
    <p class="form-msg ${m.cls}" id="af-msg-${id}" aria-live="polite">${esc(m.text)}</p>
  </form>`;
}
document.addEventListener("input", e => {
  const f = e.target.closest('form[data-form="amount"]'); if (!f || e.target.name !== "known") return;
  const row = reg().find(r => r.RowID === f.dataset.id); if (!row) return;
  const m = knownMsg(e.target.value, row.Budget), el = f.querySelector(".form-msg");
  el.className = `form-msg ${m.cls}`; el.textContent = m.text;
});
async function saveAmount(id, raw) {
  const row = reg().find(r => r.RowID === id);
  if (!row || !canSetAmount(row)) { toast("Set amount is only for unpaid Variable bills."); return; }
  if (isVal(raw) && (isNaN(+raw) || +raw < 0)) { const m = document.getElementById(`af-msg-${id}`); if (m) { m.className = "form-msg over"; m.textContent = "Type the amount on the bill, like 158.20 (no minus sign)."; } return; }
  const v = isVal(raw) ? Math.round(+raw * 100) / 100 : null;
  state.amtRow = null;
  await writeRow(row, { "Statement amount": v }, v === null ? `Cleared the known amount for ${esc(row.Bill)} — the plan uses the ${money(row.Budget)} budget again.`
    : `Set ${esc(row.Bill)} to ${money(v)}. The plan uses it now — nothing is marked paid.`);
}
const submitAmount = f => saveAmount(f.dataset.id, new FormData(f).get("known"));
const clearAmount = id => saveAmount(id, null);

/* The action for a bill in a list: nothing on auto pay rows (the bank drafts them), 🔒 Unlock on a saved payment,
   and Mark paid / Record payment only where tblRegister[Record allowed] = TRUE. */
function rowAction(r, unlockLabel = "🔒 Unlock") {
  if (isAutoBill(r)) return isPaid(r) ? "" : `<span class="noact" title="The bank drafts it on the due date. Nothing to record.">Bank drafts it</span>`;
  if (canUnlock(r)) return `<button class="btn small ghost" data-act="unlock-row" data-id="${esc(r.RowID)}" title="Saved and locked">${unlockLabel}</button>`;
  if (!recordOk(r)) return "";
  return quickPayOk(r) ? `<button class="btn small primary" data-act="quick-pay" data-id="${esc(r.RowID)}" aria-label="Mark ${esc(r.Bill)} paid">Mark paid</button>`
    : `<button class="btn small primary" data-act="open-pay" data-id="${esc(r.RowID)}" aria-label="Record ${esc(r.Bill)} payment">Record payment</button>`;
}
/* Mark paid is a one-tap shortcut only when the payday amount is safe to record as-is. */
const quickPayOk = r => !(blocksBelowMin(r) && (+r["Payday amount"] || 0) < minOf(r) - 0.005) && !(isVarBill(r) && !isKnown(r));
function payCheck(r, total) {
  const min = minOf(r), sug = sugOf(r), cents = x => Math.round(x * 100) / 100;
  if (blocksBelowMin(r) && total < min - 0.005)
    return { block: true, html: `<div class="errbox">✕ Can't save ${money(total)}. ${r.Rule === "Loan" ? "The monthly payment" : "The minimum due"} is ${money(min)} — pay at least that so it isn't late.</div>` };
  if (typeOf(r) === "Card" && sug > 0 && total < sug - 0.005)
    return { block: false, html: `<div class="warnbox">⚠ ${money(total)} is ${min > 0 ? `above the ${money(min)} minimum but ` : ""}${money(cents(sug - total))} below the suggested amount. You can save it; the ${money(cents(sug - total))} stays in PNC and the plan re-plans it.</div>` };
  return { block: false, html: "" };
}
function payGuide(r) {
  const d = r.Source === "Debt" ? debtsById[r.ItemID] || {} : null, t = typeOf(r);
  const line = (label, v, why, rec) => `<span class="${rec ? "rec" : ""}">${rec ? `<b>${label}</b>` : label}</span><span class="v ${rec ? "rec" : ""}">${money(v)}</span><button type="button" class="fill" data-act="fill-amt" data-v="${v}">Use</button>${why ? `<span class="why">${why}</span>` : ""}`;
  let rows;
  if (t === "Card") {
    rows = line("Minimum due", minOf(r)) + line("Suggested", sugOf(r), esc(basisOf(r)) + (d["BT payment mode"] ? ` · ${esc(btPlanText(d))}` : ""), true);
    if (isVal(d["Latest balance"])) rows += line(`Full balance (${shortD(d["Latest log date"])})`, +d["Latest balance"]);
  } else if (r.Source === "Debt") rows = line("Monthly payment", sugOf(r), "fixed", true);
  else if (isVarBill(r) && isKnown(r)) rows = line("Known amount (statement)", knownAmt(r), "", true) + line("Budget", +r.Budget || 0, knownVsBudget(r).state === "over" ? esc(varianceMessage(knownVsBudget(r), r.Budget).replace(" Pick a reason.", " — you'll pick a reason.")) : "");
  else rows = line(t === "Variable" ? "Budget estimate" : "Bill amount", sugOf(r) || r.Amount, t === "Variable" && canSetAmount(r) ? "No bill amount yet. Use Set amount when the statement arrives." : "", true);
  return `<div class="guide"><h4>Payment guide</h4><div class="gl">${rows}</div></div>`;
}
function payForm(r) {
  const hasFirst = !!r["Paid date"], auto = isAutopaid(r), t = typeOf(r), min = minOf(r), pd = +r["Payday amount"] || 0;
  // An autopaid bill opens with the automatic amount and date; saving records the real payment, which replaces them.
  // A known amount (Set amount) pre-fills the payment; it can still be changed before saving.
  const amt = hasFirst ? r["Paid amount"] : auto ? (isKnown(r) ? knownAmt(r) : +r["Eff paid amount"] || r.Amount)
    : isKnown(r) ? knownAmt(r) : Math.round((r.Source === "Debt" ? (pd >= min - 0.005 && pd > 0 ? pd : sugOf(r) || min) : (pd || +r.Remaining || r.Amount)) * 100) / 100;
  const total0 = (+amt || 0) + (+r["Extra paid amount"] || 0) * (hasFirst ? 1 : 0);
  const chk = payCheck(r, total0), id = esc(r.RowID);
  const isBill = r.Source === "Bill", v = isBill ? varianceCheck(blankCell(amt) ? null : total0, r.Budget) : null, over = !!v && v.state === "over";
  return `${hasFirst ? `<p class="lockbar editing" style="margin:6px 0"><span><b>Unlocked.</b> Saving replaces the saved payment; it locks again after you save.</span></p>` : ""}
  <div class="payarea">${payGuide(r)}
  <form class="payform" data-form="pay" data-id="${id}">
    ${isVarBill(r) ? `<p class="kn-line" style="margin:0;width:100%">${isKnown(r) ? `Known amount <b class="money">${money(knownAmt(r))}</b>${amountBadge(r)}` : `No known amount yet — using the ${money(r.Budget)} budget estimate.`} ${amountBtn(r, "linkish")}</p>` : ""}
    ${auto && !hasFirst ? `<p class="lockbar open" style="margin:0;width:100%"><span><b>Autopaid</b> on ${shortD(effDate(r))} for ${money(effAmt(r))} (the budget). Enter the real amount if it was different.</span></p>` : ""}
    <label class="field">Date paid<input type="date" id="pf-date-${id}" name="date" value="${hasFirst ? r["Paid date"] : auto ? effDate(r) : META.asOf}" required></label>
    <label class="field">Amount paid<input type="number" step="0.01" min="0" id="pf-amt-${id}" name="amount" value="${amt}" required class="${chk.block ? "bad" : ""}"></label>
    ${isBill ? `<label class="field why-field" ${over ? "" : "hidden"}>Reason if different<select id="pf-reason-${id}" name="reason"><option value="">—</option>${REASONS.map(x => `<option ${over && r["Reason if different"] === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>` : ""}
    <label class="field note ${isBill ? "why-field" : ""}" ${isBill && !over ? "hidden" : ""}>Note<input type="text" id="pf-note-${id}" name="note" value="${esc(!isBill || over ? r.Notes || "" : "")}" placeholder="optional"></label>
    ${hasFirst ? `<label class="field">Extra payment<input type="number" step="0.01" min="0" id="pf-extra-${id}" name="extra" value="${r["Extra paid amount"] || ""}" placeholder="0.00"></label>` : ""}
    <div class="pf-check" id="pf-check-${id}">${chk.html}</div>
    ${isKnown(r) ? `<div class="pf-known" id="pf-known-${id}" ${Math.abs(total0 - knownAmt(r)) < 0.005 ? "hidden" : ""}><p class="warnbox" style="margin:0">⚠ <span class="kn-text">${knownMismatchText(total0, r)}</span></p><label class="kn-upd"><input type="checkbox" name="updknown" id="pf-upd-${id}"> Also change the known amount to <span class="kn-to money">${money(total0)}</span></label></div>` : ""}
    <div class="form-actions"><button class="btn primary" type="submit" ${chk.block ? "disabled" : ""}>Save</button><button class="btn" type="button" data-act="close-row">Cancel</button>${hasFirst ? `<button class="btn ghost" type="button" data-act="clear-row" data-id="${id}">Clear payment</button>` : ""}</div>
    ${isBill ? `<p class="form-msg ${v.state}" id="pf-msg-${id}" aria-live="polite">${esc(varianceMessage(v, r.Budget))}</p>` : ""}
  </form></div>`;
}
/* Live check while typing; the "Use" buttons fill the amount. */
function recheckPay(f) {
  const row = reg().find(r => r.RowID === f.dataset.id); if (!row) return;
  const total = (+f.querySelector('[name="amount"]').value || 0) + (+(f.querySelector('[name="extra"]') || {}).value || 0);
  const chk = payCheck(row, total);
  f.querySelector(".pf-check").innerHTML = chk.html;
  f.querySelector('[name="amount"]').classList.toggle("bad", chk.block);
  f.querySelector('button[type="submit"]').disabled = chk.block;
  f.closest(".payarea").querySelectorAll(".fill").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.v - total) < 0.005));
  varianceUi(f, row);
  knownUi(f, row, total);
  return chk;
}
/* Known amount vs what is being paid: a difference fails the model check, so say so and offer (opt-in) to update it. */
const knownMismatchText = (total, r) => `${money(total)} is different from the known amount (${money(knownAmt(r))}). The model check "Every paid Variable bill matches its known amount" will flag it unless the known amount is changed too.`;
function knownUi(f, row, total) {
  const box = f.querySelector(".pf-known"); if (!box || !isKnown(row)) return;
  const same = Math.abs(total - knownAmt(row)) < 0.005;
  box.hidden = same;
  if (same) { const c = box.querySelector('[name="updknown"]'); if (c) c.checked = false; return; }
  box.querySelector(".kn-text").textContent = knownMismatchText(total, row);
  box.querySelector(".kn-to").textContent = money(total);
}
/* Bills: re-check the % rule every time the amount changes. Over → show Reason + Note (amber);
   within → hide AND clear them so blanks are saved (green); empty box → neutral text. */
function varianceUi(f, row) {
  if (row.Source !== "Bill") return null;
  const raw = f.querySelector('[name="amount"]').value, extra = +(f.querySelector('[name="extra"]') || {}).value || 0;
  const v = varianceCheck(raw === "" ? null : +raw + extra, row.Budget);
  const m = f.querySelector(".form-msg"); m.className = `form-msg ${v.state}`; m.textContent = varianceMessage(v, row.Budget); m.style.fontWeight = "";
  f.querySelectorAll(".why-field").forEach(el => {
    el.hidden = v.state !== "over";
    if (v.state === "within") el.querySelectorAll("select, input").forEach(x => x.value = "");
  });
  return v;
}
document.addEventListener("input", e => { const f = e.target.closest('form[data-form="pay"]'); if (f && (e.target.name === "amount" || e.target.name === "extra")) recheckPay(f); });
document.addEventListener("click", e => {
  const b = e.target.closest('[data-act="fill-amt"]'); if (!b) return;
  const f = b.closest(".payarea").querySelector('form[data-form="pay"]'); if (!f) return;
  f.querySelector('[name="amount"]').value = (+b.dataset.v).toFixed(2); recheckPay(f);
});

async function submitPay(f) {
  const row = reg().find(r => r.RowID === f.dataset.id), fd = new FormData(f);
  if (!row || isAutoBill(row) || !(recordOk(row) || canUnlock(row))) { state.openRow = null; render(); toast("This bill can't be recorded here — the workbook handles it."); return; }
  const amount = +fd.get("amount"), extra = fd.get("extra") ? +fd.get("extra") : null, reason = fd.get("reason") || null;
  const total = amount + (extra || 0);
  if (recheckPay(f).block) return;
  const v = row.Source === "Bill" ? varianceCheck(total, row.Budget) : null, over = !!v && v.state === "over";
  if (over && !reason) { const m = $(`#pf-msg-${CSS.escape(row.RowID)}`); m.className = "form-msg over"; m.textContent = varianceMessage(v, row.Budget); m.style.fontWeight = "600"; const s = f.querySelector('[name="reason"]'); if (s) s.focus(); return; }
  // Bills within the threshold save Reason and Note as blanks.
  const values = { "Paid date": fd.get("date"), "Paid amount": amount, "Notes": (v && !over) ? null : (fd.get("note") || null) };
  if (row.Source === "Bill") values["Reason if different"] = over ? reason : null;
  // Recording a payment never changes the known amount — unless the "Also change the known amount" box is ticked.
  const updKnown = isKnown(row) && fd.get("updknown") && Math.abs(total - knownAmt(row)) >= 0.005;
  if (updKnown) values["Statement amount"] = Math.round(total * 100) / 100;
  if (f.querySelector('[name="extra"]')) { values["Extra paid amount"] = extra; values["Extra paid date"] = extra ? fd.get("date") : null; }
  state.openRow = null;
  await writeRow(row, values, `Saved ${esc(row.Bill)} · ${money(total)} on ${shortD(fd.get("date"))}${updKnown ? " · known amount updated" : ""}`);
}
