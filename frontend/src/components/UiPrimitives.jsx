import React, { Component, useId, useState } from 'react'

export function Icon({ name }) {
  const paths = {
    check: <polyline points="20 6 9 17 4 12" />,
    x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
    refresh: <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
    prev: <polyline points="15 18 9 12 15 6" />,
    next: <polyline points="9 18 15 12 9 6" />,
    list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    arrowRight: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
    alertCircle: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    checkCircle: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>
  }
  if (!paths[name]) return null
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function Spinner({ size = 15 }) {
  return <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" opacity=".22" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
}

export function BrandMark() {
  return <svg className="brand-logo" width="34" height="34" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinejoin="miter" strokeMiterlimit="4" strokeLinecap="butt" aria-hidden="true">
    <polyline points="19,26.5 19,16.5 31,8.5 43,16.5 43,30.5" />
    <line x1="31" y1="9.5" x2="31" y2="54" />
    <polyline points="13,54 13,31 24.5,22.5 24.5,54" />
    <line x1="13" y1="39.5" x2="24.5" y2="31" />
    <line x1="13" y1="47.5" x2="24.5" y2="39" />
    <line x1="16.5" y1="54" x2="24.5" y2="48" />
    <polyline points="37.5,54 37.5,26.5 50,35.5 50,54" />
    <line x1="7" y1="54" x2="57" y2="54" strokeWidth="4" />
  </svg>
}

export function StatusBadge({ tone = 'muted', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function ExpandableText({ text, limit = 110, fallback = '' }) {
  const [expanded, setExpanded] = useState(false)
  const raw = text == null ? '' : String(text).trim()
  if (!raw) return fallback ? <span className="explanation">{fallback}</span> : null
  if (raw.length <= limit) return <span className="cell-wrap">{raw}</span>
  return <span className="cell-wrap">
    {expanded ? raw : `${raw.slice(0, limit).trimEnd()}...`}{' '}
    <button type="button" className="text-button inline-toggle" onClick={() => setExpanded(v => !v)}>
      {expanded ? 'Less' : 'More'}
    </button>
  </span>
}

export function usePagination(items, defaultPageSize = 25) {
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / defaultPageSize))
  const safePage = Math.min(page, totalPages)
  const visible = showAll ? items : items.slice((safePage - 1) * defaultPageSize, safePage * defaultPageSize)
  const start = total === 0 ? 0 : showAll ? 1 : (safePage - 1) * defaultPageSize + 1
  const end = showAll ? total : Math.min(total, safePage * defaultPageSize)
  return {
    visible, page: safePage, totalPages, total, start, end, showAll, defaultPageSize,
    setPage, toggleShowAll: () => { setShowAll(v => !v); setPage(1) }
  }
}

export function PaginationBar({ pager, label = 'items' }) {
  if (pager.total <= pager.defaultPageSize && !pager.showAll) return null
  return <div className="pagination-bar" role="navigation" aria-label={`Pagination for ${label}`}>
    <span className="explanation">Showing {pager.start} to {pager.end} of {pager.total} {label}</span>
    <div className="pagination-actions">
      {!pager.showAll && <>
        <button type="button" disabled={pager.page <= 1} onClick={() => pager.setPage(p => Math.max(1, p - 1))}><Icon name="prev" />Previous</button>
        <span className="page-indicator">Page {pager.page} / {pager.totalPages}</span>
        <button type="button" disabled={pager.page >= pager.totalPages} onClick={() => pager.setPage(p => Math.min(pager.totalPages, p + 1))}>Next<Icon name="next" /></button>
      </>}
      <button type="button" className="text-button" onClick={pager.toggleShowAll}>
        {pager.showAll ? `Show ${pager.defaultPageSize} per page` : `Show all (${pager.total})`}
      </button>
    </div>
  </div>
}

export function StatusBanner({ kind = 'info', message, actionLabel, onAction, onDismiss }) {
  if (!message) return null
  const iconName = kind === 'error' ? 'alertCircle' : kind === 'success' ? 'checkCircle' : 'info'
  return <div className={`status-banner status-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <Icon name={iconName} />
    <p className="status-banner-text">{message}</p>
    {(onAction || onDismiss) && <div className="status-banner-actions">
      {onAction && <button type="button" onClick={onAction}><Icon name="refresh" />{actionLabel || 'Retry'}</button>}
      {onDismiss && <button type="button" className="status-dismiss" onClick={onDismiss} aria-label="Dismiss message"><Icon name="x" /></button>}
    </div>}
  </div>
}

export function SkeletonLines({ count = 3, label = 'Loading...' }) {
  return <div className="skeleton-stack" role="status" aria-busy="true" aria-label={label}>
    {Array.from({ length: count }, (_, idx) => (
      <span key={idx} className={`skeleton skeleton-line${idx === count - 1 ? ' is-short' : idx % 2 ? ' is-mid' : ''}`} />
    ))}
  </div>
}

export function TableSkeleton({ rows = 4, cols = 5, label = 'Loading table...' }) {
  return <div className="skeleton-table" role="status" aria-busy="true" aria-label={label} style={{ '--cols': cols }}>
    {Array.from({ length: rows }, (_, rowIdx) => (
      <div key={rowIdx} className="skeleton-row">
        {Array.from({ length: cols }, (_, colIdx) => (
          <span key={colIdx} className={`skeleton${colIdx === 0 ? ' is-short' : ''}`} />
        ))}
      </div>
    ))}
  </div>
}

export function ReportSkeleton({ mode = 'reports' }) {
  return <div className="skeleton-stack" role="status" aria-busy="true" aria-label="Loading project report">
    <span className="skeleton skeleton-title" />
    <div className="metric-grid">
      {Array.from({ length: 7 }, (_, idx) => (
        <div key={idx} className="skeleton-card">
          <span className="skeleton skeleton-line is-mid" />
          <span className="skeleton skeleton-value" />
        </div>
      ))}
    </div>
    {mode === 'overview'
      ? <SkeletonLines count={4} label="Loading overview attention lists" />
      : <TableSkeleton rows={4} cols={6} label="Loading report rows" />}
  </div>
}

export function TaskSkeleton() {
  return <section aria-busy="true" role="status" aria-label="Loading activity">
    <span className="skeleton skeleton-title" />
    <SkeletonLines count={3} label="Loading activity details" />
    <TableSkeleton rows={3} cols={4} label="Loading activity records" />
  </section>
}

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return <div className="error-boundary-card" role="alert">
        <p className="eyebrow">Application error</p>
        <h2>Something went wrong</h2>
        <p>{this.state.error.message || 'An unexpected rendering error occurred.'}</p>
        <button type="button" onClick={() => window.location.reload()}><Icon name="refresh" />Reload workspace</button>
      </div>
    }
    return this.props.children
  }
}

export function ActionForm({ children, button, pendingLabel, icon, busy, submitDisabled, resetOnSuccess = false, onSave, validate, onConflict, onChange }) {
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (pending || busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setError('')
    setMessage('')
    const errors = validate?.(values) || {}
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    setPending(true)
    try {
      const result = await onSave(values)
      if (resetOnSuccess) form.reset()
      setMessage(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return <form onSubmit={submit} onChange={event => {
    if (error) setError('')
    if (message) setMessage('')
    onChange?.(event)
  }}>
    <fieldset disabled={pending || busy}>
      {typeof children === 'function' ? children(fieldErrors) : children}
      <button type="submit" disabled={submitDisabled || pending || busy} aria-busy={pending}>
        {pending ? <Spinner /> : icon && <Icon name={icon} />}
        {pending ? (pendingLabel || `${button}...`) : button}
      </button>
    </fieldset>
    {message && <StatusBanner kind="success" message={message} onDismiss={() => setMessage('')} />}
    {error && <StatusBanner kind="error" message={error}
      actionLabel={onConflict && /allocation/i.test(error) ? 'Open workforce' : undefined}
      onAction={onConflict && /allocation/i.test(error) ? onConflict : undefined}
      onDismiss={() => setError('')} />}
  </form>
}

export const FieldError = ({ id, message }) => message ? <small id={id} className="field-error">{message}</small> : null

export function PasswordInput({ label, hint, name, autoComplete, minLength, required }) {
  const [visible, setVisible] = useState(false)
  const inputId = useId()
  return <div className="field-group">
    <label htmlFor={inputId} className="field-label">
      {label}
      {hint && <span className="field-hint"> ({hint})</span>}
    </label>
    <div className="password-field">
      <input id={inputId} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required={required} />
      <button type="button" className="eye-toggle" onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </div>
  </div>
}
