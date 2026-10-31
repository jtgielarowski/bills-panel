/* ========================================================================= rendering */
function render() {
  document.body.classList.toggle("detailed", state.detailed);
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === state.view)));
  $("#modeSimple").setAttribute("aria-pressed", String(!state.detailed));
  $("#modeDetailed").setAttribute("aria-pressed", String(state.detailed));
  $("#sampleBanner").hidden = source.kind !== "sample";
  $("#closeFull").hidden = source.kind !== "dialog";
  const v = { month: viewMonth, friday: viewFriday, spending: viewSpending, budget: viewBudget, story: viewStory, debts: viewDebts, details: viewDetails }[state.view];
  $("#app").innerHTML = v();
  if (state.view === "month") drawCashBuild();
  if (state.view === "story") drawStoryTrend();
  if (state.view === "debts") { drawDadLoan(); drawBT(); }
  if (state.view === "budget") drawTrend();
}

function monthBar(extra = "") {
  const fails = +META.checksFailing || 0, warns = +META.checksWarning || 0;
  const n = paydaysIn(state.vm).length;
  return `<section class="monthbar">
    <div class="month-title">
      <span class="eyebrow-top">Bills &amp; Paychecks</span>
      <div class="month-nav">
        <button class="icon-btn" data-act="prev-month" aria-label="Previous month">‹</button>
        <h1>${monthName(state.vm)}</h1>
        <button class="icon-btn" data-act="next-month" aria-label="Next month">›</button>
      </div>
      <div class="today">Today is ${fmtD(META.asOf, { weekday: "long", month: "long", day: "numeric" })} · ${n} payday${n === 1 ? "" : "s"} this month${extra}</div>
    </div>
    <button class="health ${fails ? "bad" : warns ? "warn" : ""}" data-act="go-details"><span class="dot"></span>${fails ? `${fails} model check${fails === 1 ? "" : "s"} need attention` : warns ? `All checks passed · ${warns} warning${warns === 1 ? "" : "s"}` : "Model health: all checks passed"}</button>
  </section>${keyLine()}`;
}

