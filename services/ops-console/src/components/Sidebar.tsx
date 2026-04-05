'use client'

import React from 'react'
import { useStyletron } from 'baseui'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { colors } from '@/theme/customTheme'

interface NavItem {
  label: string
  href: string
  icon: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: 'Station Buys',
    items: [
      { label: 'Dashboard', href: '/ops', icon: '◈' },
      { label: 'Buys', href: '/ops/buys', icon: '▤' },
      { label: 'Spenders', href: '/ops/spenders', icon: '◉' },
      { label: 'Review Queue', href: '/ops/review', icon: '⚑' },
    ],
  },
  {
    title: 'Creative Monitoring',
    items: [
      { label: 'Watchlist', href: '/ops/watchlist', icon: '👁' },
      { label: 'Clips', href: '/ops/clips', icon: '▶' },
    ],
  },
  {
    title: 'FCC Scanner',
    items: [
      { label: 'Radar', href: '/ops/radar', icon: '◎' },
      { label: 'Scanner', href: '/ops/scanner', icon: '📡' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'Intelligence', href: '/ops/ask', icon: '💡' },
    ],
  },
]

export function Sidebar() {
  const [css] = useStyletron()
  const pathname = usePathname()

  return (
    <nav
      className={css({
        width: '240px',
        minWidth: '240px',
        height: '100vh',
        backgroundColor: colors.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      })}
    >
      {/* Branding */}
      <div
        className={css({
          padding: '24px 20px',
          borderBottom: `1px solid ${colors.sidebarHover}`,
        })}
      >
        <div
          className={css({
            fontSize: '20px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
          })}
        >
          Amplify
        </div>
        <div
          className={css({
            fontSize: '12px',
            color: colors.sidebarTextMuted,
            marginTop: '4px',
          })}
        >
          Ops Console
        </div>
      </div>

      {/* Navigation */}
      <div className={css({ padding: '12px 8px', flex: 1 })}>
        {navSections.map((section, idx) => (
          <div key={section.title} className={css({ marginBottom: '8px' })}>
            <div
              className={css({
                fontSize: '11px',
                fontWeight: 600,
                color: colors.sidebarTextMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '8px 12px 4px',
                marginTop: idx === 0 ? '0px' : '8px',
              })}
            >
              {section.title}
            </div>
            {section.items.map((item) => {
              const isActive = item.href === '/ops'
                ? pathname === '/ops'
                : pathname.startsWith(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#ffffff' : colors.sidebarText,
                    backgroundColor: isActive ? colors.sidebarActive : 'transparent',
                    textDecoration: 'none',
                    marginBottom: '2px',
                    transition: 'all 150ms ease',
                    ':hover': {
                      backgroundColor: isActive ? colors.sidebarActive : colors.sidebarHover,
                      color: '#ffffff',
                    },
                  })}
                >
                  <span className={css({ fontSize: '16px', width: '20px', textAlign: 'center' })}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className={css({
          padding: '16px 20px',
          borderTop: `1px solid ${colors.sidebarHover}`,
          fontSize: '12px',
          color: colors.sidebarTextMuted,
        })}
      >
        Amplify v0.1
      </div>
    </nav>
  )
}
