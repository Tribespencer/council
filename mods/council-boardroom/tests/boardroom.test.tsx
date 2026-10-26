import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'council-boardroom',
  component: 'Pane',
  requestId: 'council-boardroom',
  props: {
    title: 'Council · Boardroom',
    isFocused: false,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SESSION = JSON.stringify({
  meta: { title: 'Raise prices 30%?', question: 'Raise prices 30% on the base?' },
  intake: { one_liner: 'Raise prices?', brief: 'A $49 SaaS with 1,200 customers.' },
  cast: [
    { id: 'hormozi', name: 'Alex Hormozi', seat: 'The Operator', avatar: 'hormozi.png' },
    { id: 'buffett', name: 'Warren Buffett', seat: 'The Allocator', avatar: 'buffett.png' },
    { id: 'chair', name: 'The Chair', seat: 'Moderator', avatar: 'chair.png' },
  ],
  research: [{ id: 'r1', claim: 'x', source: 'y', url: 'z', requested_by: ['hormozi'] }],
  rounds: [
    {
      number: 1,
      title: 'Opening positions',
      chair_intro: 'Open.',
      red_team: null,
      turns: [
        { speaker: 'hormozi', stance: 'for', reply_to: null, text: 'Raise it.', pull_quote: 'Margin is the point.' },
        { speaker: 'buffett', stance: 'against', reply_to: null, text: 'Careful.', pull_quote: 'Do not spend the moat.' },
      ],
      chair_summary: 'Split 1-1.',
    },
    {
      number: 2,
      title: 'Cross-examination',
      chair_intro: 'Attack.',
      red_team: 'buffett',
      turns: [
        { speaker: 'buffett', stance: 'against', reply_to: 'hormozi', text: 'No.', pull_quote: 'A hundred angry emails.' },
        { speaker: 'hormozi', stance: 'for', reply_to: 'buffett', text: 'Yes.', pull_quote: 'That is a coma, not a moat.' },
      ],
      chair_summary: 'Still split.',
    },
  ],
  scorecard: {
    scores: {
      hormozi: { upside: 8, survivability: 7, odds: 7, timing: 9, fit: 8, vote: 'GO', one_line: 'Pull the lever.' },
      buffett: { upside: 5, survivability: 4, odds: 5, timing: 4, fit: 6, vote: 'NO-GO', one_line: 'Leave the base alone.' },
    },
    averages: { upside: 6.5, survivability: 5.5, odds: 6, timing: 6.5, fit: 7 },
  },
  decision: {
    verdict: 'SPLIT',
    confidence: 50,
    headline: 'Test it on new signups first.',
    dissent: { speaker: 'buffett', text: 'I weight the tail.' },
  },
})

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('tool.register', () => ({ value: { tool: 'mcp__council-boardroom__update' } }))
  on('command.register', () => ({ value: { command: 'boardroom' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('fs.read', () => ({ value: SESSION }))
  on('fs.stat', () => ({ value: { size: 1, isFile: true } }))
}

test('before any run the pane explains itself', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input', key: 'ask' })).toBeDefined()
    await ui.unmount()
  }
})

test('a Write of session.json fills the seats, the round and the verdict', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/runs/raise/session.json', content: SESSION })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Raise prices 30%\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Hormozi/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /RED TEAM/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^SPLIT$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ROUND 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /coma, not a moat/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Open replay/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the update tool redraws from a path', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'mcp__council-boardroom__update', session_path: '/runs/raise/session.json' })
  expect('deny' in ran && ran.deny).toBeFalsy()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /VERDICT/ })).toBeDefined()
  await ui.unmount()
})

test('typing /council opens the room in a convening state', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: '/council Should I hire a salesperson?' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /convening/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hire a salesperson/ })).toBeDefined()
  await ui.unmount()
})
