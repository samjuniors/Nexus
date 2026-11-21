import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractAudioSyncedSubtitleCue } from './subtitle-engine'
import {
  buildVoiceStageCardFromPresentVisualArgs,
  buildVoiceStageCardFromToolResult,
  createDateTimeVoiceCard,
  isTopicChangeTurn,
  isVoiceDismissIntent,
} from './voice-stage-types'

describe('extractAudioSyncedSubtitleCue', () => {
  const fullTranscript =
    'Good morning! Today is Friday, November 20. I have pulled up the date card right on your screen.'

  it('starts on the first phrase before audio starts instead of skipping to the end', () => {
    const cue = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 0,
      totalScheduledSec: 0,
      isTurnComplete: false,
      maxChars: 55,
    })
    assert.equal(cue.phraseIndex, 0)
    assert.equal(cue.current, 'Good morning!')
    assert.equal(cue.previous, null)
    assert.ok(cue.totalPhrases >= 3)
  })

  it('advances smoothly across phrases in sync with audio playback and returns the previous phrase', () => {
    const startCue = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 0.2,
      totalScheduledSec: 6.0,
      isTurnComplete: true,
      maxChars: 55,
    })
    assert.equal(startCue.phraseIndex, 0)
    assert.equal(startCue.previous, null)

    const midCue = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 2.2,
      totalScheduledSec: 6.0,
      isTurnComplete: true,
      maxChars: 55,
    })
    assert.equal(midCue.phraseIndex, 1)
    assert.equal(midCue.current, 'Today is Friday, November 20.')
    assert.equal(midCue.previous, 'Good morning!')

    const endCue = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 5.9,
      totalScheduledSec: 6.0,
      isTurnComplete: true,
      maxChars: 55,
    })
    assert.equal(endCue.phraseIndex, endCue.totalPhrases - 1)
    assert.equal(endCue.previous, 'Today is Friday, November 20.')
  })

  it('never jumps backward when new transcript text streams in mid-turn (monotonic floor)', () => {
    const extended = `${fullTranscript} Let me know if you want to add an event to your calendar.`
    const cue = extractAudioSyncedSubtitleCue(extended, {
      elapsedSec: 2.0,
      totalScheduledSec: 4.0,
      isTurnComplete: false,
      minPhraseIndex: 2,
      maxChars: 55,
    })
    assert.ok(cue.phraseIndex >= 2, `Expected phraseIndex >= 2, got ${cue.phraseIndex}`)
    assert.ok(cue.previous !== null)
  })

  it('does not slow down early phrases when audio buffers stream ahead of partial transcript', () => {
    // Only the first two sentences (~2.6s of natural speech) have arrived in outputTranscription,
    // while 6.0s of PCM audio (including upcoming sentences) is already buffered on WebAudio.
    const partialText = 'Good morning! Today is Friday, November 20.'
    const cueAt1_2s = extractAudioSyncedSubtitleCue(partialText, {
      elapsedSec: 1.2,
      totalScheduledSec: 6.0,
      isTurnComplete: false,
      maxChars: 55,
    })
    assert.equal(cueAt1_2s.phraseIndex, 1)
    assert.equal(cueAt1_2s.current, 'Today is Friday, November 20.')
    assert.equal(cueAt1_2s.previous, 'Good morning!')
  })

  it('trims leading/trailing PCM silence and computes smooth intra-phrase progress', () => {
    // 0.25s leading silence + 4.35s active voice + 0.8s trailing silence = 5.4s total buffer
    const earlyInPhrase2 = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 1.3,
      totalScheduledSec: 5.4,
      speechStartSec: 0.25,
      speechEndSec: 4.6,
      isTurnComplete: true,
      maxChars: 55,
    })
    const lateInPhrase2 = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 2.0,
      totalScheduledSec: 5.4,
      speechStartSec: 0.25,
      speechEndSec: 4.6,
      isTurnComplete: true,
      maxChars: 55,
    })
    assert.equal(earlyInPhrase2.phraseIndex, 1)
    assert.equal(lateInPhrase2.phraseIndex, 1)
    assert.ok(
      lateInPhrase2.phraseProgress > earlyInPhrase2.phraseProgress,
      `Expected phraseProgress to advance (${earlyInPhrase2.phraseProgress} -> ${lateInPhrase2.phraseProgress})`
    )

    // Near speechEndSec (4.5s, well before trailing silence ends at 5.4s), final phrase is active at 100%
    const atSpeechEnd = extractAudioSyncedSubtitleCue(fullTranscript, {
      elapsedSec: 4.5,
      totalScheduledSec: 5.4,
      speechStartSec: 0.25,
      speechEndSec: 4.6,
      isTurnComplete: true,
      maxChars: 55,
    })
    assert.equal(atSpeechEnd.phraseIndex, atSpeechEnd.totalPhrases - 1)
    assert.equal(atSpeechEnd.phraseProgress, 1)
  })
})

