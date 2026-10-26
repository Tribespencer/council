import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BoardSession, BoardState, Stance } from '../types'
import { AVATARS } from './avatars'

const PANE = 'council-boardroom'
const TITLE = 'Council · Boardroom'
const TOOL = 'update'
const TOOL_FULL = 'mcp__council-boardroom__update'

const EMPTY: BoardState = {
  sourcePath: null,
  pending: null,
  session: null,
  replayPath: null,
  reportPath: null,
  composing: false,
  updatedAt: 0,
}
const board = atom({ plugin: 'council-boardroom', key: 'board' } as const, EMPTY)

// ---------------------------------------------------------------------------
// session.json -> the slice the pane draws (lenient: partial files are fine)
// ---------------------------------------------------------------------------

function asStance(v: unknown): Stance {
  return v === 'for' || v === 'against' ? v : 'conditional'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function parseSession(raw: unknown): BoardSession | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, any>
  const meta = s.meta ?? {}
  const intake = s.intake ?? {}
  const castIn: any[] = Array.isArray(s.cast) ? s.cast : []
  const cast = castIn
    .filter(c => c && typeof c.id === 'string')
    .map(c => ({ id: c.id as string, name: str(c.name) || c.id, seat: str(c.seat) }))
  const roundsIn: any[] = Array.isArray(s.rounds) ? s.rounds : []
  const rounds = roundsIn
    .filter(r => r && typeof r === 'object')
    .map((r, i) => ({
      number: num(r.number) ?? i + 1,
      title: str(r.title),
      chair_intro: str(r.chair_intro),
      red_team: typeof r.red_team === 'string' ? r.red_team : null,
      chair_summary: str(r.chair_summary),
      turns: (Array.isArray(r.turns) ? r.turns : [])
        .filter((t: any) => t && typeof t.speaker === 'string')
        .map((t: any) => ({
          speaker: t.speaker as string,
          stance: asStance(t.stance),
          reply_to: typeof t.reply_to === 'string' ? t.reply_to : null,
          pull_quote: str(t.pull_quote),
          text: str(t.text),
        })),
    }))
  const scoresIn = s.scorecard?.scores ?? {}
  const scores: BoardSession['scores'] = {}
  for (const id of Object.keys(scoresIn)) {
    const sc = scoresIn[id] ?? {}
    const dims = ['upside', 'survivability', 'odds', 'timing', 'fit']
      .map(d => num(sc[d]))
      .filter((v): v is number => v !== null)
    const vote = sc.vote === 'GO' || sc.vote === 'NO-GO' || sc.vote === 'GO-IF' ? sc.vote : null
    if (!vote && dims.length === 0) continue
    scores[id] = {
      composite: dims.length ? Math.round((dims.reduce((a, b) => a + b, 0) / dims.length) * 10) / 10 : 0,
      vote: vote ?? 'GO-IF',
      one_line: str(sc.one_line),
    }
  }
  const d = s.decision
  const decision =
    d && typeof d === 'object' && typeof d.verdict === 'string' && d.verdict
      ? {
          verdict: d.verdict as string,
          confidence: num(d.confidence),
          headline: str(d.headline),
          dissent:
            d.dissent && typeof d.dissent.speaker === 'string'
              ? { speaker: d.dissent.speaker as string, text: str(d.dissent.text) }
              : null,
          averages: Object.fromEntries(
            Object.entries(s.scorecard?.averages ?? {}).filter(([, v]) => typeof v === 'number'),
          ) as Record<string, number>,
        }
      : null
  return {
    title: str(meta.title) || str(intake.one_liner).slice(0, 70),
    question: str(meta.question) || str(intake.one_liner),
    brief: str(intake.brief),
    research: Array.isArray(s.research) ? s.research.length : 0,
    cast,
    rounds,
    scores,
    decision,
  }
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '.'
}

