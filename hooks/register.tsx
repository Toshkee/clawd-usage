import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Limit, Usage } from '../types'

const usage = atom({ plugin: 'clawd-usage', key: 'usage' } as const, null)
const isHidden = atom({ plugin: 'clawd-usage', key: 'isHidden' } as const, false)

// The cast is the engine's own, as its banner plays it under ultracode: a
// frame every 128 ms, 24 of them from one flare of the wand to the next. A
// trick's frames are 60 ms each, as the banner's.
const FRAME_MS = 128
const TRICK_MS = 60
const CAST_FRAMES = 24
const FLARE_FRAMES = 2
const FADE_FRAMES = 3
const CHARGE_FRAMES = 4
const WAVE_CELLS_A_SECOND = 7
const RISE = 0.9
const DECAY = 1.8
const ECHO = { behind: 3.5, share: 0.4 }
const SHADES = 8
const CASTS_A_COLOR = 2

const REST_MS = 1000
const AWAKE_MS = 5 * 60_000
const POLL_MS = 1000
const ACCOUNT_MS = 60_000
const ACCOUNT_SLOW_MS = 5 * 60_000
const ACCOUNT_MAX_MS = 60 * 60_000
const ACCOUNT_URL = 'https://api.anthropic.com/api/oauth/usage'
const ACCOUNT_KINDS = ['five_hour', 'seven_day']
const SAME_WINDOW_MS = 60_000

const BAR_COLUMNS = 10
const METERS_COLUMNS = 40
const GAP = 2

type Rgb = { r: number; g: number; b: number }

