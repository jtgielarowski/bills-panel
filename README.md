# bills-panel

Excel side panel (`taskpane.html` + `pane.js`) and full dashboard (`dashboard.html` + `full.js`) for the
household bills & paychecks model. Shared logic is in `core.js`.

**Dashboard v4 · workbook:** `Gielarowski Financial Model (v4).xlsx`. The add-in has no file path: it reads whichever
workbook is open in Excel, so open v4 and use Home ▸ Bills & Paychecks. Files load with cache key `?v=7`.

- **Reads:** tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks,
  tblExportStory, tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory,
  tblDadSchedule, tblPlanLock. Blank rows are skipped.
- **Writes (input columns only, never calculated columns):** tblRegister payment inputs (Record payment) — only where
  `tblRegister[Record allowed]` = TRUE, or to correct a saved payment, and **never** an auto pay row
  (`tblRegister[Autopay bill]` = TRUE); tblRegister[Statement amount] alone (Set amount — unpaid Variable bills, never
  marks paid, never locks); tblCardLog / tblCashLog (Date, PNC balance, Note); tblPaychecks[Actual amount]; tblDebts BT
  plan; tblOther; tblMonths[Month closed?]; **tblPlanLock — append only** (see Auto-lock).
- **Status badges:** text = `tblRegister[Status]`, colour = `tblRegister[Badge tone]` (red / orange / yellow / blue /
  green / purple / none). The code never works out urgency from due dates.
- **Auto pay:** AUTO PAY tag, no Record payment / Set amount / Mark paid / Unlock; the model counts it paid on the draft date.
- **ESTIMATE tag:** Amount type = Variable, Amount known? = FALSE and Autopay bill = FALSE.
- **Monthly Story tab:** tblExportStory + tblExportCategory [Locked plan, Expected, Story variance] + tblRegister story
  columns. The waterfall ties to `[Bridge check]` = 0.
- **Auto-lock:** on load, the Excel panel checks the tblExportStory row with Status = "Current". If Plan locked? = FALSE
  (and no INCOME row exists for that month), it appends in one call one tblPlanLock row per tblRegister row of that month
  with Applies = TRUE (Key = RowID, Month, Type = Source, Locked amount = Plan now, Locked on = now,
  Note "Auto-locked by dashboard") and then `INCOME|yyyy-mm` (Locked amount = Income plan now). Existing rows are never
  edited or deleted.
- **Refresh:** changing month or saving anything re-reads every table.
- **Variance rule:** % only — `|paid − budget| > variancePct × budget` (variancePct from tblExportMeta).

Code only; no data lives in this repo.
