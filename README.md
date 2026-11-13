# bills-panel

Excel side panel (`taskpane.html` + `pane.js`) and full dashboard (`dashboard.html` + `full.js`) for the
household bills & paychecks model. Shared logic is in `core.js`.

**Dashboard v4.2 · workbook:** `Gielarowski Financial Model (v6).xlsx` (v4/v5 still load; they just have no saved payday
plans). The add-in has no file path: it reads whichever workbook is open in Excel, so open v6 and use Home ▸ Bills &
Paychecks. Files load with cache key `?v=20261113-2`
(bump it in `dashboard.html` and `taskpane.html` on every release so browsers fetch the new files).

- **Reads:** tblExportMeta, tblExportPlan, tblExportCardPlan, tblExportHistory, tblExportCategory, tblExportChecks,
  tblExportStory, tblRegister, tblDebts, tblCardLog, tblCashLog, tblOther, tblPaychecks, tblMonths, tblDadHistory,
  tblDadSchedule, tblPlanLock, tblPaydayPlan (optional). Blank rows are skipped.
- **Writes (input columns only, never calculated columns):** tblRegister payment inputs (Record payment) — only where
  `tblRegister[Record allowed]` = TRUE, or to correct a saved payment, and **never** an auto pay row
  (`tblRegister[Autopay bill]` = TRUE); tblRegister[Statement amount] alone (Set amount — unpaid Variable bills, never
  marks paid, never locks); tblCardLog / tblCashLog (Date, PNC balance, Note); tblPaychecks[Actual amount]; tblDebts BT
  plan; tblOther; tblMonths[Month closed?]; **tblPlanLock** and **tblPaydayPlan — append only**.
- **Payday plan snapshot (tblPaydayPlan, append only):** when a payday's PNC balance is saved, the Excel panel adds that
  payday's plan in one call — `START` (tblCashLog[Expected balance] − [Paychecks since]), `PAYCHECK` ([Paychecks since]) and
  one row per tblRegister row with Payday amount > 0 (Key = RowID). Never edited or deleted; skipped if a non-auto-pay
  payment is already dated on/after the payday. The card's Plan column reads it; the note lists the deviations.
- **Payment gate:** Record payment / Mark paid are refused until the PNC balance is saved for the latest payday on or before
  the payment date. The workbook has the same rule as data validation on This Month[Paid date] / [Extra paid date].
- **Paycheck plan Actual column:** tblExportPlan[Actual start] / [Actual paid] / [Actual cash after], read by name; blank
  (future paydays) shows "—"; once a payday drops out of tblExportPlan, the next Friday's tblCashLog row supplies it. A
  tblCashLog PNC entry dated that payday already includes the paycheck → Paycheck shows "incl.".
- **Colours:** one shared palette in `app.css` (`--pal-*`), copied from the workbook's This Month sheet; used by every view
  and the panel.
- **Status badges:** text = `tblRegister[Status]`, colour = `tblRegister[Badge tone]` (red / orange / yellow / blue /
  green / purple / none); the Status text splits red (OVERDUE → late) and yellow (Needs Paid → needs paid, else 6–10 days).
  The code never works out urgency from due dates.
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
