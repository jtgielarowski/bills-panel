# bills-panel

Excel side panel (`taskpane.html` + `pane.js`) and full dashboard (`dashboard.html` + `full.js`) for the
household bills & paychecks model. Shared logic is in `core.js`.

**Workbook:** `Gielarowski Financial Model (v2).xlsx`. The add-in has no file path: it reads whichever
workbook is open in Excel, so open v2 and use Home ▸ Bills & Paychecks.

- **Reads:** tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks,
  tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory, tblDadSchedule.
  Blank rows are skipped.
- **Writes (input columns only, never calculated columns):** tblRegister payment inputs and Statement amount;
  tblCardLog / tblCashLog (Date, PNC balance, Note); tblPaychecks[Actual amount]; tblDebts BT plan; tblOther; tblMonths[Month closed?].
- **Variance rule:** % only — `|paid − budget| > variancePct × budget` (variancePct from tblExportMeta).
- **Paid status:** from tblRegister Status / Autopaid / Eff paid date / Eff paid amount (autopay bills count as paid on the due date).
- **Due dates and budgets:** taken from the register (which applies tblBudgetChanges); the code never recomputes them.

Code only; no data lives in this repo.
