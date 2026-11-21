// Client-safe policy metadata shared by permission UX and server security.
// Do not import Prisma, Node crypto or control-bus from this file.
const SINGLE_USE_CAPABILITIES = new Set([
  'self_install', 'mobile_control', 'workspace_shell', 'desktop_bridge', 'self_code_edit',
])

export function requiresSingleUseApproval(capability: string): boolean {
  return SINGLE_USE_CAPABILITIES.has(capability)
}
