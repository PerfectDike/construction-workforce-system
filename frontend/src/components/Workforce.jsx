import React, { useEffect, useState } from 'react'
import { call, day, formatStatusLabel, validDay } from '../api.js'
import { ActionForm, ExpandableText, Icon, SkeletonLines, Spinner, StatusBadge, StatusBanner } from './UiPrimitives.jsx'

export function Workforce({ workflow, busy, mutate, token, openBaseline }) {
  const [newWorkerId, setNewWorkerId] = useState('')
  const [newWorkDate, setNewWorkDate] = useState('')
  const [newHours, setNewHours] = useState('')
  const [options, setOptions] = useState(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const [optionsRetry, setOptionsRetry] = useState(0)

  const [availWorkerId, setAvailWorkerId] = useState('')
  const [availDate, setAvailDate] = useState('')

  const { task, workers, allocations, baselines, allocationHistory = [] } = workflow
  const selectedOption = options?.workers.find(row => row.workerId === newWorkerId)
  const exceedsCapacity = selectedOption?.remainingHours != null && Number(newHours) > selectedOption.remainingHours

  const optionMessages = {
    OUTSIDE_APPROVED_DATES: 'Date is outside approved schedule',
    SKILL_MISMATCH: 'Required skill missing',
    AVAILABILITY_UNKNOWN: 'Availability not declared',
    OVER_CAPACITY: 'Existing allocations exceed hours',
    FULLY_ALLOCATED: 'No hours remain on date'
  }

  useEffect(() => {
    if (!availWorkerId && workers.length) setAvailWorkerId(workers[0].sharedId)
  }, [workers, availWorkerId])

  useEffect(() => {
    if (!validDay(newWorkDate) || !workflow.permissions.allocate) {
      setOptionsLoading(false)
      return
    }
    const controller = new AbortController()
    setOptionsLoading(true)
    setOptionsError('')
    call(`/tasks/${encodeURIComponent(task.sharedId ?? task.id)}/workforce-options?date=${encodeURIComponent(newWorkDate)}`, { token, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setOptions(result); setOptionsError('') } })
      .catch(error => { if (!controller.signal.aborted) setOptionsError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false) })
    return () => controller.abort()
  }, [newWorkDate, task.id, task.sharedId, workflow.permissions.allocate, token, optionsRetry])

  const selectSlot = (dateStr, workerId) => {
    if (dateStr !== newWorkDate) {
      setNewWorkDate(dateStr)
      setOptions(null)
      setOptionsError('')
    }
    setNewWorkerId(workerId)
    setAvailWorkerId(workerId)
    setAvailDate(dateStr)
  }

  return <section>
    <h3>Worker allocations ({allocations.length})</h3>
    {allocations.length ? <div className="report-table-wrap"><table className="stack-mobile">
      <thead><tr><th scope="col">ID</th><th scope="col">Worker</th><th scope="col">Work date</th><th scope="col">Hours</th>{workflow.permissions.allocate && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{allocations.map(row => <tr key={row.id}>
        <th scope="row" className="nowrap">Allocation #{row.id}</th>
        <td data-label="Worker">{row.worker.label} ({row.worker.sharedId})</td>
        <td data-label="Work date" className="nowrap">{day(row.workDate)}</td>
        <td data-label="Hours" className="nowrap">{row.allocatedHours} h</td>
        {workflow.permissions.allocate && <td data-label="Actions">
          <details>
            <summary>Edit or cancel</summary>
            <ActionForm button="Save change" icon="check" busy={busy} onSave={async values => {
              await mutate(`/allocations/${row.id}`, 'PATCH', {
                workerId: values.get('workerId'), workDate: values.get('workDate'),
                hours: Number(values.get('hours')), reason: values.get('reason').trim()
              })
              return 'Allocation change saved.'
            }}>
              <label>Worker<select name="workerId" defaultValue={row.worker.sharedId} required>
                {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
              </select></label>
              <label>Work date<input name="workDate" type="date" defaultValue={day(row.workDate)} required /></label>
              <label>Hours<input name="hours" type="number" min="0.01" step="0.01" defaultValue={row.allocatedHours} required /></label>
              <label>Reason for allocation change<input name="reason" required /></label>
            </ActionForm>
            <ActionForm button="Cancel allocation" icon="x" busy={busy} onSave={async values => {
              await mutate(`/allocations/${row.id}/cancel`, 'POST', { reason: values.get('reason').trim() })
              return 'Allocation cancelled.'
            }}>
              <label>Cancellation reason<input name="reason" required /></label>
            </ActionForm>
          </details>
        </td>}
      </tr>)}</tbody>
    </table></div> : <p className="empty-state">No workers allocated to this activity yet.</p>}

    {workflow.permissions.allocate && allocationHistory.length > 0 && <details className="action-panel">
      <summary>Allocation history ({allocationHistory.length})</summary>
      <div className="report-table-wrap"><table className="stack-mobile">
        <thead><tr><th scope="col">ID</th><th scope="col">Worker</th><th scope="col">Date &amp; hours</th><th scope="col">Status</th><th scope="col">Audit detail</th></tr></thead>
        <tbody>{allocationHistory.map(row => <tr key={row.id}>
          <th scope="row" className="nowrap">Allocation #{row.id}</th>
          <td data-label="Worker">{row.worker.label} ({row.worker.sharedId})</td>
          <td data-label="Date & hours" className="nowrap">{day(row.workDate)} · {row.allocatedHours} h</td>
          <td data-label="Status"><StatusBadge tone={row.status === 'APPROVED' ? 'ok' : row.status === 'CANCELLED' ? 'danger' : 'muted'}>{formatStatusLabel(row.status)}</StatusBadge></td>
          <td data-label="Audit detail">
            <ExpandableText text={[
              row.replacesId ? `Replaces #${row.replacesId}` : '',
              row.reason ? `Reason: ${row.reason}` : '',
              ...(row.events || []).map(event => `${event.action} by ${event.actor.loginLabel}${event.reason ? ` (${event.reason})` : ''}`)
            ].filter(Boolean).join(' · ')} fallback="Initial approval" />
          </td>
        </tr>)}</tbody>
      </table></div>
    </details>}

    {workflow.permissions.allocate && baselines.length > 0 && workers.length > 0 && <div className="allocation-form">
      <h4>New allocation</h4>
      <p><strong>Required skills:</strong> {task.skillNames?.join(', ') || 'None'} · <strong>Approved window:</strong> {day(baselines[0].taskSnapshot?.startDate) || 'Not included'} to {day(baselines[0].taskSnapshot?.finishDate) || 'Not included'}.</p>
      <div className="worker-dates">
        <strong>Worker skills and declared availability dates</strong>
        <p className="explanation">Click a declared date below to load eligibility and remaining cross-project hours.</p>
        <ul>{workers.map(worker => <li key={worker.sharedId} className="worker-date-row">
          <div className="worker-meta">
            <strong>{worker.label} ({worker.sharedId})</strong> · {worker.skills?.join(', ') || 'No skills'} · Cap {worker.dailyCapacityHours ?? 8}h/day
          </div>
          <div className="worker-pills">
            {worker.availability?.length ? worker.availability.map(slot => {
              const d = day(slot.workDate)
              const active = newWorkDate === d && newWorkerId === worker.sharedId
              return <button key={d} type="button" className={`date-pill${active ? ' is-selected' : ''}`} aria-pressed={active} onClick={() => selectSlot(d, worker.sharedId)}>
                <Icon name="calendar" />{d} ({slot.availableHours}h)
              </button>
            }) : <span className="explanation">No dates declared yet</span>}
          </div>
        </li>)}</ul>
      </div>

      <ActionForm button="Allocate worker" icon="userPlus" busy={busy} submitDisabled={!selectedOption?.eligible || exceedsCapacity}
        onSave={async values => {
          await mutate('/allocations', 'POST', {
            workerId: values.get('workerId'),
            taskId: task.sharedId ?? task.id,
            workDate: values.get('workDate'),
            hours: Number(values.get('hours'))
          })
          setNewWorkerId('')
          setNewWorkDate('')
          setNewHours('')
          setOptions(null)
          return 'Worker allocated.'
        }}>
        <label>Allocation date<input name="workDate" type="date" value={newWorkDate}
          min={day(baselines[0].taskSnapshot?.startDate) || undefined}
          max={day(baselines[0].taskSnapshot?.finishDate) || undefined}
          onChange={event => {
            const nextDate = event.target.value
            if (nextDate !== newWorkDate) {
              setNewWorkDate(nextDate)
              setOptions(null)
              setOptionsError('')
            }
          }} required /></label>
        {newWorkDate && <div className="allocation-check">
          <div aria-live="polite" className="explanation">
            {optionsLoading && !optionsError && <div className="inline-loading"><Spinner /><span>Checking worker skills and availability for {newWorkDate}...</span></div>}
            {!optionsLoading && options && <span>Eligibility checked for {newWorkDate}: {options.workers.filter(w => w.eligible).length} eligible worker(s).</span>}
          </div>
          {optionsLoading && !optionsError && <SkeletonLines count={2} label="Checking worker availability" />}
          {optionsError && <StatusBanner kind="error" message={optionsError} actionLabel="Retry" onAction={() => setOptionsRetry(n => n + 1)} />}
          {options && !optionsLoading && <div className="report-table-wrap"><table className="stack-mobile">
            <thead><tr><th scope="col">Worker</th><th scope="col">Available</th><th scope="col">Allocated</th><th scope="col">Remaining</th><th scope="col">Status</th><th scope="col">Select</th></tr></thead>
            <tbody>{options.workers.map(row => {
              const isSelected = newWorkerId === row.workerId
              return <tr key={row.workerId} className={isSelected ? 'row-selected' : undefined}>
                <th scope="row">{row.label} ({row.workerId})</th>
                <td data-label="Available" className="nowrap">{row.availableHours == null ? 'Not declared' : `${row.availableHours} h`}</td>
                <td data-label="Allocated" className="nowrap">{row.committedHours} h</td>
                <td data-label="Remaining" className="nowrap">{row.remainingHours == null ? '0 h' : `${row.remainingHours} h`}</td>
                <td data-label="Status">
                  {row.eligible
                    ? <StatusBadge tone="ok">Eligible</StatusBadge>
                    : <StatusBadge tone="warn">{row.flags.map(flag => optionMessages[flag] || flag).join('; ')}</StatusBadge>}
                </td>
                <td data-label="Select">
                  <button type="button" disabled={!row.eligible} aria-pressed={isSelected} onClick={() => setNewWorkerId(row.workerId)}>
                    {isSelected && <Icon name="check" />}{isSelected ? 'Selected' : 'Choose'}
                  </button>
                </td>
              </tr>
            })}</tbody>
          </table></div>}
          {selectedOption && exceedsCapacity && <StatusBanner kind="error" message={`Requested hours (${newHours} h) exceed ${selectedOption.label}'s ${selectedOption.remainingHours} h remaining on ${newWorkDate}.`} />}
        </div>}
        <label>Worker<select name="workerId" value={newWorkerId} onChange={event => setNewWorkerId(event.target.value)} required>
          <option value="">Choose a worker</option>
          {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
        </select></label>
        <label>Allocation hours<input name="hours" type="number" min="0.01" step="0.01" value={newHours}
          onChange={event => setNewHours(event.target.value)} required /></label>
      </ActionForm>
      {(!selectedOption?.eligible || exceedsCapacity) && <p className="explanation">Select an eligible worker, approved date, and hours within remaining capacity.</p>}
      <p className="explanation">Cross-project capacity is re-checked on save.</p>
    </div>}

    {workflow.permissions.allocate && !baselines.length && <div className="next-step">
      <strong>Approved baseline required</strong>
      <p>Approve a project baseline before allocating workers to this activity.</p>
      {openBaseline && <button type="button" onClick={openBaseline}><Icon name="arrowRight" />Go to Approve schedule</button>}
    </div>}

    {workflow.permissions.allocate && <details className="action-panel">
      <summary>Update worker availability</summary>
      <p>Declare how many hours a worker can work on a date (capped by their daily capacity; undeclared dates cannot be allocated).</p>
      <ActionForm button="Save availability" icon="calendar" busy={busy} onSave={async values => {
        const result = await mutate(`/projects/${encodeURIComponent(task.project.sharedId ?? task.project.id)}/workers/${values.get('workerId')}/availability/${values.get('workDate')}`, 'PATCH', {
          availableHours: Number(values.get('availableHours')),
          reason: values.get('reason').trim()
        })
        return result.affected
          ? `${result.allocatedHours} allocated hours now exceed ${result.capacityHours} available hours. Review ${result.impactedAllocations.length} allocation(s).`
          : 'Availability change saved. No allocation is over capacity.'
      }}>
        <label>Worker<select name="workerId" value={availWorkerId} onChange={event => setAvailWorkerId(event.target.value)} required>
          {workers.map(worker => <option key={worker.sharedId} value={worker.sharedId}>{worker.label} ({worker.sharedId})</option>)}
        </select></label>
        <label>Availability date<input name="workDate" type="date" value={availDate} onChange={event => setAvailDate(event.target.value)} required /></label>
        <label>Available hours <span className="field-hint">(0 to 24 hours)</span><input name="availableHours" type="number" min="0" max="24" step="0.01" required /></label>
        <label>Reason for change<input name="reason" required /></label>
      </ActionForm>
    </details>}
  </section>
}