/* ---------------- This month */
function viewMonth() {
  const vm = state.vm, k = { ...kpis(vm), midweek: midweekOf(state.vm) }, cur = META.currentPayday;
  const payRows = reg().filter(r => (+r["Payday amount"] || 0) > 0 || (effDate(r) === META.asOf && isPaid(r)));
  const isCurrentMonth = monthKey(cur) === vm || monthKey(META.asOf) === vm;
  const curPlan = planFor(cur);
  const routine = fridayRoutine();
  const eom = endOfMonth(vm);
  const complete = eom.every(x => x.on);
  return `
  ${monthBar()}
  <section class="today-grid">
    <div class="card payday">
      <div class="payday-head"><h2>Pay this Friday · ${fmtD(cur, { month: "short", day: "numeric" })}</h2><span>${payRows.filter(r => r.Remaining > 0 && !isAutoBill(r)).length} to pay${payRows.some(r => r.Remaining > 0 && isAutoBill(r)) ? ` · ${payRows.filter(r => r.Remaining > 0 && isAutoBill(r)).length} auto pay` : ""}</span></div>
      ${payRows.length ? `<ul class="payday-list">${payRows.map(r => {
        const done = r.Remaining <= 0, st = status(r);
        return `<li class="${done ? "done" : ""}">
          <div><div class="pl-name">${esc(r.Bill)}</div><div class="pl-note"><span class="pill st ${st.c}">${esc(st.t)}</span>${autoTag(r)}${amountBadge(r)}<span>due ${shortD(r["Due date"])}</span>${r["Extra wanted"] > 0 ? `<span>full balance</span>` : ""}</div></div>
          <div class="pl-amt">${money(done ? r["Paid total"] : r["Payday amount"])}</div>
          <div>${rowAction(r)}</div>
        </li>`; }).join("")}</ul>` : `<p class="empty">Nothing left to pay from this payday.</p>`}
      <div class="payday-foot">
        <span>Total: <strong class="money">${money(sum(payRows.filter(r => r.Remaining > 0), r => r["Payday amount"]))}</strong></span>
        <span>After paying, PNC should have about <strong class="money">${money(curPlan ? curPlan["Cash after"] : null)}</strong> until ${fmtD(META.nextPayday)}.</span>
      </div>
      ${cashMath(curPlan)}
    </div>
    <div class="stack">
      <div class="card card-pad">
        <div class="card-head"><h2>Friday routine</h2><span class="hint">${fmtD(cur)}</span></div>
        <ul class="checklist">${routine.map(x => `<li>${statusMark(x)}<div><div class="ck-label">${x.label}</div><div class="ck-note">${x.note}</div></div></li>`).join("")}</ul>
      </div>
      <div class="card card-pad">
        <div class="card-head"><h2>End of month</h2>${!eom[2].on ? `<button class="btn small" data-act="close-month">Mark ${monthName(vm, { month: "long" })} closed</button>` : ""}</div>
        ${complete ? `<p class="complete">✓ ${monthName(vm, { month: "long" })} is complete — nice work!</p>` : ""}
        <ul class="checklist">${eom.map(x => `<li>${statusMark(x)}<div><div class="ck-label">${x.label}</div><div class="ck-note">${x.note}</div></div></li>`).join("")}</ul>
      </div>
    </div>
  </section>

  <section class="kpis" aria-label="Key numbers">
    ${kpi("Coming in", money(k.comingIn), `Received so far: ${money(k.received)}`, "Every paycheck deposited this month.")}
    ${k.forecast ? kpi("Going out", money(k.goingOut), "Forecast · from the Monthly Story", "This month's bills paid with this month's cash, plus one-off expenses. Past the paycheck plan, so it comes from the Monthly Story.")
      : kpi("Going out", money(k.goingOut), `Paid so far: ${money(k.paidSoFar)}`, "Everything this month's paychecks pay, including early bills for next month.")}
    ${k.forecast ? kpi("Left at month end", money(k.left), "Forecast · this month's pay minus its bills", "Past the paycheck plan: this month's paychecks minus its bills (Monthly Story). Not a PNC balance.", k.left < 0 ? "v-bad" : "v-good")
      : kpi("Left at month end", money(k.left), "If everything goes to plan", "What should still be in PNC after the last payday's bills.", "v-good")}
    ${kpi("Bills paid", `${k.paidN} of ${k.total}`, "Includes last month's leftovers", "Green rows in the bill list.")}
    ${kpi("Needs attention", `${k.late} urgent`, `${k.soon} more due soon`, "Red badges (urgent) and orange badges (due soon) below. Yellow, blue and green never count.", k.late ? "v-bad" : "")}
    ${kpi("Lowest balance ahead", money(k.low ? k.low["Cash after"] : null), k.low ? `${fmtD(k.low.Payday)} · cushion ${money(META.cushion, 0)} ${k.low["Cash after"] >= META.cushion ? "✓" : "— short"}` : "", "The tightest point between now and the end of next month.", k.low && k.low["Cash after"] < META.cushion ? "v-bad" : "v-good")}
    ${kpi("Mid-week spend", money(k.midweek), midweekSub(k.midweek), "PNC money spent between Fridays that isn't a recorded bill (from the Friday PNC entries). Not part of the bill totals.")}
  </section>

  <section class="card card-pad">
    <div class="card-head"><h2>Paycheck plan</h2><span class="hint">Each payday pays the bills planned for it. Cash carries forward. Never plans below the ${money(META.cushion, 0)} cushion.</span></div>
    <div class="plan-grid">${paydaysIn(vm).map(slot).join("") || `<p class="empty">No paydays this month.</p>`}</div>
  </section>

  <section class="card card-pad">
    <div class="card-head"><h2>Cash build this month</h2><span class="hint">Money in by person vs. money out, by day</span></div>
    <div class="legend">${PEOPLE.map(n => `<span><i class="sw" style="background:${personColor(n)}"></i>${esc(n)}'s pay</span>`).join("")}<span><i class="sw-dash"></i>Planned out</span><span><i class="sw-line"></i>Actually paid</span></div>
    <div class="chart-wrap" id="cashBuild"></div>
  </section>

  ${billTable(vm)}

  <section class="twocol">
    ${earlyBox(vm)}
    ${carriedBox(vm)}
  </section>`;
}
/* Mid-week spend for the month (tblExportHistory) — shown on its own, never added to bill totals. */
const midweekOf = vm => { const h = DB.tblExportHistory.find(x => x.Month === vm); return h && isVal(h["Mid-week spend"]) ? +h["Mid-week spend"] : null; };
const midweekSub = v => v === null ? "Needs two Friday PNC entries" : v > 0.005 ? "spent more than recorded" : v < -0.005 ? "more cash than expected" : "matches what was recorded";
const kpi = (label, value, sub, cap, cls = "") => `<div class="card kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div><div class="kpi-sub">${sub}</div><div class="kpi-cap">${cap}</div></div>`;

function slot(p) {
  const pl = planFor(p.date), who = whoOf(p);
  const next = paydays.find(x => x.date > p.date);
  const actual = paidInRange(p.date, next ? new Date(D(next.date) - 864e5).toISOString().slice(0, 10) : isoOf(monthKey(p.date), daysInMonth(monthKey(p.date))));
  const out = pl ? planOut(pl) : null, after = pl ? pl["Cash after"] : null;
  const received = p.date <= META.asOf;
  // When the PNC entry already includes this paycheck, the engine shows Money in = 0. Back the paycheck out so the column adds up.
  const inBal = pl && received && !(+pl["Money in"]);
  const start = pl ? after - (+pl["Money in"] || 0) + (+pl["Total out"] || 0) - (inBal ? p.amount : 0) : null;
  const st = !pl ? (p.date < META.currentPayday ? ["muted", "Done — see Actual"] : ["muted", "Beyond the look-ahead"])
    : after < META.cushion ? ["short", `Short by ${money(META.cushion - after, 0)}`] : ["", `OK · ${money(after - META.cushion, 0)} above cushion`];
  const nBills = pl ? reg().filter(r => r["Planned date"] === p.date && r.Remaining > 0).length : null;
  return `<div class="slot">
    <div class="slot-head ${who}"><b>${fmtD(p.date)}</b><span class="who ${who}">${esc(peopleLabel(p.people))}</span></div>
    <table><thead><tr><th></th><th>Plan</th><th>Actual</th></tr></thead><tbody>
      <tr><td>Starting cash</td><td>${pl ? money(start) : "—"}</td><td>—</td></tr>
      <tr><td>+ Paycheck</td><td>${money(p.amount)}</td><td>${received ? money(p.amount) : "—"}</td></tr>
      <tr><td>− Bills${nBills !== null ? ` (${nBills})` : ""}</td><td>${pl ? money(out) : "—"}</td><td>${money(actual)}</td></tr>
      <tr class="total"><td>Cash after</td><td>${pl ? money(after) : "—"}</td><td>—</td></tr>
    </tbody></table>
    ${inBal ? `<div class="b-detail" style="padding:0 2px 6px">Your PNC entry of ${money(start + p.amount)} already includes this paycheck.</div>` : ""}
    <div class="slot-status ${st[0]}">${st[1]}</div>
  </div>`;
}

function billTable(vm) {
  const rows = viewRows(vm).sort((a, b) => GROUP_ORDER.indexOf(groupOf(a, vm)) - GROUP_ORDER.indexOf(groupOf(b, vm)) || (a["Due date"] < b["Due date"] ? -1 : 1));
  const prevM = monthName(addMonths(vm, -1), { month: "short" }), thisM = monthName(vm, { month: "short" });
  let html = "", g = null;
  for (const r of rows) {
    const grp = groupOf(r, vm);
    if (grp !== g) { g = grp; html += `<tr class="group ${grp === "Last month's bills" ? "last" : ""}"><td colspan="12">${esc(grp)}${grp === "Last month's bills" ? `<small>${prevM} bills paid with ${thisM} cash</small>` : ""}</td></tr>`; }
    const st = status(r), cm = r["Cash month"], nb = needsBalance(r);
    const flag = r.Source === "Debt" && (debtsById[r.ItemID] || {}).Flag === "Unexpected balance";
    const open = state.openRow === r.RowID, amtOpen = state.amtRow === r.RowID;
    html += `<tr>
      <td><span class="pill st ${st.c}">${esc(st.t)}</span>${flag && !hasTone(r) ? `<span class="flag" title="This card is set to $0 Balance but shows a balance">!</span>` : ""}</td>
      <td><div class="b-name">${esc(r.Bill)} ${typeTag(r)}${autoTag(r)}</div><div class="b-detail">${esc(r.Detail || "")}</div><span class="mono-s detail-only">${esc(r.RowID)}</span></td>
      <td>${shortD(r["Due date"])}${r.Rule === "End of service month" ? `<div class="b-detail">pay by ${shortD(r["Pay by"])}</div>` : ""}</td>
      <td class="amt">${nb ? "—" : money(minOf(r))}</td>
      <td class="amt sug">${nb ? "—" : isPaid(r) ? money(r["Paid total"]) : money(sugOf(r))}<span class="sub">${nb ? "enter balance" : isPaid(r) ? (r["Paid date"] ? "paid" : "auto-paid") : isAutoBill(r) ? "auto pay" : isVarBill(r) ? amountBadge(r) : esc(basisOf(r))}</span>${knownDiff(r)}</td>
      <td>${esc(r["Pay from"] || "")}</td>
      <td class="b-why detail-only">${esc(r.Why || "")}</td>
      <td class="detail-only mono-s">${esc(r.Rule || "")}<br>must ${money(r["Remaining must"])} · extra ${money(r["Extra planned"])}${+r["Extra unfunded"] > 0 ? ` · unfunded ${money(r["Extra unfunded"])}` : ""}</td>
      <td>${cm ? `<span class="auto-chip" title="Fills in automatically from the paid or planned date">${monthName(cm, { month: "short" })} cash</span>` : `<span class="hint">—</span>`}</td>
      <td class="paidcell">${r["Paid date"] ? `${shortD(r["Paid date"])}<span class="money">${money(r["Paid amount"])}</span>${r["Extra paid amount"] ? `<span class="money">+ ${money(r["Extra paid amount"])}</span>` : ""}` : isAutopaid(r) ? `${shortD(effDate(r))}<span class="money">${money(effAmt(r))}</span><div class="b-detail">autopay</div>` : "—"}${varText(r) ? `<div class="b-detail">${esc(varText(r))}</div>` : ""}${r["Needs reason"] === true ? `<div class="b-detail" style="color:var(--late-bg)">Pick a reason</div>` : r["Reason if different"] ? `<div class="b-detail">${esc(r["Reason if different"])}</div>` : ""}</td>
      <td class="r"><div class="row-acts">${nb ? `<button class="btn small" data-act="go-friday">Enter balance</button>` : billActs(r, open)}</div></td>
    </tr>`;
    if (amtOpen && canSetAmount(r)) html += `<tr class="formrow"><td colspan="12">${amountForm(r)}</td></tr>`;
    else if (open && (recordOk(r) || canUnlock(r))) html += `<tr class="formrow"><td colspan="12">${payForm(r)}</td></tr>`;
  }
  return `<section class="card card-pad">
    <div class="card-head"><h2>Bills for ${monthName(vm)}</h2><span class="hint">${rows.length} bills · Suggested = what the plan says to pay · Minimum = the least you can pay. Cards appear only when they have a balance.</span></div>
    ${statusKey()}<div style="height:10px"></div>
    <div class="table-wrap"><table class="bills">
      <thead><tr><th>Status</th><th>Bill</th><th>Due</th><th class="r">Minimum</th><th class="r">Suggested</th><th>Pay from</th><th class="detail-only">Why this payday</th><th class="detail-only">Planner</th><th>Cash month</th><th>Paid</th><th class="r"><span class="sr">Action</span></th></tr></thead>
      <tbody>${html || `<tr><td colspan="12" class="empty">No bills this month.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

/* Bill table actions: auto pay rows get none (never written); a saved payment can be unlocked; Set amount and
   Record payment only where tblRegister[Record allowed] = TRUE. */
function billActs(r, open) {
  if (isAutoBill(r)) return isPaid(r) ? "" : `<span class="noact" title="The bank drafts it on the due date. Nothing to record.">Bank drafts it</span>`;
  if (canUnlock(r)) return `<button class="btn small ghost" data-act="open-row" data-id="${esc(r.RowID)}" aria-expanded="${open}">${open ? "Close" : "🔒 Unlock to edit"}</button>`;
  if (!recordOk(r)) return "";
  return `${amountBtn(r)}<button class="btn small" data-act="open-row" data-id="${esc(r.RowID)}" aria-expanded="${open}">Record payment</button>`;
}

function earlyBox(vm) {
  const nxt = addMonths(vm, 1);
  const rows = reg().filter(r => r.Month === nxt && r["Cash month"] === vm && r.Applies);
  return `<div class="card card-pad early"><div class="card-head"><h2>${monthName(nxt, { month: "long" })} bills paid early with ${monthName(vm, { month: "long" })} cash</h2></div>
  ${rows.length ? `<ul>${rows.map(r => `<li>${esc(r.Bill)}${autoTag(r)} <span class="money">${money(r.Amount)}</span> · due ${shortD(r["Due date"])} · <span class="pill st ${status(r).c}">${esc(status(r).t)}</span></li>`).join("")}</ul>
  <p class="note" style="color:inherit">Total ${money(sum(rows, r => r.Amount))}. The first ${monthName(nxt, { month: "long" })} payday comes too late for these.</p>` : `<p class="note" style="color:inherit">None this month.</p>`}</div>`;
}
/* "Carried over from last month": earlier months' bills paid with this month's cash (tblRegister story columns),
   footer from tblExportStory [Carried in], [Carried in unpaid], [Carried in count]. */
function carriedBox(vm) {
  const rows = reg().filter(r => r["Story cash month"] === vm && r.Month < vm && (+r.Expected || 0) > 0)
    .sort((a, b) => (a["Due date"] < b["Due date"] ? -1 : 1));
  const st = storyRow(vm), n = st ? +st["Carried in count"] || 0 : rows.length;
  return `<div class="card card-pad carried"><div class="card-head"><h2>Carried over from last month</h2><span class="hint">Earlier months' bills paid with ${monthName(vm, { month: "long" })} cash</span></div>
  ${rows.length ? `<div class="table-wrap"><table class="data compact"><thead><tr><th>Bill</th><th>Bill's month</th><th>Due</th><th class="r">Amount</th><th>Pay from</th></tr></thead><tbody>
    ${rows.map(r => { const s2 = status(r); return `<tr><td>${esc(r.Bill)}${autoTag(r)}</td><td>${monthName(r.Month, { month: "short", year: "numeric" })}</td><td>${shortD(r["Due date"])}</td><td class="r money">${money(r.Expected)}</td>
      <td><span class="pill st ${s2.c}">${esc(s2.t)}</span><div class="hint">${esc(r["Pay from"] || "")}</div></td></tr>`; }).join("")}
  </tbody></table></div>` : `<p class="note" style="margin:0">Nothing carried over into ${monthName(vm, { month: "long" })}.</p>`}
  ${st ? `<p class="carried-foot">Total <b class="money">${money(st["Carried in"])}</b> · <b class="money">${money(st["Carried in unpaid"])}</b> still unpaid · ${n} bill${n === 1 ? "" : "s"}</p>` : ""}</div>`;
}

/* Under the Pay this Friday total: how "PNC until next payday" is worked out (Engine C7–C12 → tblExportMeta
   startCash / anchor, tblCashLog, tblExportPlan). Every number is the workbook's; the lines tie out. */
function cashMath(curPlan) {
  const bank = META.hasBankEntry === true ? DB.tblCashLog.filter(c => c.Date === META.anchor && isVal(c["PNC balance"])).at(-1) : null;
  const start = +META.startCash || 0, entered = bank ? +bank["PNC balance"] : null;
  const moneyIn = curPlan ? +curPlan["Money in"] || 0 : 0, still = curPlan ? +curPlan["Total out"] || 0 : 0;
  const after = curPlan ? +curPlan["Cash after"] : null;
  if (after === null) return "";
  const between = round2(after - (start + moneyIn - still));      // only when the PNC entry is older than this Friday
  const line = (sign, label, v, cls = "") => `<li class="${cls}"><span class="cm-sign">${sign}</span><span class="cm-label">${label}</span><span class="money">${money(v)}</span></li>`;
  return `<div class="cashmath" aria-label="How the expected PNC balance is worked out"><div class="cm-title">How we get there</div><ol>
    ${entered !== null ? line("", `PNC balance you entered · ${fmtD(META.anchor)}`, entered) + line("−", "Payments already marked paid since then", entered - start) : line("", "Opening cash (no PNC entry yet)", start)}
    ${line("=", "Start cash", start, "sub")}
    ${moneyIn ? line("+", "Paychecks not in that balance yet", moneyIn) : ""}
    ${Math.abs(between) >= 0.005 ? line(between > 0 ? "+" : "−", "Earlier paydays since your entry (net)", Math.abs(between)) : ""}
    ${line("−", "Still to pay from this payday", still)}
    ${line("=", `Expected in PNC until ${fmtD(META.nextPayday)}`, after, "total")}
  </ol></div>`;
}

/* ---------------- cash-build chart */
function drawCashBuild() {
  const el = $("#cashBuild"); if (!el) return;
  const vm = state.vm, n = daysInMonth(vm);
  const pcs = DB.tblPaychecks.filter(p => p.Month === vm && p["Deposit date"] >= META.modelStart);
  const days = [];
  let j = 0, w = 0;
  for (let d = 1; d <= n; d++) {
    const iso = isoOf(vm, d);
    j = sum(pcs.filter(p => p.Person === PEOPLE[0] && p["Deposit date"] <= iso), p => p["Amount used"]);
    w = sum(pcs.filter(p => p.Person !== PEOPLE[0] && p["Deposit date"] <= iso), p => p["Amount used"]);
    const paid = paidInRange(vm, iso);
    const planned = paid + sum(plan.filter(p => p.Payday >= vm && p.Payday <= iso), planOut);
    days.push({ iso, d, j, w, planned, paid: iso <= META.asOf ? paid : null });
  }
  const W = 860, H = 280, L = 56, R = 16, T = 12, B = 30;
  const max = Math.max(1, ...days.map(x => Math.max(x.j + x.w, x.planned)));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const x = d => L + (d - 1) * (W - L - R) / (n - 1), y = v => T + (H - T - B) * (1 - v / top);
  const area = (lo, hi) => { let s = `M${x(1)},${y(lo(days[0]))}`; days.forEach(p => s += `L${x(p.d)},${y(hi(p))}`); for (let i = days.length - 1; i >= 0; i--) s += `L${x(days[i].d)},${y(lo(days[i]))}`; return s + "Z"; };
  const line = (f, arr) => arr.filter(p => f(p) !== null).map((p, i) => `${i ? "L" : "M"}${x(p.d)},${y(f(p))}`).join("");
  let grid = "";
  for (let v = 0; v <= top + 1; v += step) grid += `<line class="${v ? "grid" : "base"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v, 0).replace(",000", "k").replace("$0", "$0")}</text>`;
  let xt = ""; [1, 8, 15, 22, n].forEach(d => xt += `<text class="axis" x="${x(d)}" y="${H - 8}" text-anchor="middle">${d === 1 ? monthName(vm, { month: "short" }) + " 1" : d}</text>`);
  const today = META.asOf.slice(0, 7) + "-01" === vm ? +META.asOf.slice(8) : null;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative money in by person compared with planned and actual payments this month">
    ${grid}${xt}
    <path d="${area(() => 0, p => p.j)}" fill="var(--series-1)" opacity=".9"/>
    <path d="${area(p => p.j, p => p.j + p.w)}" fill="var(--series-2)" opacity=".9"/>
    <path d="${line(p => p.planned, days)}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="${line(p => p.paid, days)}" fill="none" stroke="var(--ink)" stroke-width="2.5"/>
    ${today ? `<line x1="${x(today)}" x2="${x(today)}" y1="${T}" y2="${H - B}" stroke="var(--late-bg)" stroke-dasharray="3 3"/><text class="axis" x="${x(today) + 6}" y="${T + 10}" style="fill:var(--ink-2);font-weight:600">Today</text>` : ""}
    <line id="cbX" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="cbHit"/>
  </svg><div class="tip" id="cbTip" hidden></div>`;
  const svg = el.querySelector("svg"), tip = $("#cbTip"), hit = $("#cbHit"), cx = $("#cbX");
  hit.addEventListener("mousemove", e => {
    const bb = svg.getBoundingClientRect(), px = (e.clientX - bb.left) * W / bb.width;
    const d = Math.max(1, Math.min(n, Math.round((px - L) / ((W - L - R) / (n - 1))) + 1)), p = days[d - 1];
    cx.setAttribute("x1", x(d)); cx.setAttribute("x2", x(d)); cx.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>${fmtD(p.iso)}</b><div><span>${esc(PEOPLE[0] || "")}'s pay</span><span class="v">${money(p.j, 0)}</span></div>${PEOPLE[1] ? `<div><span>${esc(PEOPLE[1])}'s pay</span><span class="v">${money(p.w, 0)}</span></div>` : ""}<div><span>Planned out</span><span class="v">${money(p.planned, 0)}</span></div><div><span>Actually paid</span><span class="v">${p.paid === null ? "—" : money(p.paid, 0)}</span></div>`;
    const left = (x(d) / W) * bb.width; tip.style.left = Math.min(bb.width - 190, left + 12) + "px"; tip.style.top = "10px";
  });
  hit.addEventListener("mouseleave", () => { tip.hidden = true; cx.setAttribute("visibility", "hidden"); });
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }

