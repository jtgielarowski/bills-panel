# bills-panel

Excel side panel (`taskpane.html` + `pane.js`) and full dashboard (`dashboard.html` + `full.js`) for the
household bills & paychecks model. Shared logic is in `core.js`.

**Workbook:** `Gielarowski Financial Model (v3).xlsx` (v2 still works). The add-in has no file path: it reads whichever
workbook is open in Excel, so open v3 and use Home ▸ Bills & Paychecks.

- **Reads:** tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks,
  tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory, tblDadSchedule.
  Blank rows are skipped.
- **Writes (input columns only, never calculated columns):** tblRegister payment inputs (Record payment); tblRegister[Statement amount] alone (Set amount — unpaid Variable bills, never marks paid, never locks);
  tblCardLog / tblCashLog (Date, PNC balance, Note); tblPaychecks[Actual amount]; tblDebts BT plan; tblOther; tblMonths[Month closed?].
- **Known amount:** `tblRegister[Amount known?]` (v3) — a Variable bill with a Statement amount. The workbook uses it for Amount, Remaining and the plan; the dashboard shows a Known badge and, past `variancePct`, the difference vs budget. Record payment pre-fills it; saving a payment never changes it unless "Also change the known amount" is ticked.
- **Variance rule:** % only — `|paid − budget| > variancePct × budget` (variancePct from tblExportMeta).
- **Paid status:** from tblRegister Status / Autopaid / Eff paid date / Eff paid amount (autopay bills count as paid on the due date).
- **Due dates and budgets:** taken from the register (which applies tblBudgetChanges); the code never recomputes them.

Code only; no data lives in this repo.
