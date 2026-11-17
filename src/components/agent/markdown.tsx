'use client'

import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { CodeBlock } from '@/components/agent/code-block'

/**
 * Shared markdown renderer for assistant answers.
 * - remark-breaks: single line breaks render as breaks (chat-style)
 * - fenced code renders as an IDE-style block (language tag, copy button,
 *   syntax highlighting) — see code-block.tsx
 * - images (tool-generated or web) render as rounded artifact cards and
 *   relative workspace names resolve to the files API
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code({ className, children, ...props }) {
          const text = String(children ?? '')
          const match = /language-(\S+)/.exec(className ?? '')
          // inline code — no fence, no newline
          if (!match && !text.includes('\n')) {
            return (
              <code
                className="rounded-[5px] border border-white/[0.07] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.86em] text-zinc-200"
                {...props}
              >
                {children}
              </code>
            )
          }
          return <CodeBlock code={text.replace(/\n$/, '')} language={match?.[1]} />
        },
        img: ({ src, alt }) => {
          const s = String(src ?? '')
          const url = /^https?:\/\//.test(s) || s.startsWith('/') ? s : `/api/files?name=${encodeURIComponent(s)}`
          return (
            <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
              { }
              <img
                src={url}
                alt={String(alt ?? 'image')}
                loading="lazy"
                className="my-2 max-h-96 w-auto max-w-full rounded-xl border border-white/[0.08] bg-black/30 object-contain"
              />
            </a>
          )
        },
        a: ({ href, children }) => (
          <a
            href={String(href ?? '#')}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline decoration-zinc-500/60 underline-offset-2 transition-colors hover:text-zinc-100"
          >
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
