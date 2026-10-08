/* ========================================================================= rendering */
function render() {
  document.body.classList.toggle("detailed", state.detailed);
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === state.view)));
  $("#modeSimple").setAttribute("aria-pressed", String(!state.detailed));
  $("#modeDetailed").setAttribute("aria-pressed", String(state.detailed));
  $("#sampleBanner").hidden = source.kind !== "sample";
  $("#closeFull").hidden = source.kind !== "dialog";
  const v = { month: viewMonth, friday: viewFriday, spending: viewSpending, budget: viewBudget, debts: viewDebts, details: viewDetails }[state.view];
  $("#app").innerHTML = v();
  if (state.view === "month") drawCashBuild();
  if (state.view === "debts") { drawDadLoan(); drawBT(); }
  if (state.view === "budget") drawTrend();
}

function monthBar(extra = "") {
  const fails = +META.checksFailing || 0;
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
    <button class="health ${fails ? "bad" : ""}" data-act="go-details"><span class="dot"></span>${fails ? `${fails} model check${fails === 1 ? "" : "s"} need attention` : "Model health: all checks passed"}</button>
  </section>${keyLine()}`;
}

/* ---------------- This month */
function viewMonth() {
  const vm = state.vm, k = kpis(vm), cur = META.currentPayday;
  const payRows = reg().filter(r => (+r["Payday amount"] || 0) > 0 || (r["Paid date"] === META.asOf && r.Remaining <= 0 && r["Paid total"] > 0));
  const isCurrentMonth = monthKey(cur) === vm || monthKey(META.asOf) === vm;
  const curPlan = planFor(cur);
  const routine = fridayRoutine();
  const eom = endOfMonth(vm);
  const complete = eom.every(x => x.on);
  return `
  ${monthBar()}
  <section class="today-grid">
    <div class="card payday">
      <div class="payday-head"><h2>Pay this Friday · ${fmtD(cur, { month: "short", day: "numeric" })}</h2><span>${payRows.filter(r => r.Remaining > 0).length} to pay</span></div>
      ${payRows.length ? `<ul class="payday-list">${payRows.map(r => {
        const done = r.Remaining <= 0, st = status(r);
        return `<li class="${done ? "done" : ""}">
          <div><div class="pl-name">${esc(r.Bill)}</div><div class="pl-note"><span class="pill st ${st.c}">${esc(st.t)}</span><span>due ${shortD(r["Due date"])}</span>${r["Extra wanted"] > 0 ? `<span>full balance</span>` : ""}</div></div>
          <div class="pl-amt">${money(done ? r["Paid total"] : r["Payday amount"])}</div>
          <div>${done ? `<button class="btn small ghost" data-act="unlock-row" data-id="${esc(r.RowID)}" title="Saved and locked">🔒 Unlock</button>` :
            `<button class="btn small primary" data-act="quick-pay" data-id="${esc(r.RowID)}" aria-label="Mark ${esc(r.Bill)} paid">Mark paid</button>`}</div>
        </li>`; }).join("")}</ul>` : `<p class="empty">Nothing left to pay from this payday.</p>`}
      <div class="payday-foot">
        <span>Total: <strong class="money">${money(sum(payRows.filter(r => r.Remaining > 0), r => r["Payday amount"]))}</strong></span>
        <span>After paying, PNC should have about <strong class="money">${money(curPlan ? curPlan["Cash after"] : null)}</strong> until ${fmtD(META.nextPayday)}.</span>
      </div>
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
    ${kpi("Going out", money(k.goingOut), `Paid so far: ${money(k.paidSoFar)}`, "Everything this month's paychecks pay, including early bills for next month.")}
    ${kpi("Left at month end", money(k.left), "If everything goes to plan", "What should still be in PNC after the last payday's bills.", "v-good")}
    ${kpi("Bills paid", `${k.paidN} of ${k.total}`, "Includes last month's leftovers", "Green rows in the bill list.")}
    ${kpi("Needs attention", `${k.late} late`, `${k.soon} more due within ${META.soonOrangeDays} days`, "Dark-red and orange rows below.", k.late ? "v-bad" : "")}
    ${kpi("Lowest balance ahead", money(k.low ? k.low["Cash after"] : null), k.low ? `${fmtD(k.low.Payday)} · cushion ${money(META.cushion, 0)} ${k.low["Cash after"] >= META.cushion ? "✓" : "— short"}` : "", "The tightest point between now and the end of next month.", k.low && k.low["Cash after"] < META.cushion ? "v-bad" : "v-good")}
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
    <div class="card card-pad"><div class="card-head"><h2>This month's story</h2></div><p class="story">${story(vm, k)}</p></div>
  </section>`;
}
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
    const st = status(r), cm = r["Cash month"];
    const flag = r.Source === "Debt" && (debtsById[r.ItemID] || {}).Flag === "Unexpected balance";
    const open = state.openRow === r.RowID;
    html += `<tr>
      <td><span class="pill st ${st.c}">${esc(st.t)}</span>${flag ? `<span class="flag" title="This card is set to $0 Balance but shows a balance">!</span>` : ""}</td>
      <td><div class="b-name">${esc(r.Bill)}</div><div class="b-detail">${esc(r.Detail || "")}</div><span class="mono-s detail-only">${esc(r.RowID)}</span></td>
      <td>${shortD(r["Due date"])}${r.Rule === "End of service month" ? `<div class="b-detail">pay by ${shortD(r["Pay by"])}</div>` : ""}</td>
      <td class="r money">${money(r.Amount)}</td>
      <td>${esc(r["Pay from"] || "")}</td>
      <td class="b-why detail-only">${esc(r.Why || "")}</td>
      <td class="detail-only mono-s">${esc(r.Rule || "")}<br>must ${money(r["Remaining must"])} · extra ${money(r["Extra planned"])}</td>
      <td>${cm ? `<span class="auto-chip" title="Fills in automatically from the paid or planned date">${monthName(cm, { month: "short" })} cash</span>` : `<span class="hint">—</span>`}</td>
      <td class="paidcell">${r["Paid date"] ? `${shortD(r["Paid date"])}<span class="money">${money(r["Paid amount"])}</span>${r["Extra paid amount"] ? `<span class="money">+ ${money(r["Extra paid amount"])}</span>` : ""}` : "—"}${r["Needs reason"] === true ? `<div class="b-detail" style="color:var(--late-bg)">Pick a reason</div>` : r["Reason if different"] ? `<div class="b-detail">${esc(r["Reason if different"])}</div>` : ""}</td>
      <td class="r">${st.c === "info" ? `<button class="btn small" data-act="go-friday">Enter balance</button>` :
        `<button class="btn small ${r.Remaining > 0 ? "" : "ghost"}" data-act="open-row" data-id="${esc(r.RowID)}" aria-expanded="${open}">${r["Paid date"] ? (open ? "Close" : "🔒 Unlock to edit") : "Record payment"}</button>`}</td>
    </tr>`;
    if (open) html += `<tr class="formrow"><td colspan="12">${payForm(r)}</td></tr>`;
  }
  return `<section class="card card-pad">
    <div class="card-head"><h2>Bills for ${monthName(vm)}</h2><span class="hint">${rows.length} bills · sorted by group, then due date. Cards appear only when they have a balance.</span></div>
    ${statusKey()}<div style="height:10px"></div>
    <div class="table-wrap"><table class="bills">
      <thead><tr><th>Status</th><th>Bill</th><th>Due</th><th class="r">Amount</th><th>Pay from</th><th class="detail-only">Why this payday</th><th class="detail-only">Planner</th><th>Cash month</th><th>Paid</th><th class="r"><span class="sr">Action</span></th></tr></thead>
      <tbody>${html || `<tr><td colspan="12" class="empty">No bills this month.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}


function earlyBox(vm) {
  const nxt = addMonths(vm, 1);
  const rows = reg().filter(r => r.Month === nxt && r["Cash month"] === vm && r.Applies);
  return `<div class="card card-pad early"><div class="card-head"><h2>${monthName(nxt, { month: "long" })} bills paid early with ${monthName(vm, { month: "long" })} cash</h2></div>
  ${rows.length ? `<ul>${rows.map(r => `<li>${esc(r.Bill)} <span class="money">${money(r.Amount)}</span> · due ${shortD(r["Due date"])} · ${esc(r["Pay from"] || "")}</li>`).join("")}</ul>
  <p class="note" style="color:inherit">Total ${money(sum(rows, r => r.Amount))}. The first ${monthName(nxt, { month: "long" })} payday comes too late for these.</p>` : `<p class="note" style="color:inherit">None this month.</p>`}</div>`;
}
function story(vm, k) {
  const nxt = addMonths(vm, 1), prv = addMonths(vm, -1);
  const early = sum(reg().filter(r => r.Month === nxt && r["Cash month"] === vm), r => r.Amount);
  const carried = sum(viewRows(vm).filter(r => r.Month === prv), r => r.Amount);
  const spend = sum(DB.tblCardLog.filter(l => monthKey(l.Date) === vm), l => l.Spending);
  return `In ${monthName(vm, { month: "long" })} we expect <b>${money(k.comingIn, 0)}</b> to come in and <b>${money(k.goingOut, 0)}</b> to go out with this month's money, leaving about <b>${money(k.left, 0)}</b> in PNC at month end.
   ${early > 0 ? `${money(early, 0)} of that pays next month's bills early. ` : ""}${carried > 0 ? `${money(carried, 0)} covers last month's bills paid this month. ` : ""}
   ${spend ? `Cards picked up ${money(spend, 0)} of new spending so far. ` : ""}So far ${k.paidN} of ${k.total} bills are paid.`;
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
  return `${monthBar()}
  <form class="card card-pad" data-form="friday">
    <div class="card-head"><h2>Friday update</h2><span class="hint">Pick a pay period. Every Friday morning, before paying bills.</span></div>
    ${picker}
    ${i.date ? fridayBanner(i) : ""}
    <div class="statgrid" style="margin:14px 0 16px">
      <div class="field">PNC checking balance (includes that day's paychecks)${fridayField(i, "bank", "PNC checking balance", i.bank ? i.bank["PNC balance"] : null)}</div>
      <div class="stat"><div class="l">Model expected today</div><div class="v">${money(META.expectedBankToday)}</div></div>
      <div class="stat"><div class="l">Latest PNC entry</div><div class="v">${lastBank ? money(lastBank["PNC balance"]) : "—"}</div><div class="hint">${lastBank ? fmtD(lastBank.Date) : "none yet"}</div></div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Card</th><th>Set as</th><th class="r">Before this Friday</th><th>Balance ${i.date ? shortD(i.date) : ""}</th><th>Minimum</th><th>Due</th><th>Note</th></tr></thead>
      <tbody>${i.cards.map(d => { const sv = i.saved[d.Name], prev = DB.tblCardLog.filter(l => l["Card or loan"] === d.Name && isVal(l.Balance) && l.Date < i.date).at(-1); return `<tr>
        <td><b>${esc(d.Name)}</b></td>
        <td><span class="pill ${d["Expected category"] === "Active" ? "info" : "muted"}">${esc(d["Expected category"])}</span></td>
        <td class="r money">${prev ? money(prev.Balance) : "—"}<div class="hint">${prev ? shortD(prev.Date) : ""}</div></td>
        <td>${fridayField(i, `bal-${d.DebtID}`, `${d.Name} balance`, sv ? sv.Balance : null)}</td>
        <td>${fridayField(i, `min-${d.DebtID}`, `${d.Name} minimum payment`, sv ? sv.Minimum : null, isVal(d["Latest minimum"]) ? `keep ${d["Latest minimum"]}` : "")}</td>
        <td>${d["Due day"] ? `${d["Due day"]}th` : "—"}</td>
        <td class="hint">${esc(d.Flag || "")}</td></tr>`; }).join("")}</tbody>
    </table></div>
    ${i.editable ? `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center"><button class="btn primary" type="submit">Save Friday update</button><span class="hint">Saves one entry per card you filled in, plus the PNC balance, then locks them.</span></div>` : ""}
  </form>
  <section class="card card-pad"><div class="card-head"><h2>Recent entries</h2></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Card</th><th class="r">Balance</th><th class="r">Minimum</th><th class="r">Spending since last week</th></tr></thead>
    <tbody>${DB.tblCardLog.filter(l => isVal(l.Balance)).slice().reverse().slice(0, 20).map(l => `<tr><td>${shortD(l.Date)}</td><td>${esc(l["Card or loan"])}</td><td class="r money">${money(l.Balance)}</td><td class="r money">${money(l.Minimum)}</td><td class="r money">${isVal(l.Spending) ? money(l.Spending) : "—"}</td></tr>`).join("")}</tbody></table></div>
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
    <div class="table-wrap"><table class="data" style="margin-top:12px"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Paid out (cash)</th><th class="r">Bills budget</th><th class="r">Bills paid</th><th class="r">Difference on paid bills</th><th class="r">Card spending</th><th>Closed</th></tr></thead><tbody>
      ${trendMonths().map(h => `<tr><td>${esc(h.Label)}</td><td class="r money">${money(h["Income planned"])}</td><td class="r money">${money(h["Paid out (cash)"])}</td><td class="r money">${money(h["Bills budget"])}</td><td class="r money">${money(h["Bills paid"])}</td><td class="r money">${h["Variance on paid bills"] ? money(h["Variance on paid bills"]) : "—"}</td><td class="r money">${money(h["Card spending"])}</td><td>${esc(h.Closed)}</td></tr>`).join("")}
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

/* ---------------- Debts */
function viewDebts() {
  const bt = DB.tblDebts.find(d => d["Expected category"] === "Balance Transfer");
  const dad = DB.tblDebts.find(d => d["Expected category"] === "Loan");
  const sched = DB.tblDadSchedule, payoff = sched.find(s => s.Starting > 0 && s.Ending === 0);
  const original = (DB.tblDadHistory[0] || {}).Starting || (sched[0] || {}).Starting || 0;
  return `${monthBar()}
  <section class="twocol">
    <div class="card card-pad">
      <div class="card-head"><h2>${esc(bt.Name)} · balance transfer</h2><span class="pill info">${esc(bt["BT payment mode"])}</span></div>
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
      <p class="note">Switch the mode on the Debts tab of the workbook (BT payment mode). The plan follows whichever is set.</p>
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
    ${DB.tblDebts.filter(d => d["Expected category"] !== "Loan").map(d => `<tr><td>${esc(d.Name)}</td><td><span class="pill ${d["Expected category"] === "Active" ? "info" : "muted"}">${esc(d["Expected category"])}</span></td><td class="r money">${d.APR === null ? "—" : (d.APR * 100).toFixed(2) + "%"}</td><td class="r money">${d["Latest balance"] === null ? "—" : money(d["Latest balance"])}</td><td class="r money">${money(d["Minimum used"])}</td><td class="r">${d["Due day"] ?? "—"}</td><td>${d.Flag ? `<span class="pill ${d.Flag === "Unexpected balance" ? "late" : "yellow"}">${esc(d.Flag)}</span>` : ""}</td></tr>`).join("")}
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
  <section class="card card-pad"><div class="card-head"><h2>Model checks</h2><span class="hint">From the Checks tab</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Check</th><th>Result</th><th>What to do if it fails</th></tr></thead><tbody>
    ${DB.tblExportChecks.map(c => `<tr><td>${esc(c.Check)}</td><td><span class="pill ${c.Result === "PASS" ? "paid" : "late"}">${esc(c.Result)}</span></td><td class="hint">${esc(c["What to do"])}</td></tr>`).join("")}
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
  <section class="card card-pad"><div class="card-head"><h2>Data connection</h2></div>
    <p class="note" style="margin:0">Source: <b>${source.kind === "sample" ? "sample snapshot (preview)" : source.kind === "dialog" ? "live workbook, through the Excel panel" : "live workbook"}</b>. Reads tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks, tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory and tblDadSchedule. Writes only tblRegister input columns (matched by RowID), new rows in tblCardLog, tblCashLog and tblOther, and tblMonths[Month closed?].</p></section>`;
}

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act], .tab, #modeSimple, #modeDetailed"); if (!t) return;
  if (t.classList.contains("tab")) { state.view = t.dataset.view; state.openRow = null; render(); window.scrollTo({ top: 0 }); return; }
  if (t.id === "modeSimple") { state.detailed = false; render(); return; }
  if (t.id === "modeDetailed") { state.detailed = true; render(); return; }
  if (t.dataset.act === "close-full") { DialogSource.send({ t: "close" }); return; }
  const act = t.dataset.act, row = t.dataset.id ? reg().find(r => r.RowID === t.dataset.id) : null;
  if (act === "prev-month" || act === "next-month") { state.vm = addMonths(state.vm, act === "prev-month" ? -1 : 1); state.openRow = null; state.cat = null; render(); }
  if (act === "go-details") { state.view = "details"; render(); }
  if (act === "go-friday") { state.view = "friday"; render(); }
  if (act === "open-row") { state.openRow = state.openRow === row.RowID ? null : row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) f.querySelector("input").focus(); }
  if (act === "close-row") { state.openRow = null; render(); }
  if (act === "quick-pay") { row._paidToday = true; await writeRow(row, { "Paid date": META.asOf, "Paid amount": +row["Payday amount"] }, `Marked ${esc(row.Bill)} paid · ${money(row["Payday amount"])} on ${shortD(META.asOf)}`); }
  if (act === "undo-row") { await writeRow(row, { "Paid date": null, "Paid amount": null }, `Cleared the payment for ${esc(row.Bill)}`); }
  if (act === "unlock-row") { state.openRow = row.RowID; render(); const f = document.querySelector(`[data-form="pay"]`); if (f) { f.scrollIntoView({ block: "center" }); f.querySelector("input").focus(); } }
  if (act === "pick-friday") { state.fri.date = t.dataset.date; state.fri.unlocked = false; render(); }
  if (act === "unlock-friday") { state.fri.unlocked = true; render(); const x = document.querySelector('[data-form="friday"] input'); if (x) x.focus(); }
  if (act === "lock-friday") { state.fri.unlocked = false; render(); }
  if (act === "clear-row") { state.openRow = null; await writeRow(row, { "Paid date": null, "Paid amount": null, "Extra paid date": null, "Extra paid amount": null, "Reason if different": null }, `Cleared the payment for ${esc(row.Bill)}`); }
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
  if (f.dataset.form === "friday") await saveFriday(new FormData(f), fridayInfo(state.fri.date));
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
  if (["month", "friday", "spending", "budget", "debts", "details"].includes(want)) state.view = want;
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