async function exists($: any, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

/** Read a session.json (or take its text), store the parsed board, open the pane. */
async function loadSession($: any, path: string, text?: string): Promise<BoardSession | null> {
  let body = text
  if (body === undefined) {
    try {
      body = await $.fs.read(path)
    } catch {
      return null
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(body as string)
  } catch {
    return null
  }
  const session = parseSession(raw)
  if (!session) return null
  const dir = dirOf(path)
  const replay = `${dir}/replay.html`
  const report = `${dir}/report.pdf`
  const [hasReplay, hasReport] = await Promise.all([exists($, replay), exists($, report)])
  await update($, board, b => ({
    ...(b ?? EMPTY),
    sourcePath: path,
    pending: null,
    composing: false,
    session,
    replayPath: hasReplay ? replay : null,
    reportPath: hasReport ? report : null,
    updatedAt: Date.now(),
  }))
  void $.ui.open({ id: PANE, title: TITLE })
  return session
}

function phaseOf(s: BoardSession | null, pending: string | null): string {
  if (!s) return pending ? 'convening' : 'idle'
  if (s.decision) return 'verdict'
  const lastRound = s.rounds[s.rounds.length - 1]
  if (lastRound) return `round ${lastRound.number}`
  if (s.brief) return 'brief'
  return 'convening'
}

/** Open the pane with the composer showing, focused so typing starts at once. */
async function openComposer($: any): Promise<void> {
  await update($, board, b => ({ ...(b ?? EMPTY), composing: true }))
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
}

/** Hand the question to the Council skill as the person's own prompt. */
async function convene($: any, question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  await update($, board, b => ({
    ...(b ?? EMPTY),
    pending: q,
    composing: false,
    session: null,
    sourcePath: null,
    replayPath: null,
    reportPath: null,
    updatedAt: Date.now(),
  }))
  // A slash command is run as one, never submitted as prompt text.
  void $.command.run({ command: 'council', args: q })
}

async function followUp($: any, question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  void $.prompt.submit({ text: `Follow-up for the council: ${q}`, asUser: true })
}

const SESSION_IN_TEXT = /(\/[^\s"'`]+\/session\.json)/

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description:
        'Redraw the Council boardroom pane from a session.json. Call it after each round when the Council skill writes session.json; pass the absolute path.',
      inputSchema: {
        type: 'object',
        properties: { session_path: { type: 'string', description: 'Absolute path to session.json' } },
        required: ['session_path'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'boardroom',
      description: 'Open the Council boardroom pane. /boardroom <path/to/session.json> loads a finished run.',
    })
    return next(e)
  })

  // Explicit refresh from the skill.
  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const input = e as unknown as { session_path?: string; input?: { session_path?: string } }
    const path = input.session_path ?? input.input?.session_path
    if (!path) return { deny: 'session_path is required' }
    const s = await loadSession($, path)
    if (!s) return { deny: `could not read or parse ${path}` }
    const text = `Boardroom redrawn from ${path}: ${phaseOf(s, null)}, ${s.rounds.length} round(s), ${s.decision ? 'verdict ' + s.decision.verdict : 'no verdict yet'}.`
    return { result: text, text }
  })

  // Passive refresh: any Write of a session.json redraws the pane.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Write' && /\/session\.json$/.test(e.file_path) && !('deny' in ran && ran.deny)) {
      await loadSession($, e.file_path, e.content)
    }
    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Edit' && /\/session\.json$/.test(e.file_path) && !('deny' in ran && ran.deny)) {
      await loadSession($, e.file_path)
    }
    return ran
  })

  // The skill often writes session.json through a python heredoc or the build script.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Bash') {
      const found = SESSION_IN_TEXT.exec(e.command)?.[1]
      if (found && !('deny' in ran && ran.deny)) await loadSession($, found)
    }
    return ran
  })

  // The moment someone types /council, the room starts convening.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const isCouncil = e.command?.name === 'council' || /^\/council\b/.test(text)
    if (isCouncil) {
      const question = text.replace(/^\/council\s*/, '').trim()
      await update($, board, b => ({
        ...(b ?? EMPTY),
        pending: question || '(question to follow)',
        composing: false,
        session: null,
        sourcePath: null,
        replayPath: null,
        reportPath: null,
        updatedAt: Date.now(),
      }))
      void $.ui.open({ id: PANE, title: TITLE })
    }
    return next(e)
  })

  on('command.run', { command: 'boardroom' }, async ($, e) => {
    const path = e.args.trim()
    if (path) {
      const s = await loadSession($, path)
      if (!s) return { text: `Could not read a Council session at ${path}.` }
      return { text: `Boardroom loaded: ${s.title} (${phaseOf(s, null)}).` }
    }
    await openComposer($)
    return { text: 'Boardroom opened. Type a decision in the pane, or load a run with /boardroom <path/to/session.json>.' }
  })

  // ---------------------------------------------------------------------------
  // drawing
  // ---------------------------------------------------------------------------

  const HEX = { for: '#3ddc84', against: '#ff5c6c', conditional: '#f5b942', none: '#3a4670', chair: '#8fb4ff' }
  const stanceColor = (st: Stance | undefined) => (st === 'for' ? 'success' : st === 'against' ? 'error' : st ? 'warning' : 'inactive')
  const stanceWord = (st: Stance) => (st === 'for' ? 'FOR' : st === 'against' ? 'AGAINST' : 'CONDITIONAL')
  const voteColor = (v: string) => (v === 'GO' ? 'success' : v === 'NO-GO' ? 'error' : v === 'SPLIT' ? 'suggestion' : 'warning')

  /** A round avatar as an SVG document: the caricature clipped to a circle with a stance-colored ring. */
  function avatarSvg(id: string, ring: string): string {
    const png = AVATARS[id] ?? AVATARS.wildcard ?? ''
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72">` +
      `<defs><clipPath id="c"><circle cx="36" cy="36" r="33"/></clipPath></defs>` +
      `<circle cx="36" cy="36" r="35" fill="#121a30"/>` +
      `<image href="data:image/png;base64,${png}" x="0" y="0" width="72" height="72" clip-path="url(#c)"/>` +
      `<circle cx="36" cy="36" r="34" fill="none" stroke="${ring}" stroke-width="3"/>` +
      `</svg>`
    )
  }

  // The band above the prompt: the way in, plus a five-dot summary of the room.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const b = (await read($, board)) ?? EMPTY
    const s = b.session
    const phase = phaseOf(s, b.pending)
    const latest = new Map<string, Stance>()
    if (s) for (const r of s.rounds) for (const t of r.turns) latest.set(t.speaker, t.stance)
    const panel = s ? s.cast.filter(c => c.id !== 'chair') : []
    const status =
      phase === 'idle'
        ? 'Five business minds. Three rounds. One decision.'
        : phase === 'convening'
          ? 'The council is convening…'
          : phase === 'verdict'
            ? (s?.decision?.headline ?? '')
            : `${phase} in progress`
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Button key="ask" hotkey="c" variant="primary" onPress={() => { void openComposer($) }}>
          ◆ Ask the council
        </Button>
        {s ? (
          <Button key="open-room" onPress={() => { void $.ui.open({ id: PANE, title: TITLE }) }}>
            Boardroom
          </Button>
        ) : null}
        {panel.length ? (
          <Text>
            {panel.map(c => (
              <Text key={`dot-${c.id}`} color={stanceColor(latest.get(c.id))}>● </Text>
            ))}
          </Text>
        ) : null}
        {s?.decision ? <Text bold color={voteColor(s.decision.verdict)}>{s.decision.verdict}</Text> : null}
        <Text dimColor>{status}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : null
    const Svg = 'Svg' in table ? table.Svg : null
    const b = (await read($, board)) ?? EMPTY
    const s = b.session
    const last = (id: string) => {
      const c = s?.cast.find(x => x.id === id)
      if (!c) return id
      return c.id === 'chair' ? 'The Chair' : (c.name.split(' ').slice(-1)[0] ?? c.name)
    }
    const seatOf = (id: string) => s?.cast.find(x => x.id === id)?.seat ?? ''

    const pill = (text: string, color: string, key?: string) => (
      <Text key={key} backgroundColor={color} color="inverseText" bold size="caption"> {text} </Text>
    )
    const avatar = (id: string, st: Stance | undefined, size = 44) =>
      Svg ? (
        <Svg source={avatarSvg(id, id === 'chair' ? HEX.chair : st ? HEX[st] : HEX.none)} alt={last(id)} width={size} height={size} />
      ) : (
        <Text color={id === 'chair' ? 'suggestion' : stanceColor(st)}>{st || id === 'chair' ? '●' : '○'}</Text>
      )

    const composer = Input ? (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginBottom={1}>
        <Text bold color="warning">Ask the council</Text>
        <Input
          key="ask"
          label="What decision should they debate?"
          placeholder="Raise prices 30% on existing customers? $49/mo SaaS, 1,200 customers…"
          submitLabel="Convene"
          autoFocus
          onSubmit={value => { void convene($, value) }}
        />
        <Text dimColor size="caption">Enter convenes the room · --with "Name" adds a sixth seat · --no-research skips the web</Text>
      </Box>
    ) : (
      <Text dimColor>Type /council followed by the decision to convene the council.</Text>
    )

    const header = (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="warning">C O U N C I L</Text>
          <Text dimColor size="caption">{phaseOf(s, b.pending).toUpperCase()}{s?.research ? ` · ${s.research} SOURCES` : ''}</Text>
        </Box>
        {s ? (
          <Box flexDirection="column">
            <Text bold size="heading">{s.title}</Text>
            {s.question && s.question !== s.title ? <Text dimColor>{s.question}</Text> : null}
          </Box>
        ) : (
          <Text dimColor>Five legendary business minds. Three rounds. One decision.</Text>
        )}
      </Box>
    )

    if (!s) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          {header}
          <Box marginTop={1} flexDirection="column">
            {b.pending && !b.composing ? (
              <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                <Text bold>The council is convening.</Text>
                <Text dimColor>{b.pending}</Text>
                <Text dimColor size="caption">Seats fill as the Chair writes the brief and round one begins.</Text>
              </Box>
            ) : (
              composer
            )}
          </Box>
        </Box>
      )
    }

    const panel = s.cast.filter(c => c.id !== 'chair')
    const latestRound = s.rounds[s.rounds.length - 1]
    const redTeam = s.rounds.find(r => r.number === 2)?.red_team ?? null
    const latestStance = new Map<string, Stance>()
    for (const r of s.rounds) for (const t of r.turns) latestStance.set(t.speaker, t.stance)

    const seats = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1} marginTop={1}>
        {panel.map(c => {
          const st = latestStance.get(c.id)
          const sc = s.scores[c.id]
          return (
            <Box key={`seat-${c.id}`} flexDirection="row" gap={1} alignItems="center" minWidth={22}>
              {avatar(c.id, st)}
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text bold>{last(c.id)}</Text>
                  {redTeam === c.id ? pill('RED TEAM', 'error') : null}
                </Box>
                <Text dimColor size="caption">{c.seat}</Text>
                <Box flexDirection="row" gap={1}>
                  {st ? pill(stanceWord(st), stanceColor(st)) : <Text dimColor size="caption">waiting</Text>}
                  {sc ? <Text bold color={voteColor(sc.vote)}>{sc.vote}</Text> : null}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const verdict = s.decision ? (
      <Box flexDirection="column" borderStyle="round" borderColor={voteColor(s.decision.verdict)} paddingX={1} marginTop={1}>
        <Text dimColor size="caption">THE COUNCIL HAS DECIDED</Text>
        <Box flexDirection="row" gap={2} alignItems="flex-end">
          <Text bold color={voteColor(s.decision.verdict)} size="title">{s.decision.verdict}</Text>
          {s.decision.confidence !== null ? <Text dimColor>confidence {s.decision.confidence} / 100</Text> : null}
        </Box>
        {s.decision.headline ? <Text italic color="warning">{s.decision.headline}</Text> : null}
        {Object.keys(s.decision.averages).length ? (
          <Box flexDirection="column" marginTop={1}>
            {Object.entries(s.decision.averages).map(([k, v]) => {
              const w = Math.max(0, Math.min(20, Math.round(v * 2)))
              return (
                <Box key={`avg-${k}`} flexDirection="row" gap={1}>
                  <Text dimColor size="caption">{(k + '             ').slice(0, 13)}</Text>
                  <Text color="warning">{'█'.repeat(w)}</Text>
                  <Text dimColor>{'░'.repeat(20 - w)}</Text>
                  <Text bold>{v.toFixed(1)}</Text>
                </Box>
              )
            })}
          </Box>
        ) : null}
        {s.decision.dissent ? (
          <Box flexDirection="row" gap={1} marginTop={1} alignItems="center">
            {avatar(s.decision.dissent.speaker, 'against', 36)}
            <Box flexDirection="column">
              <Text dimColor size="caption">DISSENT · {last(s.decision.dissent.speaker)} · {seatOf(s.decision.dissent.speaker)}</Text>
              <Text italic>“{s.scores[s.decision.dissent.speaker]?.one_line || s.decision.dissent.text}”</Text>
            </Box>
          </Box>
        ) : null}
        {b.replayPath || b.reportPath ? (
          <Box flexDirection="row" gap={1} marginTop={1} marginBottom={1}>
            {b.replayPath ? (
              <Button key="open-replay" variant="primary" onPress={() => { void $.process.run(['open', b.replayPath as string]) }}>
                ▶ Open replay
              </Button>
            ) : null}
            {b.reportPath ? (
              <Button key="open-report" onPress={() => { void $.process.run(['open', b.reportPath as string]) }}>
                Open PDF
              </Button>
            ) : null}
          </Box>
        ) : null}
      </Box>
    ) : null

    const round = latestRound ? (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text bold color="warning">ROUND {latestRound.number}</Text>
          <Text dimColor>·</Text>
          <Text bold>{latestRound.title}</Text>
        </Box>
        {latestRound.chair_intro ? <Text dimColor size="caption">{latestRound.chair_intro}</Text> : null}
        {latestRound.turns.map((t, i) => (
          <Box key={`turn-${latestRound.number}-${i}`} flexDirection="row" gap={1} marginTop={1} borderStyle="round" borderDimColor paddingX={1}>
            {avatar(t.speaker, t.stance, 36)}
            <Box flexDirection="column" flexGrow={1}>
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text bold>{last(t.speaker)}</Text>
                {pill(stanceWord(t.stance), stanceColor(t.stance))}
                {t.reply_to ? <Text dimColor size="caption">↩ {last(t.reply_to)}</Text> : null}
                {latestRound.red_team === t.speaker ? pill('RED TEAM', 'error') : null}
              </Box>
              <Text italic color="warning">“{t.pull_quote || t.text.slice(0, 110)}”</Text>
            </Box>
          </Box>
        ))}
        {latestRound.chair_summary ? (
          <Box flexDirection="row" gap={1} marginTop={1} alignItems="center">
            {avatar('chair', undefined, 28)}
            <Text dimColor italic>{latestRound.chair_summary}</Text>
          </Box>
        ) : null}
      </Box>
    ) : s.brief ? (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
        <Text bold color="warning">THE BRIEF</Text>
        <Text>{s.brief}</Text>
        <Text dimColor size="caption">Round one is being argued.</Text>
      </Box>
    ) : (
      <Text dimColor>The Chair is writing the brief.</Text>
    )

    const earlier = s.rounds.length > 1 ? (
      <Box flexDirection="column" marginTop={1}>
        {s.rounds.slice(0, -1).map(r => (
          <Text key={`prev-${r.number}`} dimColor size="caption">
            R{r.number} {r.title}: {r.turns.map(t => `${last(t.speaker)} ${stanceWord(t.stance).toLowerCase()}`).join(' · ')}
          </Text>
        ))}
      </Box>
    ) : null

    const talk = Input && !b.composing ? (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
        <Input
          key="followup"
          label={s.decision ? 'Ask the council a follow-up' : 'Tell the council something mid-debate'}
          placeholder="What if I only raise it for new customers?"
          submitLabel="Ask"
          onSubmit={value => { void followUp($, value) }}
        />
        <Button key="new-question" plain onPress={() => { void openComposer($) }}>
          <Text dimColor size="caption">+ new decision</Text>
        </Button>
      </Box>
    ) : null

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {b.composing ? composer : null}
        {header}
        {seats}
        {verdict}
        {round}
        {earlier}
        {talk}
        <Text dimColor size="caption">AI personas, not the real people · @Spencer.Ai.Tribe</Text>
      </Box>
    )
  })
}
