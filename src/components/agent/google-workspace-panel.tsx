'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import {
  getGoogleWorkspaceToken,
  getGoogleWorkspaceUser,
  initGoogleWorkspaceAuth,
  signInGoogleWorkspace,
  signOutGoogleWorkspace,
  type GoogleWorkspaceUserProfile,
} from '@/lib/platform/google-workspace-auth'
import { cn } from '@/lib/utils'

interface GmailMessageItem {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  snippet: string
}

interface DriveFileItem {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  webViewLink?: string
}

interface CalendarEventItem {
  id: string
  summary?: string
  description?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

type PendingMutation =
  | { kind: 'gmail_send'; to: string; subject: string; body: string }
  | { kind: 'docs_create'; title: string; content: string }
  | { kind: 'calendar_create'; summary: string; startIso: string; endIso: string; description: string }

/** Official Google "G" emblem required by Google Sign-In branding guidelines. */
function GoogleBrandMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
      />
    </svg>
  )
}

/**
 * Real Google Workspace panel connecting Gmail, Drive, Docs, and Calendar
 * via client-side Firebase Google OAuth with mandatory confirmation modals before mutations.
 */
export function GoogleWorkspacePanel() {
  const [user, setUser] = useState<GoogleWorkspaceUserProfile | null>(() => getGoogleWorkspaceUser())
  const [accessToken, setAccessToken] = useState<string | null>(() => getGoogleWorkspaceToken())
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const [tab, setTab] = useState<'gmail' | 'drive' | 'calendar'>('gmail')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  // Gmail state
  const [gmailQuery, setGmailQuery] = useState('')
  const [messages, setMessages] = useState<GmailMessageItem[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
  const [mailTo, setMailTo] = useState('')
  const [mailSubject, setMailSubject] = useState('')
  const [mailBody, setMailBody] = useState('')

  // Drive & Docs state
  const [driveQuery, setDriveQuery] = useState('')
  const [files, setFiles] = useState<DriveFileItem[]>([])
  const [summarizingId, setSummarizingId] = useState<string | null>(null)
  const [summaryMap, setSummaryMap] = useState<Record<string, string>>({})
  const [docFormOpen, setDocFormOpen] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')

  // Calendar state
  const [events, setEvents] = useState<CalendarEventItem[]>([])
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eventStartTime, setEventStartTime] = useState('10:00')
  const [eventEndTime, setEventEndTime] = useState('10:30')
  const [eventDesc, setEventDesc] = useState('')

  // Explicit Confirmation Modal for all mutating Workspace API calls
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null)
  const [executingMutation, setExecutingMutation] = useState(false)

  useEffect(() => {
    const unsubscribe = initGoogleWorkspaceAuth(
      (profile, token) => {
        setUser(profile)
        setAccessToken(token)
        setAuthError(null)
      },
      () => {
        setAccessToken(null)
        setUser(getGoogleWorkspaceUser())
      }
    )
    return unsubscribe
  }, [])

  const callWorkspaceApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const token = accessToken || getGoogleWorkspaceToken()
      if (!token) {
        setAccessToken(null)
        throw new Error('Please sign in with Google to access Workspace.')
      }
      const res = await fetch('/api/google-workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (res.status === 401 || data.needsAuth) {
        setAccessToken(null)
        throw new Error('Your Google session expired. Sign in with Google again to continue.')
      }
      if (!res.ok || data.error) {
        throw new Error(String(data.error || 'Google Workspace request failed'))
      }
      return data
    },
    [accessToken]
  )

  const loadActiveTab = useCallback(
    async (targetTab: 'gmail' | 'drive' | 'calendar') => {
      if (!accessToken) return
      setLoading(true)
      setErrorMsg(null)
      try {
        if (targetTab === 'gmail') {
          const data = await callWorkspaceApi({ action: 'gmail_list', query: gmailQuery, maxResults: 10 })
          setMessages(Array.isArray(data.messages) ? (data.messages as GmailMessageItem[]) : [])
        } else if (targetTab === 'drive') {
          const data = await callWorkspaceApi({ action: 'drive_list', query: driveQuery, pageSize: 12 })
          setFiles(Array.isArray(data.files) ? (data.files as DriveFileItem[]) : [])
        } else {
          const data = await callWorkspaceApi({ action: 'calendar_list', maxResults: 12 })
          setEvents(Array.isArray(data.events) ? (data.events as CalendarEventItem[]) : [])
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [accessToken, callWorkspaceApi, driveQuery, gmailQuery]
  )

  useEffect(() => {
    if (accessToken) {
      void loadActiveTab(tab)
    }
  }, [accessToken, tab, loadActiveTab])

  const handleSignIn = async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const { profile, accessToken: token } = await signInGoogleWorkspace()
      setUser(profile)
      setAccessToken(token)
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Google Sign-In failed')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    setAuthBusy(true)
    try {
      await signOutGoogleWorkspace()
      setUser(null)
      setAccessToken(null)
      setMessages([])
      setFiles([])
      setEvents([])
      setSummaryMap({})
      setStatusNotice(null)
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSummarizeFile = async (file: DriveFileItem) => {
    setSummarizingId(file.id)
    setErrorMsg(null)
    try {
      const data = await callWorkspaceApi({
        action: 'drive_summarize',
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
      })
      setSummaryMap((prev) => ({ ...prev, [file.id]: String(data.summary || 'No summary returned.') }))
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSummarizingId(null)
    }
  }

  const handleConfirmMutation = async () => {
    if (!pendingMutation) return
    setExecutingMutation(true)
    setErrorMsg(null)
    setStatusNotice(null)
    try {
      if (pendingMutation.kind === 'gmail_send') {
        await callWorkspaceApi({
          action: 'gmail_send',
          to: pendingMutation.to,
          subject: pendingMutation.subject,
          body: pendingMutation.body,
        })
        setStatusNotice(`Email sent to ${pendingMutation.to}`)
        setComposeOpen(false)
        setMailTo('')
        setMailSubject('')
        setMailBody('')
        void loadActiveTab('gmail')
      } else if (pendingMutation.kind === 'docs_create') {
        const res = await callWorkspaceApi({
          action: 'docs_create',
          title: pendingMutation.title,
          content: pendingMutation.content,
        })
        setStatusNotice(
          res.url ? `Created Google Doc "${pendingMutation.title}"` : `Created Google Doc`
        )
        setDocFormOpen(false)
        setDocTitle('')
        setDocContent('')
        void loadActiveTab('drive')
      } else if (pendingMutation.kind === 'calendar_create') {
        await callWorkspaceApi({
          action: 'calendar_create',
          summary: pendingMutation.summary,
          startIso: pendingMutation.startIso,
          endIso: pendingMutation.endIso,
          description: pendingMutation.description,
        })
        setStatusNotice(`Scheduled "${pendingMutation.summary}" on Google Calendar`)
        setEventFormOpen(false)
        setEventTitle('')
        setEventDesc('')
        void loadActiveTab('calendar')
      }
      setPendingMutation(null)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPendingMutation(null)
    } finally {
      setExecutingMutation(false)
    }
  }

  return (
    <div
      data-google-workspace-panel="1"
      className="nice-scroll relative flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 pb-28"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Google Workspace</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Direct Gmail, Google Drive, Docs, and Calendar access. Every email, document creation, or event requires your explicit confirmation.
          </p>
        </div>
        {accessToken && user && (
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void handleSignOut()}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-3 w-3" />
            Sign Out
          </button>
        )}
      </div>

      {/* Sign-in gate when unauthenticated */}
      {!accessToken ? (
        <div className="my-auto flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
            <GoogleBrandMark />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            Connect Google Workspace
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Sign in with your Google account to read &amp; compose Gmail threads, summarize Drive documents, create Google Docs, and schedule Calendar events. Tokens stay strictly in memory.
          </p>
          {authError && (
            <div className="mt-3 max-w-sm rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {authError}
            </div>
          )}
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void handleSignIn()}
            className="mt-5 inline-flex h-10 items-center gap-3 rounded-md border border-[#747775] bg-white px-4 text-sm font-medium text-[#1F1F1F] shadow-xs transition-colors hover:bg-[#F8F9FA] disabled:opacity-50 dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1F1F21]"
          >
            {authBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleBrandMark />
            )}
            <span>Sign in with Google</span>
          </button>
        </div>
      ) : (
        <>
          {/* Connected account strip & tabs */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border bg-card/40">
              {(
                [
                  { id: 'gmail', label: 'Gmail', icon: Mail },
                  { id: 'drive', label: 'Drive & Docs', icon: FolderOpen },
                  { id: 'calendar', label: 'Calendar', icon: Calendar },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === id
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className="truncate max-w-44">{user?.email || 'Connected'}</span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadActiveTab(tab)}
                aria-label="Refresh Google Workspace"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-3 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMsg}
            </div>
          )}

          {statusNotice && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <span>{statusNotice}</span>
              <button type="button" onClick={() => setStatusNotice(null)} aria-label="Dismiss notice">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* GMAIL TAB */}
          {tab === 'gmail' && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void loadActiveTab('gmail')
                  }}
                  className="relative flex min-w-40 flex-1 items-center"
                >
                  <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={gmailQuery}
                    onChange={(e) => setGmailQuery(e.target.value)}
                    placeholder="Search Gmail threads (e.g. from:alex invoice)…"
                    className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 text-xs text-foreground outline-none focus:border-primary/50"
                  />
                </form>
                <button
                  type="button"
                  onClick={() => setComposeOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Send className="h-3.5 w-3.5" />
                  Compose
                </button>
              </div>

              {composeOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!mailTo.trim() || !mailSubject.trim()) return
                    setPendingMutation({
                      kind: 'gmail_send',
                      to: mailTo.trim(),
                      subject: mailSubject.trim(),
                      body: mailBody.trim(),
                    })
                  }}
                  className="space-y-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  <div className="text-xs font-semibold text-foreground">Compose Email</div>
                  <input
                    type="email"
                    required
                    value={mailTo}
                    onChange={(e) => setMailTo(e.target.value)}
                    placeholder="Recipient email"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <input
                    type="text"
                    required
                    value={mailSubject}
                    onChange={(e) => setMailSubject(e.target.value)}
                    placeholder="Subject"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <textarea
                    rows={4}
                    value={mailBody}
                    onChange={(e) => setMailBody(e.target.value)}
                    placeholder="Write message body…"
                    className="w-full rounded-md border border-border bg-background p-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setComposeOpen(false)}
                      className="h-7 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary hover:bg-primary/25"
                    >
                      Review &amp; Send
                    </button>
                  </div>
                </form>
              )}

              {loading && messages.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Gmail threads…
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No matching Gmail messages found.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
                  {messages.map((m) => (
                    <div key={m.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate text-xs font-semibold text-foreground">{m.subject}</div>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {m.date ? m.date.slice(0, 16) : ''}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                        {m.from}
                      </div>
                      {m.snippet && (
                        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                          {m.snippet}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DRIVE & DOCS TAB */}
          {tab === 'drive' && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void loadActiveTab('drive')
                  }}
                  className="relative flex min-w-40 flex-1 items-center"
                >
                  <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={driveQuery}
                    onChange={(e) => setDriveQuery(e.target.value)}
                    placeholder="Filter Google Drive files by name…"
                    className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-8 text-xs text-foreground outline-none focus:border-primary/50"
                  />
                </form>
                <button
                  type="button"
                  onClick={() => setDocFormOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  New Google Doc
                </button>
              </div>

              {docFormOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!docTitle.trim()) return
                    setPendingMutation({
                      kind: 'docs_create',
                      title: docTitle.trim(),
                      content: docContent.trim(),
                    })
                  }}
                  className="space-y-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  <div className="text-xs font-semibold text-foreground">Create Google Doc</div>
                  <input
                    type="text"
                    required
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="Document title"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <textarea
                    rows={4}
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    placeholder="Initial document content…"
                    className="w-full rounded-md border border-border bg-background p-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDocFormOpen(false)}
                      className="h-7 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary hover:bg-primary/25"
                    >
                      Review &amp; Create
                    </button>
                  </div>
                </form>
              )}

              {loading && files.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Drive files…
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No Google Drive files found.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
                  {files.map((f) => (
                    <div key={f.id} className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                            <span className="truncate">{f.name}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {f.mimeType.replace('application/vnd.google-apps.', 'Google ')}
                            {f.modifiedTime && ` · updated ${new Date(f.modifiedTime).toLocaleDateString()}`}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={summarizingId === f.id}
                            onClick={() => void handleSummarizeFile(f)}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {summarizingId === f.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3 text-sky-500" />
                            )}
                            Summarize
                          </button>
                          {f.webViewLink && (
                            <a
                              href={f.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${f.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      {summaryMap[f.id] && (
                        <div className="rounded-md border border-border bg-background p-2.5 text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
                          {summaryMap[f.id]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CALENDAR TAB */}
          {tab === 'calendar' && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Upcoming Primary Calendar
                </span>
                <button
                  type="button"
                  onClick={() => setEventFormOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Schedule Event
                </button>
              </div>

              {eventFormOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!eventTitle.trim()) return
                    const startIso = new Date(`${eventDate}T${eventStartTime}:00`).toISOString()
                    const endIso = new Date(`${eventDate}T${eventEndTime}:00`).toISOString()
                    setPendingMutation({
                      kind: 'calendar_create',
                      summary: eventTitle.trim(),
                      startIso,
                      endIso,
                      description: eventDesc.trim(),
                    })
                  }}
                  className="space-y-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  <div className="text-xs font-semibold text-foreground">Schedule Calendar Event</div>
                  <input
                    type="text"
                    required
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="Event title"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="date"
                      required
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
                    />
                    <input
                      type="time"
                      required
                      value={eventStartTime}
                      onChange={(e) => setEventStartTime(e.target.value)}
                      className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
                    />
                    <input
                      type="time"
                      required
                      value={eventEndTime}
                      onChange={(e) => setEventEndTime(e.target.value)}
                      className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={eventDesc}
                    onChange={(e) => setEventDesc(e.target.value)}
                    placeholder="Notes or agenda (optional)"
                    className="w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-primary/50"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEventFormOpen(false)}
                      className="h-7 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary hover:bg-primary/25"
                    >
                      Review &amp; Schedule
                    </button>
                  </div>
                </form>
              )}

              {loading && events.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Calendar events…
                </div>
              ) : events.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No upcoming events scheduled on your primary calendar.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
                  {events.map((ev) => {
                    const start = ev.start?.dateTime || ev.start?.date || ''
                    return (
                      <div key={ev.id} className="flex items-start justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-foreground">
                            {ev.summary || '(Untitled event)'}
                          </div>
                          <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                            {start ? new Date(start).toLocaleString() : 'TBD'}
                          </div>
                          {ev.description && (
                            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                              {ev.description}
                            </p>
                          )}
                        </div>
                        {ev.htmlLink && (
                          <a
                            href={ev.htmlLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open in Google Calendar"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Mandatory Explicit Confirmation Modal before any mutating Workspace action */}
      {pendingMutation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Google Workspace Action"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-popover p-4 shadow-xl">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {pendingMutation.kind === 'gmail_send'
                    ? 'Confirm Sending Email'
                    : pendingMutation.kind === 'docs_create'
                      ? 'Confirm Creating Google Doc'
                      : 'Confirm Scheduling Calendar Event'}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Review these exact details before Eva writes to your Google Workspace account.
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-background p-3 text-xs">
              {pendingMutation.kind === 'gmail_send' && (
                <>
                  <div>
                    <span className="font-mono text-muted-foreground">To: </span>
                    <span className="font-medium text-foreground">{pendingMutation.to}</span>
                  </div>
                  <div>
                    <span className="font-mono text-muted-foreground">Subject: </span>
                    <span className="font-medium text-foreground">{pendingMutation.subject}</span>
                  </div>
                  <div className="mt-1.5 max-h-32 overflow-y-auto border-t border-border pt-1.5 whitespace-pre-wrap text-muted-foreground">
                    {pendingMutation.body || '(Empty message body)'}
                  </div>
                </>
              )}
              {pendingMutation.kind === 'docs_create' && (
                <>
                  <div>
                    <span className="font-mono text-muted-foreground">Title: </span>
                    <span className="font-medium text-foreground">{pendingMutation.title}</span>
                  </div>
                  <div className="mt-1.5 max-h-32 overflow-y-auto border-t border-border pt-1.5 whitespace-pre-wrap text-muted-foreground">
                    {pendingMutation.content || '(Blank document)'}
                  </div>
                </>
              )}
              {pendingMutation.kind === 'calendar_create' && (
                <>
                  <div>
                    <span className="font-mono text-muted-foreground">Event: </span>
                    <span className="font-medium text-foreground">{pendingMutation.summary}</span>
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {new Date(pendingMutation.startIso).toLocaleString()} →{' '}
                    {new Date(pendingMutation.endIso).toLocaleTimeString()}
                  </div>
                  {pendingMutation.description && (
                    <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
                      {pendingMutation.description}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={executingMutation}
                onClick={() => setPendingMutation(null)}
                className="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={executingMutation}
                onClick={() => void handleConfirmMutation()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-300"
              >
                {executingMutation && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm &amp; Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