type Tint = {
  purple: Rgb
  crest: number
  wood: Rgb
  woodLit: Rgb
  ember: Rgb
  gold: Rgb
  bright: Rgb
  flare: Rgb
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const ORANGE: Rgb = { r: 215, g: 119, b: 87 }

// The theme's own ultracode purple and the banner's wand, on a dark theme and
// on a light one.
const DARK: Tint = {
  purple: { r: 175, g: 135, b: 255 },
  crest: 0.8,
  wood: { r: 208, g: 162, b: 100 },
  woodLit: { r: 255, g: 240, b: 184 },
  ember: { r: 240, g: 128, b: 72 },
  gold: { r: 255, g: 204, b: 104 },
  bright: { r: 255, g: 236, b: 160 },
  flare: { r: 255, g: 252, b: 235 },
}
const LIGHT: Tint = {
  purple: { r: 135, g: 0, b: 255 },
  crest: 0.7,
  wood: { r: 150, g: 104, b: 48 },
  woodLit: { r: 196, g: 120, b: 24 },
  ember: { r: 232, g: 150, b: 40 },
  gold: { r: 240, g: 118, b: 24 },
  bright: { r: 238, g: 84, b: 16 },
  flare: { r: 224, g: 40, b: 8 },
}

type Span = { glyphs: string; on?: 'face' | 'lid' }

type Rows = Span[][]

type Frame = {
  rows: Rows
  offset: number
  poof?: string
  shadow?: { glyphs: string; left: number }
}

// Clawd's parts as the engine's banner draws them: a face span sits on the
// dark backdrop his eyes show through, a lid is that backdrop over his color.
const ARMS = {
  down: { top: [' ▐', ''], low: ['▝▜', '█▀'] },
  up: { top: ['▗▟', '▄'], low: [' ▜', '█▘'] },
  'one-up': { top: [' ▐', '▄'], low: ['▝▜', '█▘'] },
} as const
const EYES = {
  open: [{ glyphs: '▛███▛█', on: 'face' }],
  left: [{ glyphs: '▟███▟█', on: 'face' }],
  right: [{ glyphs: '█▟███▟', on: 'face' }],
  closed: [
    { glyphs: '▂', on: 'lid' },
    { glyphs: '███', on: 'face' },
    { glyphs: '▂', on: 'lid' },
    { glyphs: '█', on: 'face' },
  ],
  wink: [
    { glyphs: '▛███', on: 'face' },
    { glyphs: '▂', on: 'lid' },
    { glyphs: '█', on: 'face' },
  ],
} satisfies Record<string, Span[]>
const FEET = {
  both: ' ▝▝   ▝▝ ',
  left: ' ▝▝      ',
  right: '      ▝▝ ',
}

const toPose = (
  eyes: keyof typeof EYES = 'open',
  arms: keyof typeof ARMS = 'down',
  feet: keyof typeof FEET = 'both',
): Rows => [
  [{ glyphs: ARMS[arms].top[0] }, ...EYES[eyes], { glyphs: ARMS[arms].top[1] }],
  [
    { glyphs: ARMS[arms].low[0] },
    { glyphs: '█████', on: 'face' },
    { glyphs: ARMS[arms].low[1] },
  ],
  [{ glyphs: FEET[feet] }],
]

// Clawd turned on the spot: each row, and the stretch of it over the backdrop.
const toTurn = (...rows: [string, number, number][]): Rows =>
  rows.map(([glyphs, from, to]) => [
    { glyphs: glyphs.slice(0, from) },
    { glyphs: glyphs.slice(from, to), on: 'face' },
    { glyphs: glyphs.slice(to) },
  ])

const TURNS = {
  'right-12': toTurn(
    [' ▐█▜██▛█ ', 2, 8],
    ['▝▜██████▀', 2, 7],
    [' ▝▝   ▝▝ ', 0, 0],
  ),
  'right-30': toTurn(
    ['  █▛██▛▌ ', 2, 7],
    [' ▝█████▛ ', 2, 7],
    ['  ▘▘  ▘▘ ', 0, 0],
  ),
  'right-55': toTurn(
    ['  ▐█▛█▜  ', 3, 7],
    ['  ▐████  ', 3, 7],
    ['  ▝▝ ▝▝  ', 0, 0],
  ),
  'right-75': toTurn(
    ['   ██▛▌  ', 3, 6],
    ['   ███▌  ', 3, 6],
    ['   ▘  ▘  ', 0, 0],
  ),
  edge: toTurn(
    ['   ▐██   ', 4, 6],
    ['   ▐██   ', 4, 6],
    ['   ▝ ▝   ', 0, 0],
  ),
  'back-105': toTurn(
    ['   ███▌  ', 3, 6],
    ['   ███▌  ', 3, 6],
    ['   ▘  ▘  ', 0, 0],
  ),
  'back-125': toTurn(
    ['  ▐████  ', 3, 7],
    ['  ▐████  ', 3, 7],
    ['  ▝▝ ▝▝  ', 0, 0],
  ),
  'back-150': toTurn(
    ['  █████▌ ', 2, 7],
    [' ▝█████▛ ', 2, 7],
    ['  ▘▘  ▘▘ ', 0, 0],
  ),
  back: toTurn(
    [' ▐██████ ', 2, 8],
    ['▝▜██████▀', 2, 7],
    [' ▝▝   ▝▝ ', 0, 0],
  ),
  'left-75': toTurn(
    ['   ▛██▌  ', 3, 6],
    ['   ███▌  ', 3, 6],
    ['   ▘  ▘  ', 0, 0],
  ),
  'left-55': toTurn(
    ['  ▐▜▛██  ', 3, 7],
    ['  ▐████  ', 3, 7],
    ['  ▝▝ ▝▝  ', 0, 0],
  ),
  'left-30': toTurn(
    ['  ▛██▛█▌ ', 2, 7],
    [' ▝█████▛ ', 2, 7],
    ['  ▘▘  ▘▘ ', 0, 0],
  ),
  'left-12': toTurn(
    [' ▐▛███▜█ ', 2, 8],
    ['▝▜██████▀', 2, 7],
    [' ▝▝   ▝▝ ', 0, 0],
  ),
}

const hold = (rows: Rows, count = 1, more: Partial<Frame> = {}): Frame[] =>
  Array.from({ length: count }, () => ({ rows, offset: 0, ...more }))

const turn = (names: (keyof typeof TURNS)[], shadow?: Frame['shadow']) =>
  names.flatMap(name => hold(TURNS[name], 1, { shadow }))

const STAND = toPose()
const CHEER = toPose('open', 'up')
const SHUT = toPose('closed')
const LOOK_LEFT = toPose('left')
const LOOK_RIGHT = toPose('right')
const LEFT_FOOT = toPose('open', 'down', 'left')
const RIGHT_FOOT = toPose('open', 'down', 'right')
const CROUCH = [
  ...hold(STAND, 1, { offset: 1, poof: '·' }),
  ...hold(STAND, 1, { offset: 1, poof: '~' }),
]
const BLINK = [...hold(SHUT), ...hold(STAND)]
const WIDE = { glyphs: '▁▁▁', left: 3 }
const NARROW = { glyphs: '▁', left: 4 }

// What the banner's Clawd does when clicked, in the engine's order: a jump,
// a look around, a spin, peekaboo, a drop, a wink, a boop, a tap of the feet,
// a sneeze, a turn on the spot, a hop.
const TRICKS: Frame[][] = [
  [
    ...CROUCH,
    ...hold(CHEER, 3),
    ...hold(STAND),
    ...CROUCH,
    ...hold(CHEER, 3),
    ...hold(STAND),
  ],
  [...hold(LOOK_RIGHT, 5), ...hold(LOOK_LEFT, 5), ...hold(STAND)],
  [
    ...hold(LOOK_LEFT, 2),
    ...hold(LOOK_RIGHT, 2),
    ...hold(LOOK_LEFT, 2),
    ...hold(CHEER, 3),
    ...hold(STAND),
  ],
  [
    ...hold(STAND, 1, { offset: 3 }),
    ...hold(STAND, 3, { offset: 2 }),
    ...hold(LOOK_RIGHT, 3, { offset: 2 }),
    ...hold(LOOK_LEFT, 3, { offset: 2 }),
    ...hold(STAND, 2, { offset: 2 }),
    ...hold(STAND, 1, { offset: 1 }),
    ...hold(CHEER, 4),
    ...hold(STAND, 2),
    ...BLINK,
  ],
  [
    ...hold(CHEER, 1, { offset: -3 }),
    ...hold(CHEER, 2, { offset: -2 }),
    ...hold(CHEER, 2, { offset: -1 }),
    ...hold(CHEER),
    ...CROUCH,
    ...hold(STAND, 3),
    ...BLINK,
  ],
  [...hold(toPose('wink'), 5), ...hold(STAND)],
  [
    ...hold(SHUT, 1, { offset: 1, poof: '·' }),
    ...hold(SHUT, 2, { offset: 1, poof: '~' }),
    ...hold(LOOK_LEFT, 4),
    ...hold(STAND, 2),
    ...BLINK,
  ],
  [
    ...hold(LEFT_FOOT, 2),
    ...hold(RIGHT_FOOT, 2),
    ...hold(LEFT_FOOT, 2),
    ...hold(RIGHT_FOOT, 2),
    ...hold(LEFT_FOOT),
    ...hold(RIGHT_FOOT),
    ...hold(CHEER, 3),
    ...hold(STAND),
  ],
  [
    ...hold(toPose('closed', 'up'), 4),
    ...hold(SHUT, 2, { offset: 1, poof: '~' }),
    ...hold(SHUT, 2),
    ...hold(STAND, 2),
    ...BLINK,
  ],
  [
    ...turn(['right-12', 'right-30', 'right-55', 'right-75', 'edge']),
    ...turn(['back-105', 'back-125', 'back-150', 'back', 'back']),
    ...turn(['back-150', 'back-125', 'back-105', 'edge']),
    ...turn(['left-75', 'left-55', 'left-30', 'left-12']),
    ...hold(STAND),
  ],
  [
    ...hold(STAND, 2, { offset: 1 }),
    ...hold(CHEER, 1, { shadow: WIDE }),
    ...turn(['right-55', 'edge', 'back-125', 'back'], NARROW),
    ...turn(['back-125', 'edge', 'left-55'], NARROW),
    ...hold(CHEER, 1, { shadow: WIDE }),
    ...CROUCH,
    ...hold(STAND),
  ],
]

// Between tricks: a claw up for the wand.
const REST: Frame = { rows: toPose('open', 'one-up'), offset: 0 }
const BACKDROP = 'clawd_background'
const DUST = 'inactive'
const WAND = '╱'
const FLAME = '✦'
const SPRITE_ROWS = 3
const SPRITE_COLUMNS = 9
const CLAWD_COLUMNS = SPRITE_COLUMNS + WAND.length + FLAME.length
const TIP = { column: SPRITE_COLUMNS + 1, row: 0 }

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'lim',
}

