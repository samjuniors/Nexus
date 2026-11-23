'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  FileDiff,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { SelfHealSession, SelfHealStatus } from '@/lib/agent/self-heal'
import { cn } from '@/lib/utils'

function statusMeta(status: SelfHealStatus): {
  label: string
  className: string
  icon: typeof CheckCircle2
  spinning?: boolean
} {
  switch (status) {
    case 'diagnosing':
      return {
        label: 'Diagnosing',
        className: 'text-sky-600 dark:text-sky-400',
        icon: Loader2,
        spinning: true,
      }
    case 'patching':
      return {
        label: 'Patching',
        className: 'text-violet-600 dark:text-violet-400',
        icon: Loader2,
        spinning: true,
      }
    case 'verifying':
      return {
        label: 'Verifying',
        className: 'text-amber-600 dark:text-amber-400',
        icon: Loader2,
        spinning: true,
      }
    case 'verified':
      return {
        label: 'Verified',
        className: 'text-emerald-600 dark:text-emerald-400',
        icon: CheckCircle2,
      }
    case 'rolled_back':
      return {
        label: 'Rolled Back',
        className: 'text-amber-600 dark:text-amber-400',
        icon: RotateCcw,
      }
    case 'failed':
      return {
        label: 'Failed',
        className: 'text-red-600 dark:text-red-400',
        icon: XCircle,
      }
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ''
  }
}

function UnifiedDiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <pre className="nice-scroll max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++')
        const isDel = line.startsWith('-') && !line.startsWith('---')
        const isHunk = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')
        return (
          <div
            key={i}
            className={cn(
              'whitespace-pre px-1.5',
              isAdd && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
              isDel && 'bg-red-500/12 text-red-700 dark:text-red-300',
              isHunk && 'text-sky-600 dark:text-sky-400'
            )}
          >
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function SessionDetail({
  session,
  busy,
  onRollback,
}: {
  session: SelfHealSession
  busy: boolean
  onRollback: (id: string) => void
}) {
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({})
  const meta = statusMeta(session.status)
  const StatusIcon = meta.icon

  return (
    <div className="space-y-4">
      {/* Session Header */}
      <div className="rounded-lg border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', meta.className, meta.spinning && 'animate-spin')} />
              <span className={cn('font-medium', meta.className)}>{meta.label}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{session.trigger}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {formatTime(session.updatedAt)}
              </span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-foreground">{session.title}</h3>
            {session.summary && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{session.summary}</p>
            )}
          </div>

          {session.canRollback && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onRollback(session.id)}
              data-self-heal-rollback="1"
              className="h-8 gap-1.5 border-amber-500/35 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Rollback Snapshot</span>
            </Button>
          )}
        </div>

        {session.errorContext && (
          <div className="mt-2.5 rounded-md border border-border/80 bg-muted/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground break-words">
            {session.errorContext}
          </div>
        )}

        {(session.brainContext || session.capabilityUpgrade || (session.attemptsUsed ?? 0) > 1) && (
          <div className="mt-2.5 space-y-2 border-t border-border/70 pt-2.5">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {session.brainContext && (
                <span className="inline-flex items-center gap-1.5 text-foreground/90">
                  <Brain className="h-3.5 w-3.5 text-sky-500" />
                  <span>
                    Portable Brain: {session.brainContext.recalledCount} recalled
                    {session.brainContext.coreLoaded ? ' · core active' : ''}
                  </span>
                </span>
              )}
              {(session.attemptsUsed ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 font-mono text-[10.5px] tabular-nums">
                  <Cpu className="h-3 w-3 text-muted-foreground" />
                  <span>
                    {session.attemptsUsed} {session.attemptsUsed === 1 ? 'pass' : 'self-corrected passes'}
                  </span>
                </span>
              )}
            </div>

            {session.brainContext?.learnedLesson && (
              <div className="rounded-md border border-sky-500/25 bg-sky-500/6 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/90">
                <span className="font-semibold text-sky-600 dark:text-sky-400">Saved to Portable Brain: </span>
                <span>{session.brainContext.learnedLesson}</span>
              </div>
            )}

            {session.capabilityUpgrade && (
              <div className="rounded-md border border-emerald-500/25 bg-emerald-500/6 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/90">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {session.capabilityUpgrade.applied ? 'Skill Added: ' : 'Capability Note: '}
                </span>
                <span className="font-medium">{session.capabilityUpgrade.name}</span>
                <span className="text-muted-foreground"> — {session.capabilityUpgrade.description}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Execution Steps Timeline */}
      {session.steps.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Repair Timeline</span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {session.steps.length} {session.steps.length === 1 ? 'step' : 'steps'}
            </span>
          </div>
          <ol className="space-y-2">
            {session.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground w-16">
                  {step.phase}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{step.label}</div>
                  {step.detail && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground break-words">
                      {step.detail}
                    </div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {formatTime(step.timestamp)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Patched Files & Unified Diffs */}
      {session.patches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <FileDiff className="h-3.5 w-3.5 text-sky-500" />
              <span>Code Patches</span>
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {session.patches.length} {session.patches.length === 1 ? 'file' : 'files'}
            </span>
          </div>
          {session.patches.map((patch, idx) => {
            const key = `${patch.path}-${idx}`
            const open = expandedDiffs[key] ?? true
            return (
              <div key={key} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setExpandedDiffs((prev) => ({ ...prev, [key]: !open }))}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <Code2 className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                    <span className="truncate font-mono text-[11.5px] font-medium text-foreground">
                      {patch.path}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">+{patch.addedLines}</span>
                    <span className="text-red-600 dark:text-red-400">-{patch.removedLines}</span>
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border p-2.5">
                    {patch.summary && (
                      <p className="mb-2 text-[11px] text-muted-foreground">{patch.summary}</p>
                    )}
                    <UnifiedDiffViewer diff={patch.diff} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Build Verification Output */}
      {session.verification && (
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Build Verification</span>
            </span>
            <span
              className={cn(
                'flex items-center gap-1 font-mono text-[10.5px] tabular-nums',
                session.verification.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {session.verification.ok ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              <span>
                {session.verification.ok ? 'Passed' : 'Failed'} · {session.verification.durationMs}ms
              </span>
            </span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            {session.verification.command}
          </div>
          {session.verification.output && (
            <pre className="nice-scroll mt-2 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/90">
              {session.verification.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Live Self-Heal Studio split panel.
 * Displays Eva's autonomous code repair sessions, unified diffs, TypeScript build verification,
 * one-time `self_code_edit` permission status, manual diagnosis prompt, and instant snapshot rollback.
 */
export function SelfHealPanel() {
  const sessions = useEvaControl((s) => s.selfHealSessions)
  const activeId = useEvaControl((s) => s.activeSelfHealId)
  const busy = useEvaControl((s) => s.selfHealBusy)
  const verifyResult = useEvaControl((s) => s.selfHealVerifyResult)
  const errorText = useEvaControl((s) => s.selfHealError)
  const grants = useEvaControl((s) => s.grants)
  const selectSession = useEvaControl((s) => s.selectSelfHealSession)
  const refreshSessions = useEvaControl((s) => s.refreshSelfHealSessions)
  const runBuildVerify = useEvaControl((s) => s.runBuildVerify)
  const triggerAutoHeal = useEvaControl((s) => s.triggerAutoHeal)
  const rollbackSelfHeal = useEvaControl((s) => s.rollbackSelfHeal)
  const updateGrantPolicy = useEvaControl((s) => s.updateGrantPolicy)
  const openSplit = useEvaControl((s) => s.openSplit)

  const [prompt, setPrompt] = useState('')
  const [fileHint, setFileHint] = useState('')

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const codeGrant = grants.find((g) => g.capability === 'self_code_edit')
  const policy = codeGrant?.policy ?? 'ask'

  const activeSession =
    sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null

  const handleDiagnoseSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = prompt.trim()
    if (!clean || busy) return
    const res = await triggerAutoHeal({
      trigger: 'user_request',
      errorMessage: clean,
      targetFileHint: fileHint.trim() || undefined,
    })
    if (res.ok) {
      setPrompt('')
      setFileHint('')
    }
  }

  const handleScanAndFixBuild = async () => {
    if (busy) return
    const verify = await runBuildVerify()
    if (verify && !verify.ok) {
      await triggerAutoHeal({
        trigger: 'user_request',
        errorMessage: 'Fix all TypeScript compiler errors reported by tsc --noEmit',
        stack: verify.output,
      })
    }
  }

  return (
    <div
      data-self-heal-panel="1"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      {/* Top Studio Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-sky-500" />
            <h2 className="text-sm font-semibold tracking-tight">Self-Heal Studio</h2>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Own-code edit permission:</span>
            <button
              type="button"
              onClick={() =>
                void updateGrantPolicy('self_code_edit', policy === 'always' ? 'ask' : 'always')
              }
              title="Toggle one-time Always Allow permission for Eva self-code repair"
              className={cn(
                'inline-flex items-center gap-1 font-mono text-[10.5px] font-medium underline-offset-2 hover:underline',
                policy === 'always'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : policy === 'deny'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              <span>
                {policy === 'always' ? 'Allow Always' : policy === 'deny' ? 'Denied' : 'Ask Once'}
              </span>
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => openSplit('permissions', 'Permissions Vault')}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Vault
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void handleScanAndFixBuild()}
            data-self-heal-scan-fix="1"
            className="h-8 gap-1.5 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-sky-500" />}
            <span>Scan &amp; Fix</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void runBuildVerify()}
            data-self-heal-verify="1"
            className="h-8 gap-1.5 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            <span>Verify Build</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void refreshSessions()}
            aria-label="Refresh self-heal sessions"
            className="h-8 w-8 p-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Autonomous Diagnosis & Self-Fix Bar */}
      <form
        onSubmit={(e) => void handleDiagnoseSubmit(e)}
        className="shrink-0 space-y-2 border-b border-border bg-card/50 px-4 py-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a bug, runtime error, or capability upgrade for Eva to patch…"
            aria-label="Describe bug or upgrade for Eva to patch"
            disabled={busy}
            className="h-8 flex-1 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || prompt.trim().length < 3}
            data-self-heal-run="1"
            className="h-8 shrink-0 gap-1.5 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Auto-Heal with Eva</span>
          </Button>
        </div>
        <Input
          value={fileHint}
          onChange={(e) => setFileHint(e.target.value)}
          placeholder="Optional target file hint (e.g. src/components/agent/gbrain-graph.tsx)"
          aria-label="Optional target file path hint"
          disabled={busy}
          className="h-7 font-mono text-[11px]"
        />
      </form>

      {/* Live Feedback & Standalone Build Verification Result */}
      <div className="nice-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {errorText && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed break-words">{errorText}</span>
            </div>
            {/permission|denied|timed out/i.test(errorText) && policy !== 'always' && (
              <div className="flex items-center gap-2 pl-5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void updateGrantPolicy('self_code_edit', 'always')}
                  className="h-7 gap-1.5 border-amber-500/40 text-[11px]"
                >
                  <ShieldCheck className="h-3 w-3" />
                  <span>Enable Allow Always &amp; Retry</span>
                </Button>
              </div>
            )}
          </div>
        )}

        {verifyResult && (
          <div
            data-self-heal-verify-result={verifyResult.ok ? 'pass' : 'fail'}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                {verifyResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                )}
                <span>TypeScript Check {verifyResult.ok ? 'Passed' : 'Failed'}</span>
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {verifyResult.durationMs}ms · {formatTime(verifyResult.checkedAt)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {verifyResult.command}
            </div>
            {verifyResult.output && (
              <pre className="nice-scroll mt-2 max-h-36 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/90">
                {verifyResult.output}
              </pre>
            )}
          </div>
        )}

        {/* Session Switcher Strip */}
        {sessions.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Repair Sessions</span>
              <span className="font-mono tabular-nums">{sessions.length}</span>
            </div>
            <div className="space-y-1">
              {sessions.slice(0, 8).map((s) => {
                const m = statusMeta(s.status)
                const Icon = m.icon
                const isSelected = activeSession?.id === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSession(s.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      isSelected
                        ? 'border-sky-500/40 bg-sky-500/8 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', m.className, m.spinning && 'animate-spin')} />
                      <span className="truncate font-medium text-foreground">{s.title}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {s.patches.length}f · {formatTime(s.updatedAt)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {activeSession ? (
          <SessionDetail
            session={activeSession}
            busy={busy}
            onRollback={(id) => void rollbackSelfHeal(id)}
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-5 text-center">
            <Wrench className="mx-auto h-5 w-5 text-muted-foreground/70" />
            <h3 className="mt-2 text-xs font-semibold text-foreground">
              Autonomous Self-Healing Ready
            </h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Describe any bug or feature gap above, or ask Eva by voice or chat. Every own-code patch
              creates an automatic snapshot backup, runs TypeScript verification, and rolls back automatically
              if verification fails.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
