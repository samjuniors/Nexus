export interface OrgRosterMember {
  id: string
  name: string
  title: string
  department: string
  kind: string
  role: string
  status: string
  tasksCompleted: number
  skillsJson?: string
  toolsJson?: string
}

export interface OrgGapRecommendation {
  suggestedKind: 'employee' | 'bot' | 'subagent'
  suggestedName: string
  department: string
  reason: string
}

export interface OrgRosterReview {
  total: number
  active: number
  paused: number
  employees: number
  bots: number
  subagents: number
  totalTasksCompleted: number
  underutilized: string[]
  recommendations: OrgGapRecommendation[]
  summaryText: string
}

function parseList(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Deterministic structural evaluation of AI employees, bots, and subagents under Eva.
 * Used both as structured input for Eva's AI review and as instant fallback.
 */
export function evaluateOrgRoster(members: OrgRosterMember[], focus?: string): OrgRosterReview {
  const activeMembers = members.filter((m) => m.status === 'active')
  const pausedMembers = members.filter((m) => m.status !== 'active')
  const employeeCount = members.filter((m) => m.kind === 'employee').length
  const botCount = members.filter((m) => m.kind === 'bot').length
  const subagentCount = members.filter((m) => m.kind === 'subagent').length
  const totalTasksCompleted = members.reduce((sum, m) => sum + (m.tasksCompleted || 0), 0)

  const underutilized = activeMembers
    .filter((m) => (m.tasksCompleted || 0) === 0)
    .map((m) => `${m.name} (${m.kind}, ${m.department})`)

  const depts = new Set(activeMembers.map((m) => m.department.toLowerCase()))
  const rolesText = activeMembers.map((m) => `${m.title} ${m.role}`.toLowerCase()).join(' ')
  const recommendations: OrgGapRecommendation[] = []

  const focusLower = (focus ?? '').toLowerCase()

  if (!depts.has('qa') && !/\b(qa|audit|security|verify|test)\b/.test(rolesText)) {
    recommendations.push({
      suggestedKind: 'bot',
      suggestedName: 'QA Verifier Bot',
      department: 'QA',
      reason: 'No active QA/verification specialist detected to audit outputs and prevent regressions.',
    })
  }
  if (!depts.has('research') && !/\b(research|web|source|intel)\b/.test(rolesText)) {
    recommendations.push({
      suggestedKind: 'employee',
      suggestedName: 'Nova Researcher',
      department: 'Research',
      reason: 'No dedicated Research AI employee is active for multi-source synthesis.',
    })
  }
  if (!depts.has('engineering') && !/\b(engineer|code|developer|architect|build)\b/.test(rolesText)) {
    recommendations.push({
      suggestedKind: 'employee',
      suggestedName: 'Atlas Architect',
      department: 'Engineering',
      reason: 'No Engineering AI employee is active for architecture and code implementation.',
    })
  }
  if (focusLower && /\b(design|ui|ux|visual|image|brand)\b/.test(focusLower) && !/\b(design|ui|ux|visual)\b/.test(rolesText)) {
    recommendations.push({
      suggestedKind: 'subagent',
      suggestedName: 'UI Creative Director',
      department: 'Design',
      reason: `Focus "${focus}" calls for UI/Visual craft; no active Design specialist is on the roster.`,
    })
  }
  if (focusLower && /\b(data|chart|analytics|metrics|sql)\b/.test(focusLower) && !/\b(data|analyst|metrics|sql)\b/.test(rolesText)) {
    recommendations.push({
      suggestedKind: 'bot',
      suggestedName: 'Data Analyst Bot',
      department: 'Data',
      reason: `Focus "${focus}" needs structured data analysis; consider creating a dedicated analyst bot.`,
    })
  }

  const rosterLines =
    members.length > 0
      ? members.map((m) => {
          const skills = parseList(m.skillsJson)
          const tools = parseList(m.toolsJson)
          return `- ${m.name} [${m.kind}, ${m.status}] — ${m.title} (${m.department}) · tasks: ${m.tasksCompleted}${
            skills.length ? ` · skills: ${skills.join(', ')}` : ''
          }${tools.length ? ` · tools: ${tools.join(', ')}` : ''}`
        })
      : ['(No AI employees, bots, or subagents hired yet — Eva is operating solo.)']

  const gapLines =
    recommendations.length > 0
      ? recommendations.map((r) => `- Recommend ${r.suggestedKind} "${r.suggestedName}" (${r.department}): ${r.reason}`)
      : ['- Active team covers core Engineering, Research, and QA functions.']

  const summaryText = [
    `EVA ORG REVIEW (${activeMembers.length} active / ${members.length} total | ${employeeCount} employees, ${botCount} bots, ${subagentCount} subagents | ${totalTasksCompleted} tasks completed)`,
    '',
    'ROSTER:',
    ...rosterLines,
    ...(underutilized.length ? ['', `UNUTILIZED ACTIVE MEMBERS: ${underutilized.join(', ')}`] : []),
    '',
    'HIRING & BOT RECOMMENDATIONS:',
    ...gapLines,
  ].join('\n')

  return {
    total: members.length,
    active: activeMembers.length,
    paused: pausedMembers.length,
    employees: employeeCount,
    bots: botCount,
    subagents: subagentCount,
    totalTasksCompleted,
    underutilized,
    recommendations,
    summaryText,
  }
}
