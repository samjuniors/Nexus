// Shared types for the Nexus Agent app

export type CapabilityType = 'skill' | 'tool' | 'plugin' | 'mcp' | 'memory'

export interface CapabilityRef {
  type: CapabilityType
  name: string
  reason: string
}

export interface PlanStep {
  id: number
  description: string
  assignee: string
  uses: string[]
}

export interface SubagentDef {
  name: string
  role: string
  steps: number[]
}

export interface AgentPlan {
  analysis: string
  capabilities: CapabilityRef[]
  steps: PlanStep[]
  subagents: SubagentDef[]
  /** coach lesson ids injected into this plan (graded after the run) */
  lessons?: string[]
}

// ---- Run events ----
export type RunEventType =
  | 'analysis'
  | 'capability'
  | 'step_start'
  | 'subagent_spawn'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'step_done'
  | 'final'
  | 'memory_saved'
  | 'error'
  | 'brain_context'
  | 'coach'

export interface SearchDisplayItem {
  title: string
  url: string
  snippet: string
  host: string
  date?: string
}

export interface ImageDisplayItem {
  url: string
  caption?: string
}

export type ToolResultDisplay =
  | { kind: 'search'; results: SearchDisplayItem[] }
  | { kind: 'image'; url: string; prompt: string }
  | { kind: 'images'; items: ImageDisplayItem[] }
  | { kind: 'code'; code: string; output: string; ok: boolean }
  | { kind: 'audio'; url: string; text: string }
  | { kind: 'files'; files: string[] }
  | { kind: 'weather'; place: string; temperature?: number; feelsLike?: number; condition: string; humidity?: number; windKmh?: number; forecast: { date: string; condition: string; min: number; max: number }[] }
  | { kind: 'text'; text: string }

export interface RunEventData {
  [key: string]: unknown
}

export interface EventOut {
  seq: number
  type: RunEventType
  data: RunEventData
}

export interface StepResponse {
  ok: boolean
  busy?: boolean
  status: 'planning' | 'executing' | 'synthesizing' | 'done' | 'error' | 'stopped'
  events: EventOut[]
  error?: string
}

// ---- Tool registry ----
export interface EffectiveTool {
  slug: string
  name: string
  description: string
  kind: 'builtin' | 'plugin' | 'mcp'
  sourceLabel: string
  pluginSlug?: string
  mcpSlug?: string
  argSpec: string
}

export interface ToolExecResult {
  ok: boolean
  summary: string
  raw: string
  display?: ToolResultDisplay
}
