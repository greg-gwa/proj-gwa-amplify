'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { Input } from 'baseui/input'
import { Button } from 'baseui/button'
import { Spinner } from 'baseui/spinner'
import { PageHeader } from '@/components/PageHeader'
import { colors } from '@/theme/customTheme'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function parseMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Table detection: line with pipes
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(<MarkdownTable key={`table-${i}`} lines={tableLines} />)
      continue
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} style={{ height: '8px' }} />)
      i++
      continue
    }

    // Bullet list
    if (/^[\s]*[-*]\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^[\s]*[-*]\s/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: '4px 0', paddingLeft: '20px' }}>
          {listItems.map((item, j) => (
            <li key={j} style={{ marginBottom: '2px' }}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <pre
          key={`code-${i}`}
          style={{
            background: 'rgba(0,0,0,0.15)',
            borderRadius: '6px',
            padding: '12px',
            overflowX: 'auto',
            fontSize: '13px',
            fontFamily: 'JetBrains Mono, "Fira Code", Monaco, Consolas, monospace',
            margin: '8px 0',
            lineHeight: 1.5,
          }}
        >
          {codeLines.join('\n')}
        </pre>
      )
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} style={{ margin: '4px 0', lineHeight: 1.6 }}>
        <InlineMarkdown text={line} />
      </p>
    )
    i++
  }

  return elements
}

function InlineMarkdown({ text }: { text: string }) {
  // Parse inline: **bold**, `code`
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // Bold
      parts.push(<strong key={key++}>{match[2]}</strong>)
    } else if (match[3]) {
      // Inline code
      parts.push(
        <code
          key={key++}
          style={{
            background: 'rgba(0,0,0,0.15)',
            borderRadius: '3px',
            padding: '1px 5px',
            fontSize: '0.9em',
            fontFamily: 'JetBrains Mono, "Fira Code", Monaco, Consolas, monospace',
          }}
        >
          {match[3]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())

  // Filter out separator rows (---|---|---)
  const dataLines = lines.filter((l) => !/^[\s|:-]+$/.test(l.replace(/\|/g, '').replace(/[\s:-]/g, '')) === false ? false : !/^\|[\s:-]+\|$/.test(l))
  const headerLine = lines[0]
  const bodyLines = lines.filter((_, idx) => idx > 0 && !/^[\s]*\|[\s:-]+\|[\s]*$/.test(lines[idx]))

  if (!headerLine) return null

  const headers = parseRow(headerLine)

  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: '13px',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderBottom: `2px solid ${colors.border}`,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  color: colors.textPrimary,
                  backgroundColor: colors.bgSecondary,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyLines.map((line, ri) => {
            const cells = parseRow(line)
            return (
              <tr key={ri}>
                {cells.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: '6px 12px',
                      borderBottom: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AskPage() {
  const [css] = useStyletron()
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('amplify-ask-messages')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // Full Anthropic conversation history (includes tool use turns) for context continuity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [history, setHistory] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('amplify-ask-history')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Persist to sessionStorage on change
  useEffect(() => {
    sessionStorage.setItem('amplify-ask-messages', JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    sessionStorage.setItem('amplify-ask-history', JSON.stringify(history))
  }, [history])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: text, history }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${data.error}` }])
      } else {
        setMessages([...newMessages, { role: 'assistant', content: data.response }])
        if (data.history) setHistory(data.history)
      }
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Failed to reach the server. Please try again.' }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearConversation = () => {
    setMessages([])
    setHistory([])
    setInput('')
    sessionStorage.removeItem('amplify-ask-messages')
    sessionStorage.removeItem('amplify-ask-history')
    inputRef.current?.focus()
  }

  return (
    <div
      className={css({
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 48px)',
        marginLeft: '-32px',
        marginRight: '-32px',
        marginTop: '-24px',
        marginBottom: '-24px',
        paddingTop: '24px',
        paddingLeft: '32px',
        paddingRight: '32px',
      })}
    >
      <PageHeader
        title="Intelligence"
        subtitle="Ask questions about political ad spending"
        actions={
          messages.length > 0 ? (
            <Button
              onClick={clearConversation}
              kind="secondary"
              size="compact"
              overrides={{
                BaseButton: {
                  style: {
                    fontSize: '13px',
                  },
                },
              }}
            >
              Clear
            </Button>
          ) : undefined
        }
      />

      {/* Messages area */}
      <div
        className={css({
          flex: 1,
          overflowY: 'auto',
          paddingBottom: '16px',
        })}
      >
        {messages.length === 0 && !loading && (
          <div
            className={css({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: colors.textMuted,
              gap: '12px',
            })}
          >
            <div className={css({ fontSize: '40px' })}>💡</div>
            <div className={css({ fontSize: '16px', fontWeight: 500 })}>
              Ask anything about ad spending
            </div>
            <div className={css({ fontSize: '13px', maxWidth: '420px', textAlign: 'center', lineHeight: 1.6 })}>
              Try: &quot;Who are the top spenders this month?&quot; or &quot;Show me all buys in the Atlanta market&quot;
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={css({
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: '12px',
            })}
          >
            <div
              className={css({
                maxWidth: msg.role === 'user' ? '70%' : '85%',
                padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                backgroundColor: msg.role === 'user' ? colors.primary : colors.bgElevated,
                color: msg.role === 'user' ? '#ffffff' : colors.textPrimary,
                fontSize: '14px',
                lineHeight: 1.6,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              })}
            >
              {msg.role === 'assistant' ? parseMarkdown(msg.content) : msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div
            className={css({
              display: 'flex',
              justifyContent: 'flex-start',
              marginBottom: '12px',
            })}
          >
            <div
              className={css({
                padding: '12px 16px',
                borderRadius: '16px 16px 16px 4px',
                backgroundColor: colors.bgElevated,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: colors.textMuted,
                fontSize: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              })}
            >
              <Spinner $size={16} />
              Analyzing...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        className={css({
          borderTop: `1px solid ${colors.border}`,
          padding: '16px 0',
          display: 'flex',
          gap: '8px',
        })}
      >
        <div className={css({ flex: 1 })}>
          <Input
            inputRef={inputRef}
            value={input}
            onChange={(e) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about ad spending, spenders, markets..."
            disabled={loading}
            overrides={{
              Root: {
                style: {
                  borderTopLeftRadius: '12px',
                  borderTopRightRadius: '12px',
                  borderBottomLeftRadius: '12px',
                  borderBottomRightRadius: '12px',
                },
              },
              Input: {
                style: {
                  fontSize: '14px',
                },
              },
            }}
          />
        </div>
        <Button
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          overrides={{
            BaseButton: {
              style: {
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px',
                borderBottomLeftRadius: '12px',
                borderBottomRightRadius: '12px',
                paddingLeft: '20px',
                paddingRight: '20px',
              },
            },
          }}
        >
          Send
        </Button>
      </div>
    </div>
  )
}
