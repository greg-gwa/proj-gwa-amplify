export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  // Date-only strings (YYYY-MM-DD) are parsed as UTC by JS.
  // Append T12:00:00 to avoid timezone shift rendering the wrong day.
  const raw = String(value)
  const d = raw.length === 10 ? new Date(raw + 'T12:00:00') : new Date(raw)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '0'
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '0%'
  return `${Math.round(value * 100)}%`
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—'
  const now = Date.now()
  const then = new Date(value).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(value)
}
