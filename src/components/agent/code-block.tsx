'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { cn } from '@/lib/utils'

/**
 * IDE-style code block used by the chat markdown renderer.
 * Header with language tag + copy button, syntax-highlighted body,
 * line numbers for longer snippets — like a real editor panel.
 */

// adapt oneDark to the charcoal surface: transparent bg, softer borders
const charcoalTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: 0,
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
  },
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
}

export function CodeBlock({
  code,
  language,
}: {
  code: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)

  const lang = (language ?? '').toLowerCase()
  const displayLang = LANG_ALIASES[lang] ?? lang ?? ''
  const lineCount = code.split('\n').length
  const showLineNumbers = lineCount > 4

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // clipboard may be unavailable — ignore
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="code-block group/code my-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#16181d]">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.03] px-3.5 py-1.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
        </span>
        <span className="ml-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-zinc-400">
          {displayLang || 'code'}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => void copy()}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-mono transition-colors',
            copied
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      {/* body */}
      <div className="nice-scroll overflow-x-auto">
        <SyntaxHighlighter
          language={displayLang || 'text'}
          style={charcoalTheme}
          showLineNumbers={showLineNumbers}
          customStyle={{
            background: 'transparent',
            padding: '14px 16px',
            fontSize: '12.5px',
            lineHeight: '1.65',
            margin: 0,
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          }}
          lineNumberStyle={{
            color: 'rgba(161,161,170,0.28)',
            minWidth: '2.2em',
            fontSize: '11px',
            paddingRight: '1em',
          }}
          wrapLongLines={false}
        >
          {code.replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}