/* ---------------- Friday update */
function viewFriday() {
  const vm = state.vm, picker = fridayPicker(vm), i = fridayInfo(state.fri.date);
  const lastBank = DB.tblCashLog.filter(c => c.Date && isVal(c["PNC balance"])).sort((a, b) => a.Date < b.Date ? 1 : -1)[0];
  const futurePay = i.date && i.state === "future" ? paycheckForm(i.date) : "";
  let rows = "", g = null;
  for (const d of i.cards) {
    const cat = d["Expected category"], sv = i.saved[d.Name], prev = DB.tblCardLog.filter(l => l["Card or loan"] === d.Name && isVal(l.Balance) && l.Date < i.date).at(-1);
    if (cat !== g) { g = cat; rows += `<tr class="group"><td colspan="7">${{ "Active": "Cards in use", "Balance Transfer": "Balance transfer", "$0 Balance": "Cards at $0 — type 0 to confirm" }[cat]}</td></tr>`; }
    rows += `<tr>
        <td><b>${esc(d.Name)}</b>${cat === "Balance Transfer" ? `<div class="hint">${esc(btPlanText(d))}</div>` : ""}</td>
        <td><span class="pill ${cat === "Active" ? "info" : "muted"}">${esc(cat)}</span></td>
        <td class="r money">${prev ? money(prev.Balance) : "—"}<div class="hint">${prev ? shortD(prev.Date) : ""}</div></td>
        <td>${fridayField(i, `bal-${d.DebtID}`, `${d.Name} balance`, sv ? sv.Balance : null, "0 if $0")}</td>
        <td>${fridayField(i, `min-${d.DebtID}`, `${d.Name} minimum payment`, sv ? sv.Minimum : null, isVal(d["Latest minimum"]) ? `keep ${d["Latest minimum"]}` : "")}</td>
        <td>${d["Due day"] ? `${d["Due day"]}th` : "—"}</td>
        <td class="hint">${esc(d.Flag || "")}</td></tr>`;
  }
  return `${monthBar()}
  <section class="card card-pad">
    <div class="card-head"><h2>Friday update</h2><span class="hint">Pick a pay period. Every Friday morning, before paying bills — every card, every Friday.</span></div>
    ${picker}
    ${i.date ? fridayBanner(i) : ""}
    ${futurePay ? `<div style="margin-top:12px">${futurePay}</div>` : ""}
  </section>
  ${state.detailed ? DB.tblDebts.filter(d => d.Name && d["Expected category"] === "Balance Transfer").map(d => `<section class="card card-pad"><div class="card-head"><h2>${esc(d.Name)} · payment plan</h2><span class="hint">Detailed view only · balance to plan ${money(d["Balance to plan"])} · ${d["Months left"]} payments to ${esc(promoLabel(d))}</span></div>${btForm(d)}</section>`).join("") : ""}
  ${i.state !== "future" ? `<form class="card card-pad" data-form="friday">
    <div class="statgrid" style="margin:0 0 16px">
      <div class="field">${esc(PNC_LABEL)}${fridayField(i, "bank", "PNC available balance", i.bank ? i.bank["PNC balance"] : null)}${midweekCard(i.bank)}</div>
      <div class="stat"><div class="l">Model expected today</div><div class="v">${money(META.expectedBankToday)}</div></div>
      <div class="stat"><div class="l">Latest PNC entry</div><div class="v">${lastBank ? money(lastBank["PNC balance"]) : "—"}</div><div class="hint">${lastBank ? fmtD(lastBank.Date) : "none yet"}</div></div>
    </div>
    ${i.date && paychecksOn(i.date).length ? `<div class="pc-card"><div class="pc-head"><b>Paychecks on ${fmtD(i.date)}</b><span class="hint">Only if a paycheck was different — blank = expected.</span></div>${paycheckRows(i.date, i.editable)}</div>` : ""}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Card</th><th>Set as</th><th class="r">Before this Friday</th><th>Balance ${i.date ? shortD(i.date) : ""}</th><th>Minimum</th><th>Due</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${i.editable ? `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="submit">Save Friday update</button><span class="hint">Saves every card you filled in, the PNC balance and any paycheck change, then locks them.</span></div>` : ""}
  </form>` : ""}
  <section class="card card-pad"><div class="card-head"><h2>Recent entries</h2></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Card</th><th class="r">Balance</th><th class="r">Minimum</th><th class="r">Spending since last week</th></tr></thead>
    <tbody>${DB.tblCardLog.filter(l => isVal(l.Balance)).slice().reverse().slice(0, 30).map(l => `<tr><td>${shortD(l.Date)}</td><td>${esc(l["Card or loan"])}</td><td class="r money">${money(l.Balance)}</td><td class="r money">${money(l.Minimum)}</td><td class="r money">${isVal(l.Spending) ? money(l.Spending) : "—"}</td></tr>`).join("")}</tbody></table></div>
  </section>`;
}

