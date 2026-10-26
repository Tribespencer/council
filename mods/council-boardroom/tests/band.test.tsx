import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'council-boardroom',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'council-boardroom',
  component: 'Pane',
  requestId: 'council-boardroom',
  props: {
    title: 'Council · Boardroom',
    isFocused: true,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

function engine(on: Parameters<Parameters<typeof test>[1]>[1], submitted: string[]) {
  on('tool.register', () => ({ value: { tool: 'mcp__council-boardroom__update' } }))
  on('command.register', () => ({ value: { command: 'boardroom' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('command.run', (_, e) => {
    submitted.push(`/${e.command} ${e.args}`)
    return { text: 'ran' }
  })
}

test('the band offers Ask the council, and pressing it opens the composer', async ($, on) => {
  const submitted: string[] = []
  engine(on, submitted)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button', text: /Ask the council/ })).toBeDefined()
    await band.press({ key: 'ask' })
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Input', key: 'ask' })).toBeDefined()
    await pane.input({ key: 'ask', text: 'Should I hire a salesperson?' })
    await pane.unmount()
  }
  expect(submitted.filter(t => t === '/council Should I hire a salesperson?').length).toBe(2)
})

test('after a verdict the pane takes a follow-up for the council', async ($, on) => {
  const submitted: string[] = []
  engine(on, submitted)
  on('tool.call', () => ({ result: {} }))
  on('fs.stat', () => ({ value: { size: 1, isFile: true } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const session = JSON.stringify({
    meta: { title: 'Hire?' },
    cast: [{ id: 'hormozi', name: 'Alex Hormozi', seat: 'The Operator' }, { id: 'chair', name: 'The Chair', seat: 'Moderator' }],
    rounds: [{ number: 1, title: 'Opening positions', turns: [{ speaker: 'hormozi', stance: 'for', text: 'Yes.', pull_quote: 'Hire.' }] }],
    scorecard: { scores: { hormozi: { upside: 8, survivability: 7, odds: 7, timing: 8, fit: 8, vote: 'GO' } }, averages: { upside: 8 } },
    decision: { verdict: 'GO', confidence: 80, headline: 'Hire by March.' },
  })
  await $.tool.call({ tool: 'Write', file_path: '/runs/hire/session.json', content: session })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Input', key: 'followup' })).toBeDefined()
  await pane.input({ key: 'followup', text: 'What if I hire part-time first?' })
  await pane.unmount()
  expect(submitted).toContain('Follow-up for the council: What if I hire part-time first?')
})
