'use client'

import React from 'react'
import { useStyletron } from 'baseui'
import {
  TableBuilder,
  TableBuilderColumn,
} from 'baseui/table-semantic'
import { colors } from '@/theme/customTheme'

interface DataTableProps<T> {
  data: T[]
  columns: {
    header: string | React.ReactNode
    id: string
    render: (row: T) => React.ReactNode
    sortable?: boolean
    width?: string
  }[]
  loading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  loading,
  emptyMessage = 'No data',
  onRowClick,
}: DataTableProps<T>) {
  const [css] = useStyletron()

  if (loading) {
    return (
      <div
        className={css({
          padding: '48px',
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: '14px',
        })}
      >
        Loading...
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div
        className={css({
          padding: '48px',
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: '14px',
        })}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      className={css({
        backgroundColor: colors.bgElevated,
        borderRadius: '12px',
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      })}
    >
      <TableBuilder
        data={data}
        overrides={{
          Root: {
            style: {
              borderTopLeftRadius: '12px',
              borderTopRightRadius: '12px',
              borderBottomLeftRadius: '12px',
              borderBottomRightRadius: '12px',
            },
          },
          Table: {
            style: {
              tableLayout: 'fixed',
              width: '100%',
            },
          },
          TableHeadCell: {
            style: {
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              color: colors.textMuted,
              backgroundColor: colors.bgSecondary,
              borderBottomColor: colors.border,
              paddingTop: '12px',
              paddingBottom: '12px',
            },
          },
          TableBodyRow: {
            style: {
              cursor: onRowClick ? 'pointer' : 'default',
              ':hover': {
                backgroundColor: onRowClick ? colors.bgSecondary : undefined,
              },
            },
          },
          TableBodyCell: {
            style: {
              fontSize: '13px',
              color: colors.textPrimary,
              borderBottomColor: colors.border,
              paddingTop: '12px',
              paddingBottom: '12px',
              verticalAlign: 'middle',
            },
          },
        }}
      >
        {columns.map((col) => (
          <TableBuilderColumn
            key={col.id}
            header={col.header}
            overrides={
              col.width
                ? {
                    TableHeadCell: { style: { width: col.width, minWidth: col.width, maxWidth: col.width, overflow: 'hidden' } },
                    TableBodyCell: { style: { width: col.width, minWidth: col.width, maxWidth: col.width, overflow: 'hidden' } },
                  }
                : undefined
            }
          >
            {(row: T) => (
              <span onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {col.render(row)}
              </span>
            )}
          </TableBuilderColumn>
        ))}
      </TableBuilder>
    </div>
  )
}
