import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HAND_TRACKING_ACTIONS,
  HAND_TRACKING_PREVIEW_LIST,
  classifyToolAction,
  deriveLiveHandTracking,
  extractShortFileName,
} from './hand-tracking'

test('classifyToolAction categorizes file-manipulation and tool-use events accurately', () => {
  assert.equal(classifyToolAction('self_heal_read'), 'file_read')
  assert.equal(classifyToolAction('grep_workspace'), 'file_read')
  assert.equal(classifyToolAction('brain_recall'), 'file_read')

  assert.equal(classifyToolAction('self_heal_patch'), 'file_write')
  assert.equal(classifyToolAction('create_artifact'), 'file_write')
  assert.equal(classifyToolAction('write_file'), 'file_write')

  assert.equal(classifyToolAction('self_heal_verify'), 'terminal_run')
  assert.equal(classifyToolAction('run_shell_command'), 'terminal_run')

  assert.equal(classifyToolAction('browser_click'), 'browser_act')
  assert.equal(classifyToolAction('web_search'), 'browser_act')

  assert.equal(classifyToolAction('paperclip_hire_agent'), 'org_delegate')
  assert.equal(classifyToolAction('spawn_subagent'), 'org_delegate')

  assert.equal(classifyToolAction('custom_calculator'), 'tool_generic')
  assert.equal(classifyToolAction(null), 'idle')
})

test('extractShortFileName extracts clean leaf filename and truncates long names', () => {
  assert.equal(extractShortFileName('src/lib/coucou/engine.ts'), 'engine.ts')
  assert.equal(extractShortFileName('C:\\repo\\app\\page.tsx'), 'page.tsx')
  assert.equal(extractShortFileName('   '), null)
  const longName = extractShortFileName('a/very_long_component_filename_that_exceeds_limit.tsx')
  assert.ok(longName && longName.length <= 26 && longName.endsWith('…'))
})

test('deriveLiveHandTracking prioritizes preview, voice tool, self-heal, browser, and live run events', () => {
  const preview = deriveLiveHandTracking({ previewAction: 'file_write' })
  assert.equal(preview.active, true)
  assert.equal(preview.action, 'file_write')
  assert.equal(preview.isPreview, true)

  const voiceTool = deriveLiveHandTracking({ activeVoiceTool: 'browser_open' })
  assert.equal(voiceTool.active, true)
  assert.equal(voiceTool.action, 'browser_act')
  assert.equal(voiceTool.isPreview, false)

  const selfHeal = deriveLiveHandTracking({ selfHealBusy: true, selfHealStage: 'self_heal_patch' })
  assert.equal(selfHeal.active, true)
  assert.equal(selfHeal.action, 'file_write')

  const runEvent = deriveLiveHandTracking({
    isRunning: true,
    latestRunEvent: {
      id: 'ev1',
      seq: 3,
      type: 'tool_call',
      data: { tool: 'write_file', path: 'src/components/coucou/coucou-bot.tsx' },
      createdAt: new Date().toISOString(),
    },
  })
  assert.equal(runEvent.active, true)
  assert.equal(runEvent.action, 'file_write')
  assert.equal(runEvent.targetLabel, 'coucou-bot.tsx')

  const idle = deriveLiveHandTracking({})
  assert.equal(idle.active, false)
  assert.equal(idle.action, 'idle')
})

test('HAND_TRACKING_PREVIEW_LIST maps cleanly to defined action metadata', () => {
  assert.equal(HAND_TRACKING_PREVIEW_LIST.length, 5)
  for (const id of HAND_TRACKING_PREVIEW_LIST) {
    const meta = HAND_TRACKING_ACTIONS[id]
    assert.ok(meta.label.length > 0)
    assert.ok(meta.accentHex.startsWith('#'))
  }
})
