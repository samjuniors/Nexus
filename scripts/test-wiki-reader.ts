import { getZAI } from '../src/lib/agent/zai'

async function main() {
  const zai = await getZAI()
  if (!zai) {
    console.log('page_reader FAIL: ZAI SDK not configured')
    return
  }
  try {
    const page = await zai.functions.invoke('page_reader', { url: 'https://en.wikipedia.org/wiki/Voyager_program' })
    const title = (page as { data?: { title?: string } })?.data?.title
    const html = (page as { data?: { html?: string } })?.data?.html ?? ''
    console.log('page_reader OK | title:', title, '| html length:', html.length)
    console.log('text sample:', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 150))
  } catch (e) {
    console.log('page_reader FAIL:', e instanceof Error ? e.message : e)
  }
}
void main()
