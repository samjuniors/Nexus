'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Bot, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEvaControl } from '@/lib/agent/eva-control-store'

interface ViewErrorBoundaryProps {
  viewName: string
  resetKey?: string
  onReturnHome?: () => void
  children: ReactNode
}

interface ViewErrorBoundaryState {
  error: Error | null
}

/**
 * Isolates rendering and lifecycle failures inside an individual workspace view
 * so the surrounding application shell (sidebar, navigation, and other views)
 * remains functional and recoverable, with instant dispatch to Eva's Self-Heal Studio.
 */
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(prevProps: ViewErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[${this.props.viewName}] View render error:`, error, info.componentStack)
    }
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  private handleAutoHeal = () => {
    if (!this.state.error) return
    const message = this.state.error.message?.trim() || `Render crash in ${this.props.viewName}`
    void useEvaControl.getState().triggerAutoHeal({
      trigger: 'error_boundary',
      errorMessage: message,
      stack: this.state.error.stack,
      viewName: this.props.viewName,
    })
  }

  render() {
    if (this.state.error) {
      const message = this.state.error.message?.trim() || 'Unexpected rendering error.'
      return (
        <div className="grid-bg flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <div
            role="alert"
            className="w-full max-w-md rounded-xl border border-red-400/25 bg-card p-6"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-400/30 bg-red-400/10 text-red-400">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="terminal-label text-[9px] text-red-400/90">module isolated</div>
                <h2 className="mt-1 text-sm font-semibold text-foreground">
                  {this.props.viewName} failed to render
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  This view encountered an unexpected error. Let Eva diagnose and patch the source code, or retry.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-red-600 dark:text-red-300 break-words">
              {message}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={this.handleAutoHeal}>
                <Sparkles className="h-3.5 w-3.5" />
                Auto-Heal with Eva
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={this.handleReset}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry {this.props.viewName}
              </Button>
              {this.props.onReturnHome && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs"
                  onClick={this.props.onReturnHome}
                >
                  <Bot className="h-3.5 w-3.5" />
                  Open Agent
                </Button>
              )}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
