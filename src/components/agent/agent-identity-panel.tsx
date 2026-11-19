'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Inbox,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { useEvaControl, type AgentInboxDetailDTO } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

/**
 * Eva Autonomous Email & Inbox Identity panel.
 * Gives Eva her own persistent working Mail.tm email inbox so she can register,
 * verify accounts, and read incoming OTP codes or confirmation links autonomously.
 */
export function AgentIdentityPanel() {
  const identity = useEvaControl((s) => s.agentIdentity)
  const inbox = useEvaControl((s) => s.agentInbox)
  const busy = useEvaControl((s) => s.identityBusy)
  const error = useEvaControl((s) => s.identityError)
  const coucouOutfit = useEvaControl((s) => s.coucouOutfit)
  const refreshIdentity = useEvaControl((s) => s.refreshIdentity)
  const provisionIdentity = useEvaControl((s) => s.provisionIdentity)
  const readIdentityMessage = useEvaControl((s) => s.readIdentityMessage)
  const openSplit = useEvaControl((s) => s.openSplit)
  const browserAction = useEvaControl((s) => s.browserAction)

  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentInboxDetailDTO | null>(null)
  const [loadingMsg, setLoadingMsg] = useState(false)

  useEffect(() => {
    void refreshIdentity()
  }, [refreshIdentity])

  const copyText = (val: string, key: string) => {
    try {
      void navigator.clipboard.writeText(val)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  const handleOpenMessage = async (id: string) => {
    setSelectedId(id)
    setLoadingMsg(true)
    const d = await readIdentityMessage(id)
    setDetail(d)
    setLoadingMsg(false)
  }

  const handleOpenLinkInBrowser = (url: string) => {
    openSplit('browser', 'Live Browser')
    void browserAction({ action: 'navigate', url })
  }

  return (
    <div data-agent-identity-panel="1" className="flex h-full min-h-0 flex-col bg-background">
      {/* Identity Header Card */}
      <div className="border-b border-border bg-card/50 p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background/80">
            <CoucouBot
              state={busy ? 'thinking' : identity ? 'finished' : 'idle'}
              outfit={coucouOutfit}
              bodyColor="#EEF2FF"
              size={44}
              interactive
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {identity?.displayName || 'Eva Autonomous Identity'}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Persistent inbox for autonomous sign-ups, OTPs &amp; verification links
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshIdentity()}
                aria-label="Refresh Eva inbox"
                title="Refresh inbox"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
              </button>
            </div>

            {identity ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span data-eva-email-address="1" className="truncate select-all">
                    {identity.address}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(identity.address, 'addr')}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
                >
                  {copiedKey === 'addr' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === 'addr' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(null)
                    setDetail(null)
                    void provisionIdentity({ forceNew: true })
                  }}
                  title="Generate a fresh new autonomous email address"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
            ) : (
              <div className="mt-2.5">
                <button
                  type="button"
                  disabled={busy}
                  data-provision-eva-email="1"
                  onClick={() => void provisionIdentity()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-500/15 px-3 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Provision Eva Email Automatically
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Inbox + Message Detail Stage */}
      <div className="nice-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="terminal-label text-[10px] tracking-wider text-muted-foreground">
            LIVE INBOX ({inbox.length})
          </span>
          {identity && (
            <span className="font-mono text-[10px] text-muted-foreground">
              provider: {identity.provider}
            </span>
          )}
        </div>

        {inbox.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center">
            <Inbox className="h-6 w-6 text-muted-foreground/70" />
            <p className="mt-2.5 text-xs font-medium text-foreground">
              {identity ? 'Inbox is ready and waiting' : 'No autonomous email provisioned yet'}
            </p>
            <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
              {identity
                ? `Send any email or verification code to ${identity.address}. Eva automatically extracts 4–8 digit OTP codes and confirmation links.`
                : 'Provision a free Mail.tm inbox in one click so Eva can verify accounts and complete web workflows on her own.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {inbox.map((m) => {
              const active = selectedId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void handleOpenMessage(m.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    active
                      ? 'border-sky-400/40 bg-sky-500/10'
                      : 'border-border bg-card/50 hover:bg-accent/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{m.subject}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-muted-foreground">{m.from}</div>
                  {m.intro && <p className="line-clamp-1 text-[11px] text-muted-foreground/80">{m.intro}</p>}
                </button>
              )
            })}
          </div>
        )}

        {/* Selected Message Reader */}
        {loadingMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
            Reading email &amp; extracting verification codes…
          </div>
        )}

        {!loadingMsg && detail && (
          <div className="mt-3 rounded-lg border border-border bg-card/70 p-3">
            <div className="border-b border-border pb-2">
              <div className="text-xs font-semibold text-foreground">{detail.subject}</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{detail.from}</div>
            </div>

            {detail.codes.length > 0 && (
              <div className="mt-2.5">
                <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                  <KeyRound className="h-3 w-3" /> Detected Verification Codes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.codes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => copyText(code, `code-${code}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/12 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <span>{code}</span>
                      {copiedKey === `code-${code}` ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {detail.links.length > 0 && (
              <div className="mt-2.5">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-sky-400">
                  Action Links
                </div>
                <div className="space-y-1">
                  {detail.links.slice(0, 4).map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => handleOpenLinkInBrowser(url)}
                      className="flex w-full items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-left font-mono text-[10.5px] text-sky-300 hover:border-sky-400/50 hover:bg-accent"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{url}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background/70 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
              {detail.text || '(empty body)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
