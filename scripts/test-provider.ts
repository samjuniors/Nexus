/**
 * Provider-chain resolution test (no network calls — resolution only).
 * Run: bunx tsx scripts/test-provider.ts
 */
import { resolveLLMProvider, llmProviderInfo } from '../src/lib/agent/zai'

let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${name}${cond ? '' : extra ? ` — ${extra}` : ''}`)
  if (!cond) fail++
}

// 1. no keys → SDK
delete process.env.OPENAI_API_KEY
delete process.env.ANTHROPIC_API_KEY
const sdk = resolveLLMProvider()
check('no keys → built-in GLM SDK', sdk.kind === 'sdk')

// 2. OpenAI-compatible key → openai provider with defaults
process.env.OPENAI_API_KEY = 'sk-test-dummy'
delete process.env.OPENAI_BASE_URL
delete process.env.OPENAI_MODEL
const oai = resolveLLMProvider()
check('OPENAI_API_KEY → openai provider', oai.kind === 'openai')
if (oai.kind === 'openai') {
  check('default base url', oai.baseUrl === 'https://api.openai.com/v1')
  check('default model', oai.model === 'gpt-4o-mini')
  process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
  process.env.OPENAI_MODEL = 'llama3'
  const custom = resolveLLMProvider()
  check('custom base url + model respected', custom.kind === 'openai' && custom.baseUrl === 'http://localhost:11434/v1' && custom.model === 'llama3')
}
delete process.env.OPENAI_API_KEY
delete process.env.OPENAI_BASE_URL
delete process.env.OPENAI_MODEL

// 3. Anthropic key → anthropic provider
process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
const ant = resolveLLMProvider()
check('ANTHROPIC_API_KEY → anthropic provider', ant.kind === 'anthropic')
if (ant.kind === 'anthropic') check('default claude model', ant.model.startsWith('claude-'))
delete process.env.ANTHROPIC_API_KEY

// 4. OpenAI wins over Anthropic when both set
process.env.OPENAI_API_KEY = 'sk-a'
process.env.ANTHROPIC_API_KEY = 'sk-b'
const both = resolveLLMProvider()
check('openai has priority over anthropic', both.kind === 'openai')
delete process.env.OPENAI_API_KEY
delete process.env.ANTHROPIC_API_KEY

// 5. info surface
const info = llmProviderInfo()
check('provider info reports SDK with no keys', info.provider.includes('GLM'))

console.log(fail === 0 ? '\nALL PROVIDER CHECKS PASSED' : `\n${fail} CHECKS FAILED`)
process.exit(fail === 0 ? 0 : 1)
