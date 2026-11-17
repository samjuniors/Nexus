import { reflexCheck } from '../brain/core/cognition'

/**
 * Reflex probe — prints the reflex decision for edge-case messages so the
 * deterministic routing layer can be tuned without hitting the API.
 */
const cases = [
  'Say the word banana and nothing else.',
  'Hello, how are you today?',
  'What is the capital of France?',
  "what's the date today?",
  'read the news about AI today',
  "today's stock price of Apple",
  'say hello out loud',
  'speak this text',
  'read this out loud',
  'translate this to French',
  'do you speak French?',
  'say hi to your mother for me',
  'generate an image of a cat',
  'run this code in the terminal',
  'what happened today in the world',
  'weather today in Mumbai',
  'what time is it right now?',
  'tell me about the weather in Tokyo', // no "today" — should be chat/answerable
]

let bad = 0
for (const c of cases) {
  const decision = reflexCheck(c)
  const label = decision ? `TASK (${decision.reason})` : 'chat'
  const suspicious =
    /banana|how are you|capital of France|do you speak|say hi to your mother/.test(c) && decision
  if (suspicious) bad++
  console.log(`${suspicious ? '!!' : '  '} ${label.padEnd(28)} <- ${c}`)
}
console.log(bad === 0 ? '\nno suspicious escalations' : `\n${bad} suspicious escalations`)
