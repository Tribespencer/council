export type Stance = 'for' | 'against' | 'conditional'
export type Vote = 'GO' | 'NO-GO' | 'GO-IF'

export type BoardCast = { id: string; name: string; seat: string }
export type BoardTurn = {
  speaker: string
  stance: Stance
  reply_to: string | null
  pull_quote: string
  text: string
}
export type BoardRound = {
  number: number
  title: string
  chair_intro: string
  red_team: string | null
  turns: BoardTurn[]
  chair_summary: string
}
export type BoardScore = { composite: number; vote: Vote; one_line: string }
export type BoardDecision = {
  verdict: string
  confidence: number | null
  headline: string
  dissent: { speaker: string; text: string } | null
  averages: Record<string, number>
}

/** The slice of a Council session.json the pane draws. */
export type BoardSession = {
  title: string
  question: string
  brief: string
  research: number
  cast: BoardCast[]
  rounds: BoardRound[]
  scores: Record<string, BoardScore>
  decision: BoardDecision | null
}

export type BoardState = {
  /** Where the session.json was read from; null before any run. */
  sourcePath: string | null
  /** The question typed at /council, shown while the room convenes. */
  pending: string | null
  session: BoardSession | null
  /** Built outputs next to the session.json, when they exist. */
  replayPath: string | null
  reportPath: string | null
  /** The pane shows the "ask the council" composer. */
  composing: boolean
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'council-boardroom': { board: BoardState }
  }
}