/* ---------------- Spending */
function viewSpending() {
  const vm = state.vm;
  const logs = DB.tblCardLog.filter(l => l.Spending !== null && l.Spending !== "" && l.Spending !== undefined);
  const inM = logs.filter(l => monthKey(l.Date) === vm);
  const byCard = {};
  inM.forEach(l => byCard[l["Card or loan"]] = (byCard[l["Card or loan"]] || 0) + l.Spending);
  const rows = Object.entries(byCard).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(r => Math.abs(r[1])));
  const weeks = [...new Set(logs.map(l => l.Date))].sort();
  return `${monthBar()}
  <section class="card card-pad">
    <div class="card-head"><h2>Card spending in ${monthName(vm, { month: "long" })}</h2><span class="hint">New charges = this Friday's balance − last Friday's + payments made in between</span></div>
    ${rows.length ? `<div class="hbars">${rows.map(([c, v]) => `<div style="display:grid;grid-template-columns:minmax(120px,240px) minmax(0,1fr) 90px;gap:12px;align-items:center;margin:6px 0">
      <span>${esc(c)}</span><span style="height:14px;border-radius:0 4px 4px 0;background:var(--series-1);width:${Math.max(2, Math.abs(v) / max * 100)}%"></span><span class="money" style="text-align:right">${money(v)}</span></div>`).join("")}
      <p class="note">Total new card spending: <b class="money">${money(sum(rows, r => r[1]))}</b></p></div>`
      : `<p class="empty">Spending shows up after two Friday updates for the same card. Enter balances every Friday and this fills in.</p>`}
  </section>
  <section class="card card-pad"><div class="card-head"><h2>Week by week</h2></div>
    ${weeks.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Card</th>${weeks.map(w => `<th class="r">${shortD(w)}</th>`).join("")}</tr></thead><tbody>
      ${[...new Set(logs.map(l => l["Card or loan"]))].map(c => `<tr><td>${esc(c)}</td>${weeks.map(w => { const l = logs.find(x => x.Date === w && x["Card or loan"] === c); return `<td class="r money">${l ? money(l.Spending) : "—"}</td>`; }).join("")}</tr>`).join("")}
      <tr><td><b>Total</b></td>${weeks.map(w => `<td class="r money"><b>${money(sum(logs.filter(l => l.Date === w), l => l.Spending))}</b></td>`).join("")}</tr>
    </tbody></table></div>` : `<p class="empty">No weekly spending yet.</p>`}
  </section>`;
}

/* ---------------- Budget vs actual */
function viewBudget() {
  const vm = state.vm;
  const cats = DB.tblExportCategory.filter(c => c.Month === vm && (c.Budget || c.Paid));
  const maxv = Math.max(1, ...cats.map(c => Math.max(c.Budget, c.Paid)));
  const sel = state.cat;
  const drill = sel ? viewRows(vm).filter(r => r.Category === sel || (sel === "Last month's bills" && r.Month < vm)) : [];
  return `${monthBar()}
  <section class="card card-pad">
    <div class="card-head"><h2>Budget vs actual · ${monthName(vm)}</h2><span class="hint">Click a group to see its bills</span></div>
    <div class="legend"><span><i class="sw" style="background:var(--neutral-mark)"></i>Budget</span><span><i class="sw" style="background:var(--series-1)"></i>Paid so far</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Group</th><th style="width:40%"></th><th class="r">Budget</th><th class="r">Paid</th><th class="r">Budget of paid bills</th><th class="r">Difference</th></tr></thead><tbody>
    ${cats.map(c => `<tr class="click ${sel === c.Category ? "sel" : ""}" data-act="drill" data-cat="${esc(c.Category)}" tabindex="0">
      <td><b>${esc(c.Category)}</b></td>
      <td><div style="display:grid;gap:3px"><span style="height:8px;border-radius:0 4px 4px 0;background:var(--neutral-mark);width:${c.Budget / maxv * 100}%"></span><span style="height:8px;border-radius:0 4px 4px 0;background:var(--series-1);width:${Math.max(c.Paid ? 1 : 0, c.Paid / maxv * 100)}%"></span></div></td>
      <td class="r money">${money(c.Budget)}</td><td class="r money">${money(c.Paid)}</td><td class="r money">${money(c["Budget of paid bills"])}</td>
      <td class="r money">${c["Variance on paid bills"] ? (c["Variance on paid bills"] > 0 ? "+" : "") + money(c["Variance on paid bills"]) : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    ${sel ? `<h3 style="margin:18px 0 8px;font-size:15px">${esc(sel)} · bills</h3><div class="table-wrap"><table class="data"><thead><tr><th>Bill</th><th>Status</th><th class="r">Budget</th><th class="r">Paid</th><th class="r">Difference</th><th>Reason</th></tr></thead><tbody>
      ${drill.map(r => { const st = status(r); return `<tr><td>${esc(r.Bill)}<div class="hint">${esc(r.Detail || "")}</div></td><td><span class="pill st ${st.c}">${esc(st.t)}</span></td><td class="r money">${money(r.Budget)}</td><td class="r money">${r["Paid total"] ? money(r["Paid total"]) : "—"}</td><td class="r money">${r.Variance === null || r.Variance === undefined ? "—" : (r.Variance > 0 ? "+" : "") + money(r.Variance)}</td><td>${esc(r["Reason if different"] || (r["Needs reason"] === true ? "Needs a reason" : ""))}</td></tr>`; }).join("")}
    </tbody></table></div>` : ""}
  </section>
  <section class="card card-pad">
    <div class="card-head"><h2>Month by month</h2><span class="hint">Bills budget vs. paid for each bill's month</span></div>
    <div class="legend"><span><i class="sw" style="background:var(--neutral-mark)"></i>Bills budget</span><span><i class="sw" style="background:var(--series-1)"></i>Bills paid</span></div>
    <div class="chart-wrap" id="trend"></div>
    <div class="table-wrap"><table class="data" style="margin-top:12px"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Paid out (cash)</th><th class="r">Bills budget</th><th class="r">Bills paid</th><th class="r">Difference on paid bills</th><th class="r">Card spending</th><th class="r" title="PNC money spent between Fridays that isn't a recorded bill — shown on its own, not part of the bill totals">Mid-week spend</th><th>Closed</th></tr></thead><tbody>
      ${trendMonths().map(h => `<tr><td>${esc(h.Label)}</td><td class="r money">${money(h["Income planned"])}</td><td class="r money">${money(h["Paid out (cash)"])}</td><td class="r money">${money(h["Bills budget"])}</td><td class="r money">${money(h["Bills paid"])}</td><td class="r money">${h["Variance on paid bills"] ? money(h["Variance on paid bills"]) : "—"}</td><td class="r money">${money(h["Card spending"])}</td><td class="r money">${isVal(h["Mid-week spend"]) ? money(h["Mid-week spend"]) : "—"}</td><td>${esc(h.Closed)}</td></tr>`).join("")}
    </tbody></table></div>
  </section>`;
}
const trendMonths = () => DB.tblExportHistory.filter(h => h.Month <= addMonths(monthKey(META.asOf), 2));
function drawTrend() {
  const el = $("#trend"); if (!el) return;
  const hs = trendMonths(), W = 860, H = 240, L = 60, R = 10, T = 10, B = 28;
  const max = Math.max(1, ...hs.map(h => Math.max(h["Bills budget"], h["Bills paid"])));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step, y = v => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - R) / hs.length, bw = Math.min(34, gw / 3);
  let g = ""; for (let v = 0; v <= top + 1; v += step) g += `<line class="${v ? "grid" : "base"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v, 0)}</text>`;
  const bars = hs.map((h, i) => { const cx = L + gw * i + gw / 2; return `
    <path d="${rbar(cx - bw - 1, y(h["Bills budget"]), bw, y(0) - y(h["Bills budget"]))}" fill="var(--neutral-mark)"><title>${h.Label} budget ${money(h["Bills budget"])}</title></path>
    <path d="${rbar(cx + 1, y(h["Bills paid"]), bw, y(0) - y(h["Bills paid"]))}" fill="var(--series-1)"><title>${h.Label} paid ${money(h["Bills paid"])}</title></path>
    <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${h.Label.replace(" 20", " '")}</text>`; }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bills budget versus paid by month">${g}${bars}</svg>`;
}
function rbar(x, y, w, h) { if (h <= 0) return ""; const r = Math.min(4, h, w / 2); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }

/* ---------------- Monthly Story (v4) — mirrors the Excel "Monthly Story" sheet.
   Data: tblExportStory (one row per month), tblExportCategory [Locked plan, Expected, Story variance] and the
   tblRegister story columns [Locked plan, Expected, Story variance, Variance reason, Timing, Story cash month,
   Frequency, Non-recurring]. The workbook does every sum; this view only lays the numbers out and draws them.
   Plan = frozen on the 1st (Plan Lock). Actual / expected = paid so far + what the model still expects. */
state.storyOpen = state.storyOpen || { variances: true };
const sgn = (v, d = 0) => { v = +v || 0; return (v > 0.005 ? "+" : v < -0.005 ? "−" : "") + money(Math.abs(v), d); };
const tone = v => (+v > 0.005 ? "neg" : +v < -0.005 ? "pos" : "");          // bills: more out = red, less out = green
const toneUp = v => (+v > 0.005 ? "pos" : +v < -0.005 ? "neg" : "");        // money: more left = green
function storyTile(label, value, sub, cap, cls = "") {
  return `<div class="st-tile"><div class="st-label">${label}</div><div class="st-value money ${cls}">${value}</div><div class="st-sub">${sub}</div><div class="st-cap">${cap}</div></div>`;
}
function storySteps(s) {
  return [
    ["Paychecks vs plan", +s["Income diff"], "Actual / expected deposits minus the plan"],
    ["Budget changes after the lock", -s["Budget changes"], "A bill's budget changed mid-month"],
    ["Bill amounts vs budget", -s["Bill amount diffs"], "Statements higher (−) or lower (+) than budget"],
    ["Debt payments vs plan", -s["Debt payment diffs"], "Extra (−) or smaller (+) card / loan payments"],
    ["Carried in from last month", -s["Carried in"], "Last month's bills paid with this month's cash"],
    ["Pushed to next month", +s["Carried out"], "This month's bills paid with next month's cash"],
    ["Already paid last month", +s["Paid early last month"], "This month's bills paid early with last month's cash"],
    ["Next month's bills paid early", -s["Paid early for next month"], "Next month's bills paid from this month's cash"],
    ["One-off expenses", -s["Other expenses"], "Other Expenses tab"],
    ["Everyday PNC spending", -s["Everyday spending"], "Spending between Fridays (from the Friday PNC balances)"],
  ].map(([label, v, why]) => ({ label, v: round2(v), why }));
}
/* Horizontal waterfall (HTML, so it reads on a phone): Planned left over → each step → Expected left over. */
function waterfall(s) {
  const steps = storySteps(s), plan0 = +s["Planned left over"] || 0, end = +s["Expected left over"] || 0;
  let run = plan0;
  const rows = [{ label: "Planned left over", sub: "Locked paychecks minus locked bills", a: 0, b: plan0, v: plan0, kind: "total" }];
  steps.forEach(x => { rows.push({ label: x.label, sub: x.why, a: run, b: run + x.v, v: x.v, kind: Math.abs(x.v) < 0.005 ? "zero" : x.v > 0 ? "up" : "down" }); run += x.v; });
  rows.push({ label: s.Status === "Past" ? "Left over" : "Expected left over", sub: "Should match the Left over tile", a: 0, b: end, v: end, kind: "total" });
  const lo = Math.min(0, ...rows.flatMap(r => [r.a, r.b])), hi = Math.max(0, ...rows.flatMap(r => [r.a, r.b])), span = hi - lo || 1;
  const pct = v => ((v - lo) / span) * 100, zero = pct(0);
  const ties = Math.abs(run - end) < 0.01 && Math.abs(+s["Bridge check"] || 0) < 0.005;
  return `<div class="wf" role="img" aria-label="Planned left over ${money(plan0, 0)} to ${money(end, 0)}, step by step">
    ${rows.map(r => `<div class="wf-row ${r.kind}">
      <div class="wf-label"><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></div>
      <div class="wf-track">${lo < 0 ? `<i class="wf-zero" style="left:${zero}%"></i>` : ""}<i class="wf-bar" style="left:${pct(Math.min(r.a, r.b))}%;width:${Math.max(r.kind === "zero" ? 0 : 0.6, (Math.abs(r.b - r.a) / span) * 100)}%"></i></div>
      <div class="wf-val money">${r.kind === "total" ? money(r.v, 0) : r.kind === "zero" ? "—" : sgn(r.v, 0)}</div>
    </div>`).join("")}
  </div>
  <p class="st-check ${ties ? "ok" : "bad"}">${ties ? "✓ Steps add up to the left over (Bridge check = 0)." : `⚠ Steps don't add up (Bridge check ${money(s["Bridge check"])}) — see Model details ▸ checks.`}</p>`;
}
function storyCats(vm, s) {
  const cats = DB.tblExportCategory.filter(c => c.Month === vm);
  const max = Math.max(1, ...cats.map(c => Math.max(+c["Locked plan"] || 0, +c.Expected || 0)));
  const tot = { p: sum(cats, c => c["Locked plan"]), e: sum(cats, c => c.Expected) };
  const ties = Math.abs(tot.e - (+s["Bills expected"] || 0)) < 0.01;
  const shown = cats.filter(c => (+c["Locked plan"] || 0) || (+c.Expected || 0));
  const vp = (v, p) => p ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v / p * 1000) / 10)}%` : "—";
  return `<div class="legend"><span><i class="sw" style="background:var(--story-plan)"></i>Planned (locked)</span><span><i class="sw" style="background:var(--story-head)"></i>${s.Status === "Past" ? "Actual" : "Actual / expected"}</span></div>
  <div class="catbars">${shown.map(c => `<div class="cb-row"><span class="cb-name">${esc(c.Category)}</span>
      <span class="cb-bars"><i style="width:${(+c["Locked plan"] || 0) / max * 100}%;background:var(--story-plan)" title="Planned ${money(c["Locked plan"])}"></i><i style="width:${(+c.Expected || 0) / max * 100}%;background:var(--story-head)" title="Actual / expected ${money(c.Expected)}"></i></span>
      <span class="cb-v money ${tone(c["Story variance"])}">${Math.abs(+c["Story variance"] || 0) >= 0.005 ? sgn(c["Story variance"]) : "on plan"}</span></div>`).join("") || `<p class="empty">No bills this month.</p>`}</div>
  <div class="table-wrap"><table class="data st-table"><thead><tr><th>Category</th><th class="r">Planned</th><th class="r">Actual / expected</th><th class="r">Variance</th><th class="r">Var %</th></tr></thead><tbody>
    ${cats.map(c => `<tr><td>${esc(c.Category)}</td><td class="r money">${money(c["Locked plan"])}</td><td class="r money">${money(c.Expected)}</td><td class="r money ${tone(c["Story variance"])}">${Math.abs(+c["Story variance"] || 0) >= 0.005 ? sgn(c["Story variance"], 2) : "—"}</td><td class="r">${Math.abs(+c["Story variance"] || 0) >= 0.005 ? vp(+c["Story variance"], +c["Locked plan"]) : "—"}</td></tr>`).join("")}
    <tr class="tot"><td>Total</td><td class="r money">${money(tot.p)}</td><td class="r money">${money(tot.e)}</td><td class="r money ${tone(tot.e - tot.p)}">${Math.abs(tot.e - tot.p) >= 0.005 ? sgn(tot.e - tot.p, 2) : "—"}</td><td class="r">${Math.abs(tot.e - tot.p) >= 0.005 ? vp(tot.e - tot.p, tot.p) : "—"}</td></tr>
  </tbody></table></div>
  <p class="st-check ${ties ? "ok" : "bad"}">${ties ? "✓ Matches Bills for the month." : "⚠ Categories don't add up to Bills for the month."}</p>`;
}
/* Six months around the selected one, like the sheet: start = max(2, min(row − 2, rows − 5)) (1-based). */
function storyTrendRows(vm) {
  const all = DB.tblExportStory, i = all.findIndex(x => x.Month === vm) + 1;
  const start = Math.max(2, Math.min(i - 2, all.length - 5));
  return all.slice(start - 1, start + 5);
}
function storyDrill(key, title, hint, rows, head, cell, total) {
  const open = !!state.storyOpen[key];
  return `<details class="st-drill" data-drill="${key}" ${open ? "open" : ""}><summary><span>${title}</span><span class="hint">${rows.length ? `${rows.length} bill${rows.length === 1 ? "" : "s"}${total !== undefined ? ` · ${money(total)}` : ""}` : "none"}</span></summary>
    <p class="hint" style="margin:6px 0 8px">${hint}</p>
    ${rows.length ? `<div class="table-wrap"><table class="data st-table"><thead><tr>${head.map(h => `<th class="${/Planned|Actual|Amount|Variance|Paid$/.test(h) ? "r" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${cell(r).map(c => `<td${c.startsWith("<!--r-->") ? ' class="r money"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="empty">None this month.</p>`}
  </details>`;
}
const R = v => `<!--r-->${money(v)}`;
const stPill = r => { const x = status(r); return `<span class="pill st ${x.c}">${esc(x.t)}</span>`; };
const billName = r => `${esc(r.Bill)}${autoTag(r)}`;
const mShort = m => m ? monthName(m, { month: "short", year: "numeric" }) : "—";
function viewStory() {
  const vm = state.vm, s = storyRow(vm), all = DB.tblExportStory;
  if (!s) return `${monthBar()}<section class="card card-pad"><h2>No Monthly Story for ${monthName(vm)}</h2><p class="note">The story covers ${all.length ? `${esc(all[0].Label)} – ${esc(all.at(-1).Label)}` : "the months in tblExportStory"}. Use ‹ › to pick a month.</p></section>`;
  const past = s.Status === "Past", actLabel = past ? "Actual" : "Actual / expected";
  const locked = s["Plan locked?"] === true;
  const mRows = reg().filter(r => r.Month === vm && (r.Applies || (+r.Expected || 0) || (+r["Locked plan"] || 0)));
  const byDue = (a, b) => (a["Due date"] < b["Due date"] ? -1 : a["Due date"] > b["Due date"] ? 1 : String(a.Bill).localeCompare(String(b.Bill)));
  const variances = mRows.filter(r => Math.abs(+r["Story variance"] || 0) >= 0.005).sort((a, b) => Math.abs(b["Story variance"]) - Math.abs(a["Story variance"]));
  const carried = reg().filter(r => r["Story cash month"] === vm && r.Month < vm && (+r.Expected || 0) > 0).sort(byDue);
  const pushed = reg().filter(r => r.Month === vm && r["Story cash month"] > vm && (+r.Expected || 0) > 0).sort(byDue);
  const early = reg().filter(r => r["Story cash month"] === vm && r.Month > vm && (+r.Expected || 0) > 0).sort(byDue);
  const nonrec = mRows.filter(r => r["Non-recurring"] === true).sort(byDue);
  const every = mRows.slice().sort(byDue);
  const trend = storyTrendRows(vm);
  const inc = +s["Income diff"] || 0, lod = +s["Left over diff"] || 0, bv = +s["Bills variance"] || 0;
  return `${monthBar()}
  <section class="card st-head">
    <div class="st-title"><div><span class="eyebrow">Monthly Story</span><h2>${monthName(vm)}</h2></div>
      <div class="st-badges"><span class="sbadge ${esc(String(s.Status).toLowerCase())}" title="Past = finished · Current = this month · Future = not started">${esc(s.Status)}</span>${locked ? `<span class="sbadge lock" title="The plan was frozen on the 1st (Plan Lock). Later budget changes show as variances.">Plan locked 🔒</span>` : `<span class="sbadge unlocked" title="Not locked yet — the plan uses today's budgets until the month is locked.">Plan not locked yet</span>`}</div></div>
    <p class="st-intro">What we planned at the start of the month vs. what ${past ? "actually happened" : "has happened so far plus what the model still expects"}. <b>Plan</b> = frozen on the 1st.</p>
    <div class="st-tiles">
      ${storyTile("Paychecks", money(s["Income expected"], 0), `Plan ${money(s["Income planned"], 0)} · ${Math.abs(inc) < 0.5 ? "on plan" : `<span class="${toneUp(inc)}">${sgn(inc)}</span>`}`, `Received so far ${money(s["Income received"], 0)}`)}
      ${storyTile("Bills for the month", money(s["Bills expected"], 0), `Plan ${money(s["Bills planned"], 0)}`, `Paid ${money(s["Bills paid so far"], 0)} · ${money(s["Bills still to pay"], 0)} to go`)}
      ${storyTile("Bills vs plan", Math.abs(bv) < 0.5 ? "On plan" : sgn(bv), `Amounts ${sgn(s["Bill amount diffs"])} · Debt ${sgn(s["Debt payment diffs"])}${Math.abs(+s["Budget changes"] || 0) >= 0.5 ? ` · Budget changes ${sgn(s["Budget changes"])}` : ""}`, "+ means more went out than planned", tone(bv))}
      ${storyTile("Carried in", money(s["Carried in"], 0), `${+s["Carried in count"] || 0} bill${+s["Carried in count"] === 1 ? "" : "s"} · ${money(s["Carried in unpaid"], 0)} still unpaid`, "Last month's bills paid with this month's cash")}
      ${storyTile("Non-recurring", money(s["Non-recurring bills"], 0), esc(s["Non-recurring items"] || "None this month"), "Quarterly / annual bills — explains a month that looks high")}
      ${storyTile("Left over", money(s["Expected left over"], 0), `Plan ${money(s["Planned left over"], 0)} · <span class="${toneUp(lod)}">${Math.abs(lod) < 0.5 ? "on plan" : sgn(lod)}</span>`, "After bills, one-offs and everyday spending", +s["Expected left over"] < 0 ? "neg" : "")}
    </div>
    <div class="st-headline"><span class="eyebrow">The story in one paragraph</span><p>${esc(s.Headline || "")}</p></div>
  </section>

  <section class="twocol st-two">
    <div class="card card-pad st-card"><div class="st-h"><h3>1 · How the plan turned into what's left over</h3></div>
      <div class="legend"><span><i class="sw" style="background:var(--story-head)"></i>Total</span><span><i class="sw" style="background:var(--story-green)"></i>Helped</span><span><i class="sw" style="background:var(--story-red)"></i>Hurt</span></div>
      ${waterfall(s)}
    </div>
    <div class="card card-pad st-card"><div class="st-h"><h3>2 · Planned vs ${actLabel.toLowerCase()} by category</h3></div>
      <p class="hint" style="margin:0 0 8px">Bills that belong to ${monthName(vm, { month: "long" })}, whenever they're paid.</p>
      ${storyCats(vm, s)}
    </div>
  </section>

  <section class="card card-pad st-card"><div class="st-h"><h3>3 · Month by month — why some months run high</h3></div>
    <div class="legend"><span><i class="sw" style="background:var(--story-head)"></i>Recurring</span><span><i class="sw" style="background:var(--story-amber)"></i>Non-recurring</span><span><i class="sw" style="background:var(--story-plan)"></i>Carried in</span><span><i class="sw-dash"></i>Bills planned</span></div>
    <div class="chart-wrap" id="storyTrend"></div><div class="tip" id="stTip" hidden></div>
    <div class="table-wrap"><table class="data st-table" style="margin-top:10px"><thead><tr><th>Month</th><th class="r">Planned bills</th><th class="r">Recurring</th><th class="r">Non-recurring</th><th class="r">Carried in</th><th class="r">Left over</th></tr></thead><tbody>
      ${trend.map(t => `<tr class="${t.Month === vm ? "sel" : ""}"><td>${esc(t.Label)}${t.Month === vm ? " ◂" : ""}</td><td class="r money">${money(t["Bills planned"], 0)}</td><td class="r money">${money(t["Recurring bills"], 0)}</td><td class="r money">${money(t["Non-recurring bills"], 0)}</td><td class="r money">${money(t["Carried in"], 0)}</td><td class="r money ${+t["Expected left over"] < 0 ? "neg" : ""}">${money(t["Expected left over"], 0)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="hint" style="margin:8px 0 0">Recurring + non-recurring = the month's own bills. Carried in = last month's bills paid with this month's cash.</p>
  </section>

  <section class="card card-pad st-card"><div class="st-h"><h3>4 · Drill-downs — the bills behind every number</h3></div>
    ${storyDrill("variances", "Variances — where it differs from the locked plan", "Largest first. Why = Variance reason from the workbook.", variances,
      ["Bill", "Category", "Planned", actLabel, "Variance", "Why"], r => [billName(r), esc(r.Category), R(r["Locked plan"]), R(r.Expected), `<!--r--><span class="${tone(r["Story variance"])}">${sgn(r["Story variance"], 2)}</span>`, esc(r["Variance reason"] || "")])}
    ${storyDrill("carried", "Carried in — last month's bills paid with this month's cash", "Bills from an earlier month whose cash comes out this month.", carried,
      ["Bill", "Bill's month", "Due", "Amount", "Status"], r => [billName(r), mShort(r.Month), shortD(r["Due date"]), R(r.Expected), `${stPill(r)}<div class="hint">${esc(r["Pay from"] || "")}</div>`], sum(carried, r => r.Expected))}
    ${storyDrill("pushed", "Pushed to next month — this month's bills paid with next month's cash", "This month's bills whose cash comes out next month.", pushed,
      ["Bill", "Cash month", "Due", "Amount", "Status"], r => [billName(r), mShort(r["Story cash month"]), shortD(r["Due date"]), R(r.Expected), `${stPill(r)}<div class="hint">${esc(r["Pay from"] || "")}</div>`], sum(pushed, r => r.Expected))}
    ${storyDrill("early", "Paid early — next month's bills paid from this month's cash", "Bills from a later month whose cash comes out this month.", early,
      ["Bill", "Bill's month", "Due", "Amount", "Status"], r => [billName(r), mShort(r.Month), shortD(r["Due date"]), R(r.Expected), `${stPill(r)}<div class="hint">${esc(r["Pay from"] || "")}</div>`], sum(early, r => r.Expected))}
    ${storyDrill("nonrec", "Non-recurring — quarterly / annual bills this month", "Bills that don't come every month.", nonrec,
      ["Bill", "How often", "Planned", actLabel, "Variance", "Status"], r => [billName(r), esc(r.Frequency || ""), R(r["Locked plan"]), R(r.Expected), `<!--r--><span class="${tone(r["Story variance"])}">${Math.abs(+r["Story variance"] || 0) >= 0.005 ? sgn(r["Story variance"], 2) : "—"}</span>`, stPill(r)], sum(nonrec, r => r.Expected))}
    ${storyDrill("every", "Every bill this month", "All of this month's bills, by due date.", every,
      ["Bill", "Category", "Planned", actLabel, "Paid", "Timing", "Status"], r => [billName(r), esc(r.Category), R(r["Locked plan"]), R(r.Expected), R(r["Paid total"]), esc(r.Timing || "—"), stPill(r)], sum(every, r => r.Expected))}
  </section>`;
}
/* 6-month trend: stacked Recurring / Non-recurring / Carried in columns + dashed "Bills planned" line; selected month highlighted.
   Drawn at the container's real width so labels stay readable on a phone. */
function drawStoryTrend() {
  const el = $("#storyTrend"); if (!el) return;
  const vm = state.vm, rows = storyTrendRows(vm);
  const W = Math.max(300, Math.round(el.clientWidth || 860)), H = W < 520 ? 220 : 260, L = W < 520 ? 44 : 60, R = 10, T = 14, B = 28;
  const tops = rows.map(t => (+t["Recurring bills"] || 0) + (+t["Non-recurring bills"] || 0) + (+t["Carried in"] || 0));
  const max = Math.max(1, ...tops, ...rows.map(t => +t["Bills planned"] || 0));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step, y = v => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - R) / rows.length, bw = Math.min(56, gw * 0.56);
  const k = v => W < 520 ? (v >= 1000 ? `$${Math.round(v / 1000)}k` : money(v, 0)) : money(v, 0);
  let g = ""; for (let v = 0; v <= top + 1; v += step) g += `<line class="${v ? "grid" : "base"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${k(v)}</text>`;
  const bars = rows.map((t, i) => {
    const cx = L + gw * i + gw / 2, x0 = cx - bw / 2, sel = t.Month === vm;
    const segs = [["Recurring", +t["Recurring bills"] || 0, "var(--story-head)"], ["Non-recurring", +t["Non-recurring bills"] || 0, "var(--story-amber)"], ["Carried in", +t["Carried in"] || 0, "var(--story-plan)"]];
    let base = 0;
    const rects = segs.map(([n, v, c]) => { if (v <= 0) return ""; const r = `<rect x="${x0}" y="${y(base + v)}" width="${bw}" height="${y(base) - y(base + v)}" fill="${c}"${sel ? "" : ' opacity=".55"'}/>`; base += v; return r; }).join("");
    return `${sel ? `<rect x="${cx - gw / 2 + 2}" y="${T - 6}" width="${gw - 4}" height="${H - B - T + 6}" rx="6" fill="var(--story-soft)"/>` : ""}${rects}
      <rect x="${cx - gw / 2}" y="${T}" width="${gw}" height="${H - B - T}" fill="transparent" data-i="${i}" class="st-hit"/>
      <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle" style="${sel ? "font-weight:700;fill:var(--story-head)" : ""}">${esc(t.Label.replace(" 20", " '"))}</text>`;
  }).join("");
  const line = rows.map((t, i) => `${i ? "L" : "M"}${L + gw * i + gw / 2},${y(+t["Bills planned"] || 0)}`).join("");
  const dots = rows.map((t, i) => `<circle cx="${L + gw * i + gw / 2}" cy="${y(+t["Bills planned"] || 0)}" r="3.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.5"/>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bills by month: recurring, non-recurring and carried in, with the planned bills line; ${esc(storyRow(vm) ? storyRow(vm).Label : "")} highlighted">${g}${bars}<path d="${line}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="6 4"/>${dots}</svg>`;
  const tip = $("#stTip");
  el.querySelectorAll(".st-hit").forEach(h => {
    h.addEventListener("mousemove", e => {
      const t = rows[+h.dataset.i], bb = el.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(t.Label)}</b><div><span>Recurring</span><span class="v">${money(t["Recurring bills"], 0)}</span></div><div><span>Non-recurring</span><span class="v">${money(t["Non-recurring bills"], 0)}</span></div><div><span>Carried in</span><span class="v">${money(t["Carried in"], 0)}</span></div><div><span>Bills planned</span><span class="v">${money(t["Bills planned"], 0)}</span></div>`;
      tip.style.left = Math.min(bb.width - 190, e.clientX - bb.left + 12) + "px"; tip.style.top = (el.offsetTop + 10) + "px";
    });
    h.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}
document.addEventListener("toggle", e => { const d = e.target; if (d.matches && d.matches("details[data-drill]")) state.storyOpen[d.dataset.drill] = d.open; }, true);
let storyResize = null;
window.addEventListener("resize", () => { if (state.view !== "story") return; clearTimeout(storyResize); storyResize = setTimeout(drawStoryTrend, 150); });

/* ---------------- Debts */
function viewDebts() {
  const bt = DB.tblDebts.find(d => d["Expected category"] === "Balance Transfer");
  const dad = DB.tblDebts.find(d => d["Expected category"] === "Loan");
  const sched = DB.tblDadSchedule, payoff = sched.find(s => s.Starting > 0 && s.Ending === 0);
  const original = (DB.tblDadHistory[0] || {}).Starting || (sched[0] || {}).Starting || 0;
  return `${monthBar()}
  <section class="twocol">
    <div class="card card-pad">
      <div class="card-head"><h2>${esc(bt.Name)} · balance transfer</h2><span class="pill info">${esc(btPlanText(bt))}</span></div>
      <div class="statgrid">
        <div class="stat"><div class="l">Balance</div><div class="v">${money(bt["Latest balance"])}</div></div>
        <div class="stat"><div class="l">Promo rate</div><div class="v">${(bt["Promo APR"] * 100).toFixed(2)}%</div></div>
        <div class="stat"><div class="l">Promo ends</div><div class="v">${monthName(bt["Promo end"], { month: "short", year: "numeric" })}</div></div>
        <div class="stat"><div class="l">Interest this month</div><div class="v">${money(bt["Monthly interest"])}</div></div>
        <div class="stat"><div class="l">Fixed payment</div><div class="v">${money(bt["Fixed monthly payment"])}</div><div class="hint">Still owed at promo end: ${money(bt["Owed at promo end"], 0)}</div></div>
        <div class="stat"><div class="l">To clear it by promo end</div><div class="v">${money(bt["Payoff payment"])}</div><div class="hint">per month, ${bt["Months left"]} payments</div></div>
      </div>
      <div class="legend" style="margin-top:14px"><span><i class="sw" style="background:var(--series-1)"></i>Fixed ${money(bt["Fixed monthly payment"], 0)}/mo</span><span><i class="sw" style="background:var(--series-2)"></i>Payoff ${money(bt["Payoff payment"], 0)}/mo</span></div>
      <div class="chart-wrap" id="btChart"></div>
      <p class="note">John changes the plan in Friday update ▸ Detailed view (or on the Debts tab). The plan follows whichever is set.</p>
    </div>
    <div class="card card-pad">
      <div class="card-head"><h2>${esc(dad.Name)}</h2><span class="hint">0% interest · ${money(original, 0)} original</span></div>
      <div class="statgrid">
        <div class="stat"><div class="l">Balance</div><div class="v">${money(dad["Latest balance"])}</div></div>
        <div class="stat"><div class="l">Monthly payment</div><div class="v">${money(dad["Fixed monthly payment"])}</div></div>
        <div class="stat"><div class="l">Paid off</div><div class="v">${payoff ? monthName(payoff.Month, { month: "short", year: "numeric" }) : "—"}</div></div>
        <div class="stat"><div class="l">Repaid so far</div><div class="v">${Math.round((1 - dad["Latest balance"] / (original || 1)) * 100)}%</div></div>
      </div>
      <div class="chart-wrap" id="dadChart" style="margin-top:12px"></div>
    </div>
  </section>
  <section class="card card-pad"><div class="card-head"><h2>All cards</h2><span class="hint">Balances from the latest Friday update</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Card</th><th>Set as</th><th class="r">APR</th><th class="r">Balance</th><th class="r">Minimum</th><th class="r">Due day</th><th>Flag</th></tr></thead><tbody>
    ${DB.tblDebts.filter(d => d.Name && CARD_CATS.includes(d["Expected category"])).map(d => `<tr><td>${esc(d.Name)}</td><td><span class="pill ${d["Expected category"] === "Active" ? "info" : "muted"}">${esc(d["Expected category"])}</span></td><td class="r money">${d.APR === null ? "—" : (d.APR * 100).toFixed(2) + "%"}</td><td class="r money">${d["Latest balance"] === null ? "—" : money(d["Latest balance"])}</td><td class="r money">${money(d["Minimum used"])}</td><td class="r">${d["Due day"] ?? "—"}</td><td>${d.Flag ? `<span class="pill ${d.Flag === "Unexpected balance" ? "late" : "yellow"}">${esc(d.Flag)}</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>`;
}
function lineChart(el, series, opts) {
  const W = 620, H = 220, L = 64, R = 14, T = 12, B = 28;
  const all = series.flatMap(s => s.pts), n = Math.max(...series.map(s => s.pts.length));
  const max = Math.max(1, ...all.map(p => p.v)), step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const x = i => L + i * (W - L - R) / Math.max(1, n - 1), y = v => T + (H - T - B) * (1 - v / top);
  let g = ""; for (let v = 0; v <= top + 1; v += step) g += `<line class="${v ? "grid" : "base"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v, 0)}</text>`;
  const labels = opts.labels.map((t, i) => t ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${t}</text>` : "").join("");
  const paths = series.map(s => `<path d="${s.pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.v)}`).join("")}" fill="none" stroke="${s.color}" stroke-width="2.5"/>
    <circle cx="${x(s.pts.length - 1)}" cy="${y(s.pts[s.pts.length - 1].v)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  const mark = opts.mark !== undefined ? `<line x1="${x(opts.mark)}" x2="${x(opts.mark)}" y1="${T}" y2="${H - B}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><text class="axis" x="${x(opts.mark) + 6}" y="${T + 10}">Now</text>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.aria}">${g}${labels}${mark}${paths}</svg>`;
}
function drawBT() {
  const el = $("#btChart"); if (!el) return;
  const bt = DB.tblDebts.find(d => d["Expected category"] === "Balance Transfer");
  const r = bt["Promo APR"] / 12, n = bt["Months left"];
  const proj = pay => { const pts = []; let b = bt["Latest balance"]; pts.push({ v: b }); for (let i = 0; i < n; i++) { b = Math.max(0, b * (1 + r) - pay); pts.push({ v: b }); } return pts; };
  const start = bt["Current month"] || monthKey(META.asOf);
  const labels = Array.from({ length: n + 1 }, (_, i) => i % 3 === 0 ? monthName(addMonths(start, i), { month: "short", year: "2-digit" }) : "");
  lineChart(el, [{ pts: proj(bt["Fixed monthly payment"]), color: "var(--series-1)" }, { pts: proj(bt["Payoff payment"]), color: "var(--series-2)" }], { labels, aria: "Balance transfer balance over time under fixed and payoff payments" });
}
function drawDadLoan() {
  const el = $("#dadChart"); if (!el) return;
  const hist = DB.tblDadHistory.map(h => ({ label: h.Month, v: h.Ending }));
  const sched = DB.tblDadSchedule.filter(s => s.Starting > 0).map(s => ({ label: monthName(s.Month, { month: "short", year: "numeric" }), v: s.Ending }));
  const pts = [{ v: 30000, label: "Start" }, ...hist, ...sched];
  const labels = pts.map((p, i) => i % 12 === 0 ? (p.label || "").replace(/ 20(\d\d)/, " '$1") : "");
  lineChart(el, [{ pts, color: "var(--series-1)" }], { labels, mark: hist.length, aria: "Family loan balance from the first recorded payment to payoff" });
}

/* ---------------- Model details (advanced view) */
function viewDetails() {
  return `${monthBar()}
  <section class="card card-pad"><div class="card-head"><h2>Model checks</h2><span class="hint">From the Checks tab (tblExportChecks) · PASS green · WARN yellow (warning only) · FAIL red</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Check</th><th>Result</th><th>What to do if it fails</th></tr></thead><tbody>
    ${DB.tblExportChecks.filter(c => isVal(c.Check)).map((c, i) => `<tr><td class="hint">${i + 1}</td><td>${esc(c.Check)}</td><td><span class="pill ${c.Result === "PASS" ? "paid" : c.Result === "WARN" ? "warn" : "late"}">${esc(c.Result)}</span></td><td class="hint">${esc(c["What to do"])}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="card card-pad"><div class="card-head"><h2>Paycheck planner</h2><span class="hint">tblExportPlan · must-pays placed on the latest safe payday, then card extras from truly free cash</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Payday</th><th class="r">Money in</th><th class="r">Must-pay out</th><th class="r">Card extras</th><th class="r">Total out</th><th class="r">Cash after</th><th>Below cushion</th></tr></thead><tbody>
    ${plan.map(p => `<tr><td>${fmtD(p.Payday)}</td><td class="r money">${money(p["Money in"])}</td><td class="r money">${money(p["Must-pay out"])}</td><td class="r money">${money(p["Card extras"])}</td><td class="r money">${money(p["Total out"])}</td><td class="r money">${money(p["Cash after"])}</td><td>${p["Below cushion"] === true ? `<span class="pill late">Yes</span>` : "No"}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note">Start cash ${money(META.startCash)} as of ${fmtD(META.anchor)} (${META.hasBankEntry ? "your PNC entry" : "opening cash"}). Look-ahead ends ${fmtD(META.horizonEnd)}. Pay-ahead ${META.payAheadDays} days.</p></section>
  <section class="card card-pad"><div class="card-head"><h2>Card payments placed (highest APR first)</h2></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Register row</th><th class="r">Extra placed</th><th>Plan</th></tr></thead><tbody>
    ${DB.tblExportCardPlan.filter(c => c.RowID).map(c => `<tr><td>${c.Block}</td><td class="mono-s">${esc(c.RowID)}</td><td class="r money">${money(c["Extra placed"])}</td><td>${esc(c["Pay-from text"])}</td></tr>`).join("") || `<tr><td colspan="4" class="hint">No card extras in the plan.</td></tr>`}
    </tbody></table></div></section>
  <section class="card card-pad"><div class="card-head"><h2>Data connection</h2><span class="pill info">Dashboard ${VERSION}</span></div>
    <p class="note" style="margin:0">Source: <b>${source.kind === "sample" ? "sample snapshot (preview)" : source.kind === "dialog" ? "live workbook, through the Excel panel" : "live workbook"}</b>. Dashboard ${VERSION}, built for <b>Gielarowski Financial Model (v4).xlsx</b>. Reads tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks, tblExportStory, tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory, tblDadSchedule and tblPlanLock. Writes only: tblRegister payment input columns (matched by RowID) where Record allowed = TRUE or to correct a saved payment — never an auto pay row; tblRegister[Statement amount] alone through Set amount (unpaid Variable bills; never marks paid or locks); tblCardLog / tblCashLog input columns, matched by date (a correction replaces that Friday's row; calculated columns are never written); tblPaychecks[Actual amount]; tblDebts[BT payment mode, Fixed monthly payment]; new rows in tblOther; tblMonths[Month closed?]; and <b>tblPlanLock — new rows only</b> (values, never formulas; existing lock rows are never edited or deleted).</p></section>
  <section class="card card-pad"><div class="card-head"><h2>What's new in ${VERSION}</h2><span class="hint">For Gielarowski Financial Model (v4) · Lists &amp; Notes change log, Oct 31, 2026</span></div>
    <ol class="changes">
      <li><b>Status badges come from the workbook.</b> Text = tblRegister[Status], colour = tblRegister[Badge tone] (red / orange / yellow / blue / green / purple / none). No due-date maths in the dashboard — e.g. a bill with Pay with set shows yellow "Needs Paid - Paying with Fri 11/6 Paycheck". Same badge in Pay this Friday, the bill list, the panel and Monthly Story.</li>
      <li><b>Auto pay.</b> Rows with Autopay bill = TRUE show a blue AUTO PAY tag and no Record payment / Set amount / Mark paid / Unlock. They stay visible and are never written to; the model counts them paid on the draft date. Record payment, Set amount and Mark paid appear only where Record allowed = TRUE (a saved, non-auto pay payment can still be unlocked).</li>
      <li><b>ESTIMATE tag</b> only when Amount type = Variable, Amount known? = FALSE and Autopay bill = FALSE.</li>
      <li><b>Pay this Friday cash math:</b> PNC balance entered → minus payments marked paid since → start cash → minus still to pay → expected PNC until next payday (Engine C7–C12 via tblExportMeta, tblCashLog, tblExportPlan).</li>
      <li><b>This month:</b> "This month's story" box removed; new "Carried over from last month" box (Story cash month = month, earlier bill month, Expected &gt; 0) with tblExportStory Carried in / unpaid / count.</li>
      <li><b>Future months:</b> inside the paycheck plan (now 2 months ahead) Going out / Left at month end come from tblExportPlan; past it they are labelled forecasts from tblExportStory (Bills cash + Other expenses; Expected left over) instead of $0.</li>
      <li><b>New Monthly Story tab</b> (tblExportStory, tblExportCategory Locked plan / Expected / Story variance, tblRegister story columns): tiles, headline, plan → left over waterfall (ties to Bridge check = 0), category chart + variance table, 6-month trend, drill-downs, Past / Current / Future and Plan locked badges.</li>
      <li><b>Auto-lock the plan:</b> on load, the Excel panel appends the Current month to tblPlanLock when Plan locked? = FALSE (one row per register row with Applies = TRUE + the INCOME row last; values only, one call). tblPlanLock is now on the write list.</li>
      <li><b>Refresh:</b> changing month or saving anything re-reads every table, so views update without pressing Refresh.</li>
      <li><b>Checks rows 21–22</b> (story ties out; month locked) shown from tblExportChecks; WARN is yellow and counted separately (checksWarning). "Needs attention" counts red badges (urgent) and orange badges (due soon).</li>
    </ol></section>`;
}

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act], .tab, #modeSimple, #modeDetailed"); if (!t) return;
  if (t.classList.contains("tab")) { state.view = t.dataset.view; state.openRow = null; render(); window.scrollTo({ top: 0 }); return; }
  if (t.id === "modeSimple") { state.detailed = false; render(); return; }
  if (t.id === "modeDetailed") { state.detailed = true; render(); return; }
  if (t.dataset.act === "close-full") { DialogSource.send({ t: "close" }); return; }
  const act = t.dataset.act, row = t.dataset.id ? reg().find(r => r.RowID === t.dataset.id) : null;
  if (act === "prev-month" || act === "next-month") { state.vm = addMonths(state.vm, act === "prev-month" ? -1 : 1); state.openRow = null; state.amtRow = null; state.cat = null; await refreshData(); render(); }
  if (act === "go-details") { state.view = "details"; render(); }
  if (act === "go-friday") { state.view = "friday"; render(); }
  if (["open-row", "open-amount", "open-pay", "quick-pay", "unlock-row"].includes(act) && row && (isAutoBill(row) || (!recordOk(row) && !canUnlock(row)))) return;   // auto pay / not allowed: never written
  if (act === "open-row") { state.amtRow = null; state.openRow = state.openRow === row.RowID ? null : row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) f.querySelector("input").focus(); }
  if (act === "close-row") { state.openRow = null; render(); }
  if (act === "open-amount") { state.openRow = null; state.amtRow = row.RowID; if (state.view !== "month") state.view = "month"; render(); const x = document.querySelector('[data-form="amount"] input'); if (x) { x.scrollIntoView({ block: "center" }); x.focus(); } }
  if (act === "close-amount") { state.amtRow = null; render(); }
  if (act === "clear-amount") await clearAmount(t.dataset.id);
  if (act === "quick-pay") { row._paidToday = true; await writeRow(row, { "Paid date": META.asOf, "Paid amount": +row["Payday amount"] }, `Marked ${esc(row.Bill)} paid · ${money(row["Payday amount"])} on ${shortD(META.asOf)}`); }
  if (act === "undo-row") { await writeRow(row, { "Paid date": null, "Paid amount": null }, `Cleared the payment for ${esc(row.Bill)}`); }
  if (act === "unlock-row") { state.openRow = row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) { f.scrollIntoView({ block: "center" }); f.querySelector("input").focus(); } }
  if (act === "pick-friday") { state.fri.date = t.dataset.date; state.fri.unlocked = false; render(); }
  if (act === "unlock-friday") { state.fri.unlocked = true; render(); const x = document.querySelector('[data-form="friday"] input'); if (x) x.focus(); }
  if (act === "lock-friday") { state.fri.unlocked = false; render(); }
  if (act === "clear-row") { state.openRow = null; await writeRow(row, { "Paid date": null, "Paid amount": null, "Extra paid date": null, "Extra paid amount": null, "Reason if different": null }, `Cleared the payment for ${esc(row.Bill)}`); }
  if (act === "open-pay") { state.view = "month"; state.openRow = row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) f.scrollIntoView({ block: "center" }); }
  if (act === "pay-clear") await clearPaycheck(t.dataset.person, t.dataset.date);
  if (act === "pay-unlock") { state.fri.payUnlocked = t.dataset.date; render(); }
  if (act === "bt-unlock") { state.btUnlocked = t.dataset.id; render(); }
  if (act === "bt-cancel") { state.btUnlocked = null; render(); }
  if (act === "drill") { state.cat = state.cat === t.dataset.cat ? null : t.dataset.cat; render(); }
  if (act === "close-month") {
    await closeMonth(state.vm);
  }
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-act]")) { e.preventDefault(); e.target.click(); } });

document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === "pay") await submitPay(f);
  if (f.dataset.form === "amount") await submitAmount(f);
  if (f.dataset.form === "friday") await saveFriday(new FormData(f), fridayInfo(state.fri.date));
  if (f.dataset.form === "paychecks") await savePaychecks(new FormData(f), f.dataset.date);
  if (f.dataset.form === "bt") await saveBT(f);
});

/* =============================================================================
   Full view in its own Excel window (Office dialog).
   A dialog window cannot touch the workbook, so it goes through the panel:
   the panel sends the tables in chunks; edits are sent back to the panel, which
   writes them into the workbook, lets Excel recalculate, and sends fresh data.
   ============================================================================= */
const DialogSource = {
  kind: "dialog", n: 0, pending: {}, waiters: [], buf: null,
  send(m) { Office.context.ui.messageParent(JSON.stringify(m)); },
  onMessage(arg) {
    let m; try { m = JSON.parse(arg.message); } catch (e) { return; }
    if (m.t === "chunk") {
      // Chunks of one transfer share an id; a newer transfer makes older unfinished ones obsolete.
      if (!this.buf || this.buf.id !== m.id) { if (this.buf && m.id < this.buf.id) return; this.buf = { id: m.id, parts: new Array(m.n), got: 0 }; }
      if (this.buf.parts[m.i] === undefined) { this.buf.parts[m.i] = m.s; this.buf.got++; }
      if (this.buf.got === m.n) {
        const data = JSON.parse(this.buf.parts.join("")); this.buf = null;
        const w = this.waiters.splice(0);
        if (w.length) w.forEach(f => f(data)); else { DB = data; index(); render(); }   // pushed after an edit made in Excel
      }
    }
    if (m.t === "ack") { const p = this.pending[m.id]; if (!p) return; delete this.pending[m.id]; m.ok ? p.res() : p.rej(new Error(m.err)); }
  },
  load() { return new Promise(res => { this.waiters.push(res); this.send({ t: "get" }); }); },
  write(change) { const id = ++this.n; return new Promise((res, rej) => { this.pending[id] = { res, rej }; this.send({ t: "write", id, change }); }); },
};

/* ========================================================================= start */
(async () => {
  const want = location.hash.slice(1);
  if (["month", "friday", "spending", "budget", "story", "debts", "details"].includes(want)) state.view = want;
  if (want === "details") state.detailed = true;
  const inDialog = new URLSearchParams(location.search).get("host") === "dialog";
  if (inDialog && window.Office) {
    await Office.onReady();
    source = DialogSource;
    await new Promise(res => Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, a => DialogSource.onMessage(a), res));
  } else if (!window.__SAMPLE__) {
    $("#app").innerHTML = `<section class="card card-pad"><h2>Open this from Excel</h2><p class="note">This page shows the budget workbook. Open the workbook in Excel, then click <b>Bills &amp; Paychecks</b> on the Home tab and choose <b>Open full dashboard</b>.</p></section>`;
    return;
  }
  DB = await source.load(); index(); render();
})();