describe('voice-stage-types visual promotion & lifecycle', () => {
  it('auto-promotes generate_image, search_images, weather_lookup, and time.get_datetime results', () => {
    const imgCard = buildVoiceStageCardFromToolResult(
      'generate_image',
      { prompt: 'Neon Tokyo skyline at dusk' },
      {
        ok: true,
        summary: 'Generated image',
        raw: 'ok',
        display: { kind: 'image', url: 'https://example.com/tokyo.png', prompt: 'Neon Tokyo skyline at dusk' },
      }
    )
    assert.ok(imgCard && imgCard.kind === 'image')
    assert.equal(imgCard.url, 'https://example.com/tokyo.png')

    const galleryCard = buildVoiceStageCardFromToolResult(
      'search_images',
      { query: 'alps' },
      {
        ok: true,
        summary: 'Found 2 images',
        raw: 'ok',
        display: {
          kind: 'images',
          items: [
            { url: 'https://example.com/1.jpg', caption: 'Peak 1' },
            { url: 'https://example.com/2.jpg', caption: 'Peak 2' },
          ],
        },
      }
    )
    assert.ok(galleryCard && galleryCard.kind === 'gallery')
    assert.equal(galleryCard.items.length, 2)

    const weatherCard = buildVoiceStageCardFromToolResult(
      'weather_lookup',
      { location: 'Tokyo' },
      {
        ok: true,
        summary: '18C Partly cloudy',
        raw: 'ok',
        display: {
          kind: 'weather',
          place: 'Tokyo',
          temperature: 18,
          condition: 'Partly cloudy',
          humidity: 60,
          windKmh: 12,
          forecast: [{ date: 'Sat', condition: 'Sunny', min: 14, max: 21 }],
        },
      }
    )
    assert.ok(weatherCard && weatherCard.kind === 'weather')
    assert.equal(weatherCard.place, 'Tokyo')

    const dateCard = buildVoiceStageCardFromToolResult(
      'time.get_datetime',
      { timezone: 'UTC' },
      { ok: true, summary: 'UTC time', raw: '2026-11-20T00:00:00Z', display: { kind: 'text', text: 'now' } }
    )
    assert.ok(dateCard && dateCard.kind === 'date_time')
    assert.ok(dateCard.dateLabel.length > 4)
    assert.ok(dateCard.timeLabel.length > 4)

    const failed = buildVoiceStageCardFromToolResult('generate_image', {}, {
      ok: false,
      summary: 'error',
      raw: 'error',
    })
    assert.equal(failed, null)
  })

  it('normalizes present_visual arguments for date_time, list, and code', () => {
    const dt = buildVoiceStageCardFromPresentVisualArgs({ kind: 'date_time', title: 'Today' })
    assert.equal(dt.kind, 'date_time')
    assert.equal(dt.title, 'Today')

    const list = buildVoiceStageCardFromPresentVisualArgs({
      kind: 'list',
      title: 'Checklist',
      items: ['Deploy build', 'Verify mobile layout'],
    })
    assert.equal(list.kind, 'list')
    assert.equal(list.items.length, 2)

    const code = buildVoiceStageCardFromPresentVisualArgs({
      kind: 'code',
      title: 'Quick Script',
      language: 'ts',
      code: 'console.log("hi")',
    })
    assert.equal(code.kind, 'code')
    assert.equal(code.language, 'ts')
  })

  it('detects spoken dismiss commands and distinguishes topic changes from follow-ups', () => {
    assert.equal(isVoiceDismissIntent('close it'), true)
    assert.equal(isVoiceDismissIntent('Thanks, hide that image'), true)
    assert.equal(isVoiceDismissIntent('dismiss'), true)
    assert.equal(isVoiceDismissIntent('clear the screen'), true)
    assert.equal(isVoiceDismissIntent('show me the weather in Paris'), false)

    const dateCard = createDateTimeVoiceCard({ title: 'Today' })
    assert.equal(isTopicChangeTurn('thanks', dateCard), false)
    assert.equal(isTopicChangeTurn('what time is it in Tokyo?', dateCard), false)
    assert.equal(isTopicChangeTurn('keep it open please', dateCard), false)
    assert.equal(isTopicChangeTurn('generate a watercolor painting of mountains', dateCard), true)

    const pinnedCard = { ...dateCard, pinned: true }
    assert.equal(isTopicChangeTurn('generate a watercolor painting of mountains', pinnedCard), false)
  })
})
