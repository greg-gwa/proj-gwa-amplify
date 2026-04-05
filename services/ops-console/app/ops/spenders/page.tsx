'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { useRouter } from 'next/navigation'
import { Input, SIZE as INPUT_SIZE } from 'baseui/input'
import { Select, SIZE } from 'baseui/select'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatNumber } from '@/lib/format'

interface Spender {
  id: string
  name: string
  spender_type: string
  agency: string
  party: string
  district: string
  fec_id: string
  status: string
  total_buys: number
  total_spend: number
  created_at: string
}

const typeOptions = [
  { id: '', label: 'All Types' },
  { id: 'candidate', label: 'Candidate' },
  { id: 'pac', label: 'PAC' },
  { id: 'super_pac', label: 'Super PAC' },
  { id: 'party', label: 'Party' },
  { id: 'issue', label: 'Issue' },
]

const statusOptions = [
  { id: '', label: 'All Statuses' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'inactive', label: 'Inactive' },
]

export default function SpendersPage() {
  const [css] = useStyletron()
  const router = useRouter()
  const [spenders, setSpenders] = useState<Spender[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Array<{ id: string }>>([])
  const [statusFilter, setStatusFilter] = useState<Array<{ id: string }>>([])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const type = typeFilter[0]?.id
    if (type) params.set('type', type)
    const status = statusFilter[0]?.id
    if (status) params.set('status', status)
    fetch(`/api/spenders?${params}`)
      .then((r) => r.json())
      .then((data) => setSpenders(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, typeFilter, statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const columns = [
    {
      header: 'Name',
      id: 'name',
      render: (row: Spender) => (
        <span className={css({ fontWeight: 500, color: colors.primary, ':hover': { textDecoration: 'underline' } })}>{row.name}</span>
      ),
    },
    {
      header: 'Type',
      id: 'type',
      render: (row: Spender) => (
        <span className={css({ textTransform: 'capitalize' as const })}>
          {row.spender_type?.replace(/_/g, ' ') || '—'}
        </span>
      ),
      width: '110px',
    },
    {
      header: 'Agency',
      id: 'agency',
      render: (row: Spender) => row.agency || '—',
    },
    {
      header: 'Party',
      id: 'party',
      render: (row: Spender) => {
        if (!row.party) return '—'
        const partyColor = row.party === 'D' ? '#2563eb' : row.party === 'R' ? '#dc2626' : colors.textMuted
        return <span className={css({ color: partyColor, fontWeight: 600 })}>{row.party}</span>
      },
      width: '60px',
    },
    {
      header: 'District',
      id: 'district',
      render: (row: Spender) => row.district || '—',
      width: '90px',
    },
    {
      header: 'FEC ID',
      id: 'fec_id',
      render: (row: Spender) => (
        <span className={css({ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' })}>
          {row.fec_id || '—'}
        </span>
      ),
      width: '120px',
    },
    {
      header: 'Buys',
      id: 'buys',
      render: (row: Spender) => formatNumber(row.total_buys),
      width: '70px',
    },
    {
      header: 'Total Spend',
      id: 'spend',
      render: (row: Spender) => (
        <span className={css({ fontWeight: 600 })}>{formatCurrency(row.total_spend)}</span>
      ),
      width: '120px',
    },
    {
      header: 'Status',
      id: 'status',
      render: (row: Spender) => <StatusTag status={row.status} />,
      width: '110px',
    },
  ]

  return (
    <div>
      <PageHeader title="Spenders" subtitle="Master spender directory" />

      <div className={css({ display: 'flex', gap: '12px', marginBottom: '16px' })}>
        <div className={css({ width: '280px' })}>
          <Input
            value={search}
            onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search spenders..."
            size={INPUT_SIZE.compact}
            clearable
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
          />
        </div>
        <div className={css({ width: '180px' })}>
          <Select
            options={typeOptions}
            value={typeFilter}
            placeholder="Type"
            onChange={({ value }) => setTypeFilter(value as Array<{ id: string }>)}
            clearable
            size={SIZE.compact}
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
          />
        </div>
        <div className={css({ width: '180px' })}>
          <Select
            options={statusOptions}
            value={statusFilter}
            placeholder="Status"
            onChange={({ value }) => setStatusFilter(value as Array<{ id: string }>)}
            clearable
            size={SIZE.compact}
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
          />
        </div>
      </div>

      <DataTable
        data={spenders}
        columns={columns}
        loading={loading}
        emptyMessage="No spenders found"
        onRowClick={(row) => router.push(`/ops/spenders/${encodeURIComponent(row.name)}`)}
      />
    </div>
  )
}
