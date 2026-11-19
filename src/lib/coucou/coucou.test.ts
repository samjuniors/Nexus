import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapEvaExpressionToCoucouState, getCoucouPreset, COUCOU_ARCHETYPE_PRESETS } from '@/lib/coucou/types'
import { resolveOutfit, seasonalOutfit, OUTFIT_SELECTIONS } from '@/lib/coucou/wardrobe'
import { extractVerificationArtifacts } from '@/lib/agent/agent-identity'
import { extractYouTubeVideoId, detectPlayMediaGoal } from '@/lib/agent/browser-manager'

describe('Coucou engine integration & wardrobe', () => {
  it('maps Eva expressions to valid Coucou BotStateName values', () => {
    assert.equal(mapEvaExpressionToCoucouState('idle'), 'idle')
    assert.equal(mapEvaExpressionToCoucouState('listening'), 'question')
    assert.equal(mapEvaExpressionToCoucouState('speaking'), 'finished')
    assert.equal(mapEvaExpressionToCoucouState('thinking'), 'thinking')
    assert.equal(mapEvaExpressionToCoucouState('working'), 'working')
    assert.equal(mapEvaExpressionToCoucouState('happy'), 'finished')
    assert.equal(mapEvaExpressionToCoucouState('sleeping'), 'sleeping')
    assert.equal(mapEvaExpressionToCoucouState('error'), 'error')
    assert.equal(mapEvaExpressionToCoucouState('curious'), 'approval')
  })

  it('returns distinct presets for Eva, engineer, researcher, auditor, and bot archetypes', () => {
    assert.equal(Object.keys(COUCOU_ARCHETYPE_PRESETS).length, 5)
    assert.equal(getCoucouPreset('eva').bodyColor, '#EEF2FF')
    assert.equal(getCoucouPreset('engineer').defaultOutfit, 'roundGlasses')
    assert.equal(getCoucouPreset('researcher').defaultOutfit, 'beanie')
    assert.equal(getCoucouPreset('auditor').defaultOutfit, 'sunglasses')
    assert.equal(getCoucouPreset('bot').bodyColor, '#38BDF8')
  })

  it('resolves Coucou seasonal and explicit outfits properly', () => {
    assert.equal(OUTFIT_SELECTIONS.length, 13)
    assert.equal(resolveOutfit('crown'), 'crown')
    assert.equal(resolveOutfit('none'), 'none')
    assert.equal(seasonalOutfit(new Date(2026, 9, 25)), 'witchHat')
    assert.equal(seasonalOutfit(new Date(2026, 11, 20)), 'santaHat')
    assert.equal(seasonalOutfit(new Date(2026, 6, 15)), 'sunglasses')
  })
})

describe('Eva autonomous email OTP & link extractor', () => {
  it('extracts labeled OTP verification codes and priority confirmation links', () => {
    const sample = `
      Welcome to Acme!
      Your verification code is 482910.
      Or click to confirm your account: https://acme.example.com/auth/verify?token=abc123
      Visit our homepage at https://acme.example.com/home
    `
    const out = extractVerificationArtifacts(sample)
    assert.deepEqual(out.codes, ['482910'])
    assert.equal(out.links[0], 'https://acme.example.com/auth/verify?token=abc123')
  })

  it('falls back to standalone 6-digit codes when no explicit label is present', () => {
    const out = extractVerificationArtifacts('Use 905312 within 10 minutes.')
    assert.deepEqual(out.codes, ['905312'])
  })
})

describe('YouTube media detection & videoId extraction', () => {
  it('extracts 11-char videoIds from watch, youtu.be, embed, shorts, and ytInitialData HTML', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
    assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=123'), 'dQw4w9WgXcQ')
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1'), 'dQw4w9WgXcQ')
    assert.equal(extractYouTubeVideoId('{"videoRenderer":{"videoId":"AbCdEf0123_"}}'), 'AbCdEf0123_')
  })

  it('detects natural media playback prompts and strips YouTube navigation filler', () => {
    const res1 = detectPlayMediaGoal('open youtube.com and play rafta rafta')
    assert.equal(res1.isMedia, true)
    assert.equal(res1.query.toLowerCase(), 'rafta rafta')

    const res2 = detectPlayMediaGoal('Hey Eva, play lo-fi beats on youtube please')
    assert.equal(res2.isMedia, true)
    assert.equal(res2.query.toLowerCase(), 'lo-fi beats')

    const res3 = detectPlayMediaGoal('open github.com and check trending TypeScript repos')
    assert.equal(res3.isMedia, false)
  })
})