type Meter = { label: string; percent: number | null; detail: string }

type Paint = (column: number, row: number) => string

type Wand = { wand: string; flame: string; isFlaring: boolean }

type Cell = { glyph: string; color: string; on?: 'face' | 'lid' }

type Piece = { glyphs: string; color: string; on?: 'face' | 'lid' }

const resetOf = (limit: Limit) =>
  limit.resetsAt === null ? null : Date.parse(limit.resetsAt)

// One window as the engine read it and as the account has it: within a window
// the usage only grows, and a later reset is a newer window.
const latest = (ours: Limit, theirs: Limit): Limit => {
  const [our, their] = [resetOf(ours), resetOf(theirs)]
  const isOneWindow =
    our === null || their === null || Math.abs(our - their) <= SAME_WINDOW_MS

  if (!isOneWindow) {
    return (our ?? 0) > (their ?? 0) ? ours : theirs
  }

  const higher = ours.percentUsed >= theirs.percentUsed ? ours : theirs

  return {
    ...higher,
    resetsAt: higher.resetsAt ?? ours.resetsAt ?? theirs.resetsAt,
  }
}

const merge = (engine: Limit[], account: Limit[]): Limit[] => [
  ...engine.map(limit => {
    const theirs = account.find(other => other.kind === limit.kind)

    return theirs ? latest(limit, theirs) : limit
  }),
  ...account.filter(limit => !engine.some(other => other.kind === limit.kind)),
]

