import React, { useState } from 'react'
import { day, formatStatusLabel } from '../api.js'
import { ActionForm, ExpandableText, StatusBadge } from './UiPrimitives.jsx'

function statusTone(status) {
  if (status === 'APPROVED') return 'ok'
  if (status === 'SUBMITTED') return 'warn'
  if (status === 'REJECTED' || status === 'WITHDRAWN') return 'danger'
  return 'muted'
}

function SiteUpdateRows({ rows, busy, mutate, permissions, emptyMessage }) {
  if (!rows.length) return <p className="empty-state">{emptyMessage}</p>
  return <div className="report-table-wrap"><table className="stack-mobile">
    <thead>
      <tr>
        <th scope="col">Update</th>
        <th scope="col">Work date</th>
        <th scope="col">Hours</th>
        <th scope="col">Progress</th>
        <th scope="col">Status</th>
        <th scope="col">Details</th>
        {permissions.approveHours && <th scope="col">Decision</th>}
      </tr>
    </thead>
    <tbody>{rows.map(update => <tr key={update.id}>
      <th scope="row" className="nowrap">
        Update #{update.id}
        <div className="explanation">Alloc #{update.allocationId}</div>
      </th>
      <td data-label="Work date" className="nowrap">{day(update.workDate)}</td>
      <td data-label="Hours" className="nowrap">{update.recordedHours == null ? 'Not reported' : `${update.recordedHours} h`}</td>
      <td data-label="Progress" className="nowrap">{update.progressPercent == null ? 'Not reported' : `${update.progressPercent}%`}</td>
      <td data-label="Status">
        <StatusBadge tone={statusTone(update.status)}>
          {formatStatusLabel(update.status)}
        </StatusBadge>
      </td>
      <td data-label="Details">
        <ExpandableText text={[
          update.actualFinishDate ? `Actual finish: ${day(update.actualFinishDate)}` : '',
          update.supersedesId ? `Corrects update #${update.supersedesId}` : '',
          update.note ? `Note: ${update.note}` : '',
          update.decisionReason ? `Decision reason: ${update.decisionReason}` : ''
        ].filter(Boolean).join(' · ')} fallback="None" />
      </td>
      {permissions.approveHours && <td data-label="Decision">
        {update.canApprove && <ActionForm button="Approve" pendingLabel="Approving..." icon="check" busy={busy} onSave={async () => {
          await mutate(`/site-updates/${update.id}/approve`, 'POST', {})
          return 'Site update approved.'
        }} />}
        {update.status === 'SUBMITTED' && <details>
          <summary>Reject</summary>
          <ActionForm button="Confirm reject" pendingLabel="Rejecting..." icon="x" busy={busy} onSave={async values => {
            await mutate(`/site-updates/${update.id}/reject`, 'POST', { reason: values.get('reason').trim() })
            return 'Site update rejected.'
          }}>
            <label>Rejection reason<input name="reason" required /></label>
          </ActionForm>
        </details>}
        {update.status === 'APPROVED' && update.isCurrent && <details>
          <summary>Withdraw</summary>
          <ActionForm button="Confirm withdraw" pendingLabel="Withdrawing..." icon="x" busy={busy} onSave={async values => {
            await mutate(`/site-updates/${update.id}/withdraw`, 'POST', { reason: values.get('reason').trim() })
            return 'Site update withdrawn.'
          }}>
            <label>Withdrawal reason<input name="reason" required /></label>
          </ActionForm>
        </details>}
        {!update.canApprove && update.status === 'SUBMITTED' && <span className="explanation">Cannot approve own entry</span>}
      </td>}
    </tr>)}</tbody>
  </table></div>
}

export function SiteUpdates({ workflow, busy, mutate }) {
  const [allocationId, setAllocationId] = useState('')
  const { allocations, permissions, updates } = workflow
  if (!permissions.submitHours && !permissions.approveHours) return null

  const selected = allocations.find(row => String(row.id) === allocationId)
  const current = updates.filter(row => row.allocationId === selected?.id && row.status === 'APPROVED')
  const submitted = updates.filter(row => row.status === 'SUBMITTED')
  const currentApproved = updates.filter(row => row.status === 'APPROVED' && row.isCurrent)
  const historical = updates.filter(row => row.status !== 'SUBMITTED' && !(row.status === 'APPROVED' && row.isCurrent))

  return <section>
    <h3>Site updates</h3>
    <p className="role-banner">{permissions.submitHours && !permissions.approveHours
      ? 'Site Officer view: submit hours, progress %, or a finish date against an approved allocation. A manager must approve updates before they count in reports.'
      : 'Project Manager view: review updates submitted by site officers to approve, reject, or withdraw them.'}</p>

    <h4>Awaiting approval ({submitted.length})</h4>
    <SiteUpdateRows rows={submitted} busy={busy} mutate={mutate} permissions={permissions}
      emptyMessage="No site updates are awaiting approval." />

    <h4>Current approved entries ({currentApproved.length})</h4>
    <SiteUpdateRows rows={currentApproved} busy={busy} mutate={mutate} permissions={permissions}
      emptyMessage="No approved site updates yet." />

    {historical.length > 0 && <details className="action-panel">
      <summary>Superseded, rejected &amp; withdrawn history ({historical.length})</summary>
      <SiteUpdateRows rows={historical} busy={busy} mutate={mutate} permissions={{ ...permissions, approveHours: false }}
        emptyMessage="No historical updates." />
    </details>}

    {permissions.submitHours && (allocations.length ? <div className="allocation-form">
      <h4>Submit site update</h4>
      <label>Site allocation<select value={allocationId} onChange={event => setAllocationId(event.target.value)} disabled={busy}>
        <option value="">Choose an allocation</option>
        {allocations.map(row => <option key={row.id} value={row.id}>
          Allocation #{row.id} · {row.worker.label} · {day(row.workDate)} ({row.allocatedHours} h)
        </option>)}
      </select></label>
      {selected && <ActionForm key={selected.id} button="Submit update" pendingLabel="Submitting..." icon="send" resetOnSuccess busy={busy} onSave={async values => {
        const correction = values.get('correction')
        const pct = values.get('progressPercent')
        await mutate('/site-updates', 'POST', {
          allocationId: selected.id,
          workDate: day(selected.workDate),
          recordedHours: Number(values.get('recordedHours')),
          progressPercent: pct !== '' && pct != null ? Number(pct) : undefined,
          actualFinishDate: values.get('actualFinishDate') || undefined,
          note: values.get('note').trim() || undefined,
          supersedesId: correction ? Number(correction) : undefined
        })
        setAllocationId('')
        return 'Site hours submitted for approval.'
      }}>
        {current.length > 0 && <label>Approved entry to replace<select name="correction" required>
          <option value="">Choose an approved update</option>
          {current.map(row => <option key={row.id} value={row.id}>Update #{row.id} · {row.recordedHours} hours</option>)}
        </select></label>}
        <label>Recorded hours<input name="recordedHours" type="number" min="0" step="0.01" required /></label>
        <label>Progress % <span className="field-hint">(optional, 0 to 100)</span><input name="progressPercent" type="number" min="0" max="100" step="1" /></label>
        <label>Actual finish date <span className="field-hint">(optional)</span><input name="actualFinishDate" type="date" /></label>
        <label>Site note <span className="field-hint">(optional)</span><textarea name="note" /></label>
      </ActionForm>}
    </div> : <div className="next-step">
      <strong>No allocation yet</strong>
      <p>Awaiting a worker allocation from a project manager.</p>
    </div>)}
  </section>
}
