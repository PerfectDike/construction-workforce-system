# Report measures

Project reports use an approved baseline selected by version. The default is the latest approved version. The report date is a calendar date in `YYYY-MM-DD` form; the hours period must end on or before it.

| Measure | Rule | Source |
| --- | --- | --- |
| Baseline finish | Finish date in the selected approved baseline. A task absent from that snapshot is labelled **new**. | `BaselineTask.finishDate` |
| Task status | **Finished** when a current approved update on or before the report date has an actual finish; **unfinished** when a current approved update records progress without an actual finish; otherwise **not reported**. | `SiteUpdate.status`, `isCurrent`, `workDate`, `actualFinishDate`, `progressPercent` |
| Overdue | An unfinished task whose selected baseline finish is before the report date. | Task status, baseline finish, report date |
| Finish variance | Actual finish minus selected baseline finish in calendar days. Positive means later, negative earlier. No value is shown for an unfinished task or a task absent from the baseline. | Current approved actual finish and `BaselineTask.finishDate` |
| Planned hours | Sum of approved allocation hours whose work dates fall in the selected period. Revised, cancelled and superseded allocations are excluded. | `Allocation.status`, `workDate`, `allocatedHours` |
| Recorded hours | Sum of current approved site-update hours whose work dates fall in the period. A submitted, rejected, withdrawn or superseded update is excluded. A recorded zero is shown as **0**; no qualifying update is shown as **not reported**. | `SiteUpdate.status`, `isCurrent`, `workDate`, `recordedHours` |

Every task row carries the selected baseline task, qualifying allocation records and current approved update records with their IDs. These IDs let a reader trace the result through the API and the source-record section in the screen.

The report shows current approved information as of the chosen work date. It does not reconstruct an earlier approval state after a correction or withdrawal. Planned and recorded hours have different meanings; their difference is not an individual worker productivity measure.
