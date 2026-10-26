import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BoardSession, BoardState, Stance } from '../types'

const PANE = 'council-boardroom'
const TOOL = 'update'
const TOOL_FULL = 'mcp__council-boardroom__update'

const EMPTY: BoardState = {
  sourcePath: null,
  pending: null,
  session: null,
  replayPath: null,
  reportPath: null,
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
    session,
    replayPath: hasReplay ? replay : null,
    reportPath: hasReport ? report : null,
    updatedAt: Date.now(),
  }))
  void $.ui.open({ id: PANE, title: 'Council · Boardroom' })
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
      await update($, board, b => ({ ...(b ?? EMPTY), pending: question || '(question to follow)', session: null, sourcePath: null, replayPath: null, reportPath: null, updatedAt: Date.now() }))
      void $.ui.open({ id: PANE, title: 'Council · Boardroom' })
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
    await $.ui.open({ id: PANE, title: 'Council · Boardroom' })
    return { text: 'Boardroom pane opened. It redraws itself while /council runs, or load a run with /boardroom <path/to/session.json>.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = (await read($, board)) ?? EMPTY
    const s = b.session
    const cols = Math.max(32, e.props.bodyColumns ?? 60)
    const stanceColor = (st: Stance) => (st === 'for' ? 'success' : st === 'against' ? 'error' : 'warning')
    const stanceWord = (st: Stance) => (st === 'for' ? 'FOR' : st === 'against' ? 'AGAINST' : 'COND')
    const voteColor = (v: string) => (v === 'GO' ? 'success' : v === 'NO-GO' ? 'error' : v === 'SPLIT' ? 'suggestion' : 'warning')
    const last = (id: string) => {
      const c = s?.cast.find(x => x.id === id)
      if (!c) return id
      return c.id === 'chair' ? 'The Chair' : (c.name.split(' ').slice(-1)[0] ?? c.name)
    }
    const rule = '─'.repeat(Math.min(cols, 80))

    if (!s) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold color="warning">C O U N C I L</Text>
          <Text dimColor>Five legendary business minds. Three rounds. One decision.</Text>
          <Text> </Text>
          {b.pending ? (
            <Box flexDirection="column">
              <Text bold>The council is convening.</Text>
              <Text dimColor>{b.pending}</Text>
              <Text> </Text>
              <Text dimColor>Seats fill as the Chair writes the brief and round one begins.</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>No debate yet. Type /council followed by a decision, or</Text>
              <Text dimColor>/boardroom path/to/session.json to replay a finished run.</Text>
            </Box>
          )}
        </Box>
      )
    }

    const panel = s.cast.filter(c => c.id !== 'chair')
    const latestRound = s.rounds[s.rounds.length - 1]
    const redTeam = s.rounds.find(r => r.number === 2)?.red_team ?? null
    const latestStance = new Map<string, Stance>()
    for (const r of s.rounds) for (const t of r.turns) latestStance.set(t.speaker, t.stance)
    const phase = phaseOf(s, b.pending)
    const nameW = Math.max(8, ...panel.map(c => last(c.id).length))
    const pad = (t: string, w: number) => (t.length >= w ? t : t + ' '.repeat(w - t.length))

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="warning">C O U N C I L</Text>
          <Text dimColor>{phase.toUpperCase()}{s.research ? ` · ${s.research} sources` : ''}</Text>
        </Box>
        <Text bold>{s.title}</Text>
        {s.question && s.question !== s.title ? <Text dimColor>{s.question}</Text> : null}
        <Text dimColor>{rule}</Text>

        {/* seats */}
        {panel.map(c => {
          const st = latestStance.get(c.id)
          const sc = s.scores[c.id]
          return (
            <Box key={`seat-${c.id}`} flexDirection="row" gap={1}>
              <Text color={st ? stanceColor(st) : 'inactive'}>{st ? '●' : '○'}</Text>
              <Text bold>{pad(last(c.id), nameW)}</Text>
              <Text dimColor>{pad(c.seat, 16)}</Text>
              <Text color={st ? stanceColor(st) : 'inactive'}>{pad(st ? stanceWord(st) : 'waiting', 8)}</Text>
              {redTeam === c.id ? <Text color="error">RED TEAM</Text> : null}
              {sc ? <Text bold color={voteColor(sc.vote)}>{sc.vote}</Text> : null}
            </Box>
          )
        })}
        <Text dimColor>{rule}</Text>

        {/* verdict, once there is one */}
        {s.decision ? (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text dimColor>THE COUNCIL HAS DECIDED</Text>
            </Box>
            <Box flexDirection="row" gap={2} alignItems="flex-end">
              <Text bold color={voteColor(s.decision.verdict)} size="title">{s.decision.verdict}</Text>
              {s.decision.confidence !== null ? <Text dimColor>confidence {s.decision.confidence} / 100</Text> : null}
            </Box>
            {s.decision.headline ? <Text italic color="warning">{s.decision.headline}</Text> : null}
            <Text> </Text>
            {Object.entries(s.decision.averages).map(([k, v]) => {
              const w = Math.max(0, Math.min(20, Math.round(v * 2)))
              return (
                <Box key={`avg-${k}`} flexDirection="row" gap={1}>
                  <Text dimColor>{pad(k, 13)}</Text>
                  <Text color="warning">{'█'.repeat(w)}</Text>
                  <Text dimColor>{'░'.repeat(20 - w)}</Text>
                  <Text bold>{v.toFixed(1)}</Text>
                </Box>
              )
            })}
            {s.decision.dissent ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>DISSENT · {last(s.decision.dissent.speaker)}</Text>
                <Text italic>“{s.scores[s.decision.dissent.speaker]?.one_line || s.decision.dissent.text}”</Text>
              </Box>
            ) : null}
            {b.replayPath || b.reportPath ? (
              <Box flexDirection="row" gap={1} marginTop={1}>
                {b.replayPath ? (
                  <Button key="open-replay" variant="primary" onPress={() => { void $.process.run(['open', b.replayPath as string]) }}>
                    Open replay
                  </Button>
                ) : null}
                {b.reportPath ? (
                  <Button key="open-report" onPress={() => { void $.process.run(['open', b.reportPath as string]) }}>
                    Open PDF
                  </Button>
                ) : null}
              </Box>
            ) : null}
            <Text dimColor>{rule}</Text>
          </Box>
        ) : null}

        {/* the round in progress (or the last one) */}
        {latestRound ? (
          <Box flexDirection="column">
            <Text bold color="warning">ROUND {latestRound.number} · {latestRound.title.toUpperCase()}</Text>
            {latestRound.chair_intro ? <Text dimColor>{latestRound.chair_intro}</Text> : null}
            {latestRound.turns.map((t, i) => (
              <Box key={`turn-${latestRound.number}-${i}`} flexDirection="column" marginTop={1}>
                <Box flexDirection="row" gap={1}>
                  <Text bold>{last(t.speaker)}</Text>
                  <Text color={stanceColor(t.stance)}>{stanceWord(t.stance)}</Text>
                  {t.reply_to ? <Text dimColor>↩ {last(t.reply_to)}</Text> : null}
                  {latestRound.red_team === t.speaker ? <Text color="error">🎯</Text> : null}
                </Box>
                <Text italic color="warning">“{t.pull_quote || t.text.slice(0, 110)}”</Text>
              </Box>
            ))}
            {latestRound.chair_summary ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>The Chair: {latestRound.chair_summary}</Text>
              </Box>
            ) : null}
          </Box>
        ) : s.brief ? (
          <Box flexDirection="column">
            <Text bold color="warning">THE BRIEF</Text>
            <Text>{s.brief}</Text>
            <Text dimColor>Round one is being argued.</Text>
          </Box>
        ) : (
          <Text dimColor>The Chair is writing the brief.</Text>
        )}

        {/* earlier rounds, one line each */}
        {s.rounds.length > 1 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{rule}</Text>
            {s.rounds.slice(0, -1).map(r => (
              <Text key={`prev-${r.number}`} dimColor>
                R{r.number} {r.title}: {r.turns.map(t => `${last(t.speaker)} ${stanceWord(t.stance).toLowerCase()}`).join(' · ')}
              </Text>
            ))}
          </Box>
        ) : null}
        <Text> </Text>
        <Text dimColor>AI personas, not the real people · @Spencer.Ai.Tribe</Text>
      </Box>
    )
  })
}
