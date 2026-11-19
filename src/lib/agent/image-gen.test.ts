import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVectorIllustrationPrompts,
  extractAndSanitizeSvg,
  parseWikimediaImageResponse,
  rasterizeSvgToPng,
  resolveImageDimensions,
} from './image-gen'

test('resolveImageDimensions maps legacy sizes, aspect ratios, and defaults', () => {
  assert.deepEqual(resolveImageDimensions('1344x768'), {
    width: 1344,
    height: 768,
    sizeLabel: '1344x768',
    aspectRatio: '16:9',
  })
  assert.deepEqual(resolveImageDimensions(undefined, '9:16'), {
    width: 768,
    height: 1344,
    sizeLabel: '768x1344',
    aspectRatio: '9:16',
  })
  assert.deepEqual(resolveImageDimensions('invalid', 'unknown'), {
    width: 1024,
    height: 1024,
    sizeLabel: '1024x1024',
    aspectRatio: '1:1',
  })
})

test('extractAndSanitizeSvg strips fences, scripts, event handlers, and enforces dimensions', () => {
  const dirty = [
    'Here is your art:',
    '```svg',
    '<svg onload="alert(1)"><script>evil()</script><rect width="100" height="100" fill="#111"/><circle cx="50" cy="50" r="30" onclick="steal()" fill="#f59e0b"/></svg>',
    '```',
  ].join('\n')

  const clean = extractAndSanitizeSvg(dirty, { width: 1024, height: 1024 })
  assert.ok(clean)
  assert.ok(!clean.includes('<script'))
  assert.ok(!clean.includes('onload='))
  assert.ok(!clean.includes('onclick='))
  assert.ok(clean.includes('xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(clean.includes('viewBox="0 0 1024 1024"'))
  assert.ok(clean.includes('width="1024"'))
  assert.ok(clean.includes('height="1024"'))
})

test('rasterizeSvgToPng produces a valid PNG signature buffer', async () => {
  const svg = extractAndSanitizeSvg(
    '<svg><rect width="256" height="256" fill="#0f172a"/><circle cx="128" cy="128" r="72" fill="#38bdf8"/></svg>',
    { width: 256, height: 256 }
  )
  assert.ok(svg)
  const png = await rasterizeSvgToPng(svg)
  // PNG magic bytes: 89 50 4E 47
  assert.equal(png[0], 0x89)
  assert.equal(png[1], 0x50)
  assert.equal(png[2], 0x4e)
  assert.equal(png[3], 0x47)
  assert.ok(png.length > 500)
})

test('buildVectorIllustrationPrompts targets exact requested canvas size', () => {
  const p = buildVectorIllustrationPrompts('Ember coffee logo', { width: 1344, height: 768 })
  assert.ok(p.system.includes('viewBox="0 0 1344 768"'))
  assert.ok(p.user.includes('Ember coffee logo'))
})

test('parseWikimediaImageResponse filters supported image MIME types and cleans titles', () => {
  const parsed = parseWikimediaImageResponse({
    query: {
      pages: {
        '1': {
          title: 'File:Amanita_muscaria_forest.jpg',
          imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', mime: 'image/jpeg' }],
        },
        '2': {
          title: 'File:Sample.ogv',
          imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.ogv', mime: 'video/ogg' }],
        },
        '3': {
          title: 'File:Mushroom_diagram.png',
          imageinfo: [{ url: 'https://upload.wikimedia.org/c.png', mime: 'image/png' }],
        },
      },
    },
  })
  assert.deepEqual(parsed, [
    { url: 'https://upload.wikimedia.org/a.jpg', caption: 'Amanita muscaria forest' },
    { url: 'https://upload.wikimedia.org/c.png', caption: 'Mushroom diagram' },
  ])
})