const toUsage = (
  figures: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>,
  account: Limit[],
): Usage => ({
  tokens: figures.context.tokens ?? null,
  window: figures.context.window,
  percent: figures.context.percent ?? null,
  limits: merge(
    figures.rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt ?? null,
    })),
    account,
  ),
  usd: figures.cost?.usd ?? null,
})

// The account's windows out of the usage endpoint's reply, the ones the
// engine reports too.
const toLimits = (text: string): Limit[] => {
  const body = JSON.parse(text) as Record<
    string,
    { utilization?: unknown; resets_at?: unknown } | null
  > | null

  return ACCOUNT_KINDS.flatMap(kind => {
    const window = body?.[kind]

    if (typeof window?.utilization !== 'number') {
      return []
    }

    const reset =
      typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN

    return [
      {
        kind,
        percentUsed: Number(window.utilization.toFixed(1)),
        resetsAt: Number.isNaN(reset) ? null : new Date(reset).toISOString(),
      },
    ]
  })
}

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M`
    : `${Math.round(tokens / 1000)}k`

const formatLeft = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const toMeters = (figures: Usage, now: number): Meter[] => {
  const size = `${figures.tokens === null ? '–' : formatTokens(figures.tokens)}/${formatTokens(figures.window)}`
  const cost = figures.usd === null ? '' : ` · $${figures.usd.toFixed(2)}`

  return [
    { label: 'ctx', percent: figures.percent, detail: size + cost },
    ...figures.limits.map(limit => {
      const reset = resetOf(limit)
      // Past its reset a window has nothing used until a reading says so.
      const isOver = reset !== null && reset <= now

      return {
        label: LABELS[limit.kind] ?? limit.kind.slice(0, 3),
        percent: isOver ? 0 : limit.percentUsed,
        detail:
          reset === null || isOver ? '' : `↻ ${formatLeft(reset - now)}`,
      }
    }),
  ]
}

const toneOf = (percent: number) =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

const showPercent = (percent: number | null) =>
  percent === null ? '–' : `${Math.round(percent)}%`

const mix = (from: Rgb, to: Rgb, share: number): Rgb => ({
  r: Math.round(from.r + (to.r - from.r) * share),
  g: Math.round(from.g + (to.g - from.g) * share),
  b: Math.round(from.b + (to.b - from.b) * share),
})

const toColor = ({ r, g, b }: Rgb) => `rgb(${r},${g},${b})`

// The OG orange and the ultracode purple, each for a few casts.
const bodyOf = (cast: number, tint: Tint) =>
  Math.floor(cast / CASTS_A_COLOR) % 2 === 0 ? ORANGE : tint.purple

// How lit a cell is that the ripple passed `behind` cells ago, or has yet to
// reach when negative.
const glow = (behind: number) =>
  Math.exp(behind >= 0 ? -behind / DECAY : behind / RISE)

// The body for one frame: a ripple of light leaves the wand's tip, an echo
// after it, and where it has passed the body wears the cast's next color.
const toPaint = (frame: number, tint: Tint): Paint => {
  const cast = Math.floor(frame / CAST_FRAMES)
  const from = bodyOf(cast, tint)
  const to = bodyOf(cast + 1, tint)
  const front =
    (((frame % CAST_FRAMES) * FRAME_MS) / 1000) * WAVE_CELLS_A_SECOND

  return (column, row) => {
    const behind =
      front - Math.hypot(column - TIP.column, 2 * (row - TIP.row))
    const body = behind >= 0 ? to : from
    const lit = Math.max(glow(behind), ECHO.share * glow(behind - ECHO.behind))
    const crest = mix(body, WHITE, tint.crest)

    return toColor(mix(body, crest, Math.round(lit * SHADES) / SHADES))
  }
}

// The wand for one frame: it flares, fades, flickers, then charges again.
const toWand = (frame: number, tint: Tint): Wand => {
  const at = frame % CAST_FRAMES

  if (at < FLARE_FRAMES) {
    return {
      wand: toColor(tint.woodLit),
      flame: toColor(tint.flare),
      isFlaring: true,
    }
  }

  if (at < FLARE_FRAMES + FADE_FRAMES) {
    const share = (at - FLARE_FRAMES + 1) / FADE_FRAMES

    return {
      wand: toColor(mix(tint.woodLit, tint.wood, share)),
      flame: toColor(mix(tint.bright, tint.gold, share)),
      isFlaring: false,
    }
  }

  if (at >= CAST_FRAMES - CHARGE_FRAMES) {
    const share = (at - (CAST_FRAMES - CHARGE_FRAMES) + 1) / CHARGE_FRAMES

    return {
      wand: toColor(mix(tint.wood, tint.woodLit, share / 2)),
      flame: toColor(mix(tint.gold, tint.bright, share)),
      isFlaring: false,
    }
  }

  const noise = Math.abs(Math.sin(frame * 12.9898) * 43758.5453) % 1
  const flicker = Math.round(noise * SHADES) / SHADES

  return {
    wand: toColor(tint.wood),
    flame: toColor(mix(tint.ember, tint.gold, flicker)),
    isFlaring: false,
  }
}

const BLANK: Span[] = [{ glyphs: ' '.repeat(SPRITE_COLUMNS) }]

// One row as cells, each its color; a blank takes its neighbour's.
const toCells = (spans: Span[], row: number, paint: Paint) => {
  const cells: Cell[] = []

  for (const { glyphs, on } of spans) {
    for (const glyph of glyphs) {
      const last = cells.at(-1)

      cells.push({
        glyph,
        color: glyph === ' ' && last ? last.color : paint(cells.length, row),
        on,
      })
    }
  }

  return cells
}

// A frame as drawn: the pose slid down by its offset, up when negative, out
// of sight past either edge, its dust and shadow over the bottom row.
const toDrawn = (frame: Frame, paint: Paint) =>
  Array.from({ length: SPRITE_ROWS }, (_, row) => {
    const cells = toCells(frame.rows[row - frame.offset] ?? BLANK, row, paint)
    const marks = new Map<number, string>()

    if (row === SPRITE_ROWS - 1 && frame.poof) {
      marks.set(0, frame.poof)
      marks.set(SPRITE_COLUMNS - 1, frame.poof)
    }

    if (row === SPRITE_ROWS - 1 && frame.shadow) {
      for (const [at, glyph] of [...frame.shadow.glyphs].entries()) {
        marks.set(frame.shadow.left + at, glyph)
      }
    }

    if (marks.size === 0) {
      return cells
    }

    return Array.from({ length: SPRITE_COLUMNS }, (_, column): Cell => {
      const mark = marks.get(column)

      return mark === undefined
        ? (cells[column] ?? { glyph: ' ', color: DUST })
        : { glyph: mark, color: DUST }
    })
  })

// A row's cells as pieces, each of one color.
const toPieces = (cells: Cell[]) => {
  const pieces: Piece[] = []

  for (const { glyph, color, on } of cells) {
    const last = pieces.at(-1)

    if (last && last.color === color && last.on === on) {
      last.glyphs += glyph
    } else {
      pieces.push({ glyphs: glyph, color, on })
    }
  }

  return pieces
}

// What the timer and the drawing share; a reload starts it over, harmlessly.
const band = {
  frame: 0,
  trickAt: -1,
  tricks: 0,
  clock: 0,
  awakeUntil: AWAKE_MS,
  sincePoll: 0,
  sinceAccount: 0,
  accountEvery: ACCOUNT_MS,
  account: [] as Limit[],
  tint: DARK as Tint | null,
  isStill: false,
  isAsking: false,
  isShown: false,
  isDrawn: false,
}

const wake = () => {
  band.awakeUntil = band.clock + AWAKE_MS
}

const isAwake = () => band.clock < band.awakeUntil

// Clawd moves while the session is busy and a while after, and never stops
// mid-cast or mid-trick.
const isMoving = () =>
  band.isDrawn &&
  !band.isStill &&
  band.tint !== null &&
  (isAwake() || band.frame % CAST_FRAMES !== 0 || band.trickAt >= 0)

const trickNow = () => TRICKS[band.tricks % TRICKS.length] ?? []

// One frame on: through the trick while one plays, else through the cast,
// and each cast's end starts the next trick.
const step = () => {
  if (band.trickAt < 0) {
    band.frame += 1
    band.trickAt = band.frame % CAST_FRAMES === 0 && isAwake() ? 0 : -1

    return
  }

  const isOver = band.trickAt + 1 >= trickNow().length

  band.trickAt = isOver ? -1 : band.trickAt + 1
  band.tricks += isOver ? 1 : 0
}

const refresh = async ($: EngineInterface) => {
  const figures = toUsage(await $.session.usage(), band.account)

  if (JSON.stringify(await read($, usage)) !== JSON.stringify(figures)) {
    wake()
    await update($, usage, () => figures)
  }
}

// The account's own figures move with every session on it, the engine's only
// with this session's responses. Resolves how long until the next asking: a
// refusal waits as the engine's own /usage does, for as long as it is told.
const readAccount = async ($: EngineInterface) => {
  const auth = await $.session.authorize()

  // No subscription behind the session: nothing to ask until one signs in.
  if (auth?.kind !== 'bearer') {
    return ACCOUNT_SLOW_MS
  }

  const reply = await $.http.fetch(ACCOUNT_URL, { auth: auth.handle })

  if (!reply.ok) {
    const told = Number(reply.headers['retry-after']) * 1000

    return Math.min(told > 0 ? told : ACCOUNT_SLOW_MS, ACCOUNT_MAX_MS)
  }

  band.account = toLimits(reply.text)
  await refresh($)

  return ACCOUNT_MS
}

// One asking at a time.
const pollAccount = async ($: EngineInterface) => {
  if (band.isAsking) {
    return
  }

  band.isAsking = true
  band.accountEvery = await readAccount($).catch(() => ACCOUNT_SLOW_MS)
  band.isAsking = false
}

// The palette the session's theme asks for, none where it keeps to the
// terminal's own colors, and whether the person wants motion at all.
const readLook = async ($: EngineInterface) => {
  const theme = String(
    (await $.config.list()).find(row => row.key === 'theme')?.value ?? '',
  )

  band.tint = /-ansi\b/.test(theme)
    ? null
    : theme.startsWith('light')
      ? LIGHT
      : DARK
  band.isStill = (await $.settings.read()).prefersReducedMotion === true
}

// Clawd now: the theme's own colors where it keeps to the terminal's, a frame
// of a trick with the wand put away, a frame of the cast, or between casts
// his body plain and the wand unlit.
const toLook = (): { frame: Frame; paint: Paint; wand: Wand | null } => {
  const tint = band.tint

  if (tint === null) {
    return {
      frame: REST,
      paint: () => 'clawd_body',
      wand: { wand: 'warning', flame: 'warning', isFlaring: false },
    }
  }

  const body = toColor(bodyOf(Math.floor(band.frame / CAST_FRAMES), tint))
  const trick = isMoving() ? trickNow()[band.trickAt] : undefined

  if (trick) {
    return { frame: trick, paint: () => body, wand: null }
  }

  if (isMoving()) {
    return {
      frame: REST,
      paint: toPaint(band.frame, tint),
      wand: toWand(band.frame, tint),
    }
  }

  return {
    frame: REST,
    paint: () => body,
    wand: {
      wand: toColor(tint.wood),
      flame: toColor(tint.gold),
      isFlaring: false,
    },
  }
}

const run = ($: EngineInterface) => {
  const wait = !isMoving() ? REST_MS : band.trickAt < 0 ? FRAME_MS : TRICK_MS

  $.clock.after(wait, () => {
    band.clock += wait
    band.sincePoll += wait
    band.sinceAccount += wait

    if (isMoving()) {
      step()
    }

    run($)

    // session.measure reports once a turn; in between the figures are polled.
    if (band.sincePoll >= POLL_MS) {
      band.sincePoll = 0
      refresh($).catch(() => {})
    }

    const accountEvery = isAwake()
      ? band.accountEvery
      : Math.max(band.accountEvery, ACCOUNT_SLOW_MS)

    if (band.isShown && band.sinceAccount >= accountEvery) {
      band.sinceAccount = 0
      pollAccount($)
    }

    if (band.isDrawn) {
      $.ui.invalidate('ui.render')
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawd',
      description: 'Prikaži ili sakrij Clawda i mjerače potrošnje',
      immediate: true,
    })
    await readLook($).catch(() => {})
    await refresh($).catch(() => {})
    pollAccount($)
    run($)

    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const set = await next(e)

    await readLook($).catch(() => {})

    return set
  })

  on('command.run', { command: 'clawd' }, async $ => {
    const hidden = await update($, isHidden, held => !held)

    wake()

    return { text: hidden ? 'Clawd je sakriven.' : 'Clawd opet čara.' }
  })

  on('session.measure', async ($, e, next) => {
    wake()
    await update($, usage, () => toUsage(e, band.account))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.isWorking) {
      wake()
    }

    const figures = await read($, usage)

    // The timer reads these two between a drawing's steps: each is set once
    // the drawing knows, never dropped on the way.
    band.isShown = !(
      e.props.hasSurvey ||
      figures === null ||
      (await read($, isHidden))
    )

    if (!band.isShown || figures === null) {
      band.isDrawn = false

      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const meters = toMeters(figures, await $.clock.now())
    const rows = Math.max(SPRITE_ROWS, meters.length)

    band.isDrawn =
      e.props.maxRows >= rows &&
      e.props.bodyColumns >= METERS_COLUMNS + GAP + CLAWD_COLUMNS

    if (!band.isDrawn) {
      return (
        <Text dimColor wrap="truncate-end">
          {meters
            .map(meter => `${meter.label} ${showPercent(meter.percent)}`)
            .join(' · ')}
          {figures.usd === null ? '' : ` · $${figures.usd.toFixed(2)}`}
        </Text>
      )
    }

    const { frame, paint, wand } = toLook()

    return (
      <Box>
        <Box flexDirection="column" width={METERS_COLUMNS}>
          {meters.map(meter => {
            const percent = meter.percent ?? 0
            const filled = Math.min(
              BAR_COLUMNS,
              Math.ceil((percent / 100) * BAR_COLUMNS),
            )

            return (
              <Box>
                <Text dimColor>{meter.label.padEnd(4)}</Text>
                <Text color={toneOf(percent)}>{'█'.repeat(filled)}</Text>
                <Text dimColor>{'░'.repeat(BAR_COLUMNS - filled)}</Text>
                <Text>{` ${showPercent(meter.percent).padStart(4)}  `}</Text>
                <Text dimColor wrap="truncate-end">
                  {meter.detail}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Box key="clawd" flexDirection="column" marginLeft={GAP}>
          {toDrawn(frame, paint).map((cells, row) => (
            <Box>
              {toPieces(cells).map(piece =>
                piece.on === 'face' ? (
                  <Text color={piece.color} backgroundColor={BACKDROP}>
                    {piece.glyphs}
                  </Text>
                ) : piece.on === 'lid' ? (
                  <Text color={BACKDROP} backgroundColor={piece.color}>
                    {piece.glyphs}
                  </Text>
                ) : (
                  <Text color={piece.color}>{piece.glyphs}</Text>
                ),
              )}
              {wand && row === TIP.row ? (
                <Text color={wand.wand} bold>
                  {WAND}
                </Text>
              ) : null}
              {wand && row === TIP.row ? (
                <Text color={wand.flame} bold={wand.isFlaring}>
                  {FLAME}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
