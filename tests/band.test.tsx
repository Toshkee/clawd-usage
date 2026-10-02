import type { On, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T10:00:00Z')

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

const ORANGE = 'rgb(215,119,87)'
const PURPLE = 'rgb(175,135,255)'
const FRAME_MS = 128
const CAST_MS = 24 * FRAME_MS
const TRICK_MS = 60

// When things happen, in ms from the start: the first tick is a second in
// (it was set before the band was drawn), a cast is 24 frames, and after each
// cast comes a trick: a jump of 12 frames, a look of 11, a spin of 10.
const JUMP_AT = 1000 + 23 * FRAME_MS
const CAST_2_AT = JUMP_AT + 12 * TRICK_MS
const LOOK_AT = CAST_2_AT + CAST_MS
const CAST_3_AT = LOOK_AT + 11 * TRICK_MS
const CAST_4_AT = CAST_3_AT + CAST_MS + 10 * TRICK_MS
// Late in a cast the ripple has passed and Clawd is one color again.
const CALM = 19 * FRAME_MS + 10

const props = (
  over: { isWorking?: boolean; maxRows?: number; bodyColumns?: number } = {},
) => ({
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
  ...over,
})

const MEASURED = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T12:14:00Z' },
    { kind: 'seven_day', percentUsed: 91 },
  ],
  cost: { usd: 1.239 },
  changed: ['context', 'rateLimits', 'cost'],
} as const

type Figures = Omit<SessionUsage, 'startedAt'>

type Account = { status: number; text: string; headers?: Record<string, string> }

// What stands beneath the mod: the clock, the engine's figures, the account's
// usage endpoint, the theme and settings, the engine's own band.
const world = (on: On, figures: Figures, account: Account | null = null) => {
  const clock = mock.clock(on, { now: NOW })
  const held = {
    figures,
    account,
    fetched: [] as string[],
    theme: 'dark',
    isStill: false,
  }

  on('session.usage', () => ({ value: { startedAt: NOW, ...held.figures } }))
  on('session.authorize', () => ({
    value: held.account === null ? null : { handle: 'held', kind: 'bearer' },
  }))
  on('http.fetch', (_, e) => {
    held.fetched.push(`${e.url} ${e.init?.auth}`)

    const { status, text, headers = {} } = held.account ?? { status: 404, text: '' }

    return {
      value: { status, ok: status >= 200 && status < 300, headers, text },
    }
  })
  on('config.list', () => ({
    value: [
      {
        key: 'theme',
        label: 'Theme',
        kind: 'choice',
        value: held.theme,
        provider: { plugin: 'engine', tier: 'core' },
        isLocked: false,
      },
    ],
  }))
  on('settings.read', () => ({
    value: held.isStill ? { prefersReducedMotion: true } : {},
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return { clock, held }
}

const QUIET: Figures = { context: { window: 200_000 }, rateLimits: [] }

test('draws the measured figures on each surface with a band', async ($, on) => {
  world(on, QUIET)

  await $.session.start(START)
  await $.session.measure({
    ...MEASURED,
    rateLimits: [...MEASURED.rateLimits],
    changed: [...MEASURED.changed],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'clawd-usage',
      surface,
      component: 'AbovePrompt',
      props: props(),
    })

    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '84k/200k · $1.24' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↻ 2h 14m' })).toBeDefined()
    expect(await ui.find({ key: 'clawd' })).toBeDefined()
    await ui.unmount()
  }
})

test('the terminal draws the bars in blocks, the fullest in the error color', async ($, on) => {
  world(on, QUIET)

  await $.session.start(START)
  await $.session.measure({
    ...MEASURED,
    rateLimits: [...MEASURED.rateLimits],
    changed: [...MEASURED.changed],
  })
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })

  expect((await ui.find({ type: 'Text', text: '█'.repeat(10) }))?.props.color).toBe('error')
  expect((await ui.findAll({ type: 'Text', text: '░' })).length).toBe(2)
})

// A desktop sets text in a font of its own, where block glyphs neither fill
// their cells nor line up.
test('off the terminal Clawd and the bars are pictures, no block left to a text font', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  await $.session.measure({
    ...MEASURED,
    rateLimits: [...MEASURED.rateLimits],
    changed: [...MEASURED.changed],
  })
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: props(),
  })
  const pictures = async () =>
    (await ui.findAll({ type: 'Svg' })).map(picture => picture.props)
  const clawd = async () => String((await pictures()).at(-1)?.source)
  const drawn = await pictures()
  const texts = await ui.findAll({ type: 'Text' })

  expect(drawn.map(picture => picture.alt)).toEqual(['ctx 42%', '5h 24%', '7d 91%', 'Clawd'])
  expect(texts.some(text => /[\u2580-\u259f╱✦]/.test(text.text ?? ''))).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'ctx' })).toBeDefined()

  // The fullest bar is lit end to end, in the error shade.
  expect(String(drawn[2]?.source).includes('<rect width="90" height="14" fill="rgb(232,80,100)"/>')).toBe(true)

  // Clawd is eleven cells by three: his body, his eyes on the backdrop, the
  // star at the wand's tip.
  expect([drawn[3]?.width, drawn[3]?.height]).toEqual([99, 54])
  expect((await clawd()).includes(`fill="${ORANGE}"`)).toBe(true)
  expect((await clawd()).includes('fill="rgb(0,0,0)"')).toBe(true)
  expect((await clawd()).includes('fill="rgb(255,252,235)"')).toBe(true)

  // He moves as in the terminal: the cast, then the jump with the wand away,
  // in a puff of dust.
  const flaring = await clawd()

  await clock.advance(1000 + 10 * FRAME_MS)

  expect(await clawd()).not.toBe(flaring)

  await clock.set(NOW + JUMP_AT + 10)

  expect((await clawd()).includes('rgb(255,252,235)')).toBe(false)
  expect((await clawd()).includes('<circle')).toBe(true)
})

test('Clawd stands by the meters with the wand up, his eyes on the backdrop', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const place = async () => (await ui.find({ key: 'clawd' }))?.props.marginLeft

  expect((await ui.find({ key: 'clawd' }))?.text).toBe(
    ' ▐▛███▛█▄╱✦▝▜██████▘ ▝▝   ▝▝ ',
  )
  expect((await ui.find({ type: 'Text', text: '▛███▛█' }))?.props.backgroundColor).toBe(
    'clawd_background',
  )
  expect((await ui.find({ type: 'Text', text: '╱' }))?.props.bold).toBe(true)

  const held = await place()

  await clock.advance(1000 + CAST_MS)

  expect(await place()).toBe(held)
})

test('each cast the wand flares and a ripple of light crosses Clawd', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const flame = async () => (await ui.find({ type: 'Text', text: '✦' }))?.props
  // The claw farthest from the wand: the ripple reaches it last.
  const claw = async () => (await ui.find({ type: 'Text', text: '▜' }))?.props.color

  expect(await flame()).toEqual({ color: 'rgb(255,252,235)', bold: true })
  expect(await claw()).toBe(ORANGE)

  // The first tick was set before the band was drawn: a second, then frames.
  await clock.advance(1000 + 10 * FRAME_MS)

  expect((await flame())?.bold).toBe(false)
  expect(await claw()).not.toBe(ORANGE)

  await clock.advance(12 * FRAME_MS)

  expect(await claw()).toBe(ORANGE)
})

test('the ripple turns Clawd from the OG orange to the ultracode purple and back', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const body = async () => (await ui.find({ type: 'Text', text: '█████' }))?.props.color

  await clock.set(NOW + 1000 - FRAME_MS + CALM)

  expect(await body()).toBe(ORANGE)

  await clock.set(NOW + CAST_2_AT + CALM)

  expect(await body()).toBe(PURPLE)

  await clock.set(NOW + CAST_3_AT + CALM)

  expect(await body()).toBe(PURPLE)

  await clock.set(NOW + CAST_4_AT + CALM)

  expect(await body()).toBe(ORANGE)
})

test('after each cast Clawd puts the wand away for one of the banner tricks, a new one each time', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const drawn = async () => (await ui.find({ key: 'clawd' }))?.text
  const wand = () => ui.find({ type: 'Text', text: '╱' })

  // The jump: a crouch a row down in a puff of dust, then both claws up.
  await clock.set(NOW + JUMP_AT + 10)

  expect(await wand()).toBeUndefined()
  expect(await drawn()).toBe('         ' + ' ▐▛███▛█' + '·▜██████·')
  expect((await ui.find({ type: 'Text', text: '·' }))?.props.color).toBe('inactive')

  await clock.advance(2 * TRICK_MS)

  expect(await drawn()).toBe('▗▟▛███▛█▄' + ' ▜██████▘' + ' ▝▝   ▝▝ ')

  await clock.set(NOW + CAST_2_AT + 10)

  expect(await wand()).toBeDefined()

  // The next one is the look around, in the color the cast left him.
  await clock.set(NOW + LOOK_AT + 10)

  expect(await wand()).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '█▟███▟' }))?.props.color).toBe(PURPLE)
})

test('a quiet session lets Clawd rest after a while, mid-cast never', async ($, on) => {
  const { clock } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props({ isWorking: false }),
  })
  const drawn = async () => JSON.stringify(await ui.find({ key: 'clawd' }))

  await clock.advance(1000 + 5 * FRAME_MS)
  const moving = await drawn()

  await clock.advance(FRAME_MS)

  expect(await drawn()).not.toBe(moving)

  // Six quiet minutes, the band too narrow for him meanwhile (a tick a
  // second); then the cast he was in runs out, and no trick follows it.
  await ui.redraw(props({ isWorking: false, bodyColumns: 30 }))
  await clock.advance(6 * 60_000)
  await ui.redraw(props({ isWorking: false }))
  await clock.advance(1000 + CAST_MS)
  const resting = await drawn()

  expect((await ui.find({ type: 'Text', text: '✦' }))?.props).toEqual({
    color: 'rgb(255,204,104)',
    bold: false,
  })
  expect((await ui.findAll({ type: 'Text', text: '▝▝' })).length).toBe(1)

  await clock.advance(10_000)

  expect(await drawn()).toBe(resting)

  await ui.redraw(props({ isWorking: true }))
  await clock.advance(1000 + 5 * FRAME_MS)

  expect(await drawn()).not.toBe(resting)
})

test('the figures follow the session between turns, working or not', async ($, on) => {
  const { clock, held } = world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props({ isWorking: false }),
  })

  expect(await ui.find({ type: 'Text', text: '42%' })).toBeUndefined()

  held.figures = {
    context: MEASURED.context,
    rateLimits: [...MEASURED.rateLimits],
    cost: MEASURED.cost,
  }
  await clock.advance(1000)

  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↻ 2h 14m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '91%' })).toBeDefined()
})

const ACCOUNT = {
  five_hour: { utilization: 31.0, resets_at: '2026-10-02T12:13:59.655452+00:00' },
  seven_day: { utilization: 12.0, resets_at: '2026-10-08T13:59:59.655473+00:00' },
  seven_day_opus: null,
}

test('the account shows its windows before the first response, and whichever reading is later after', async ($, on) => {
  const { clock, held } = world(on, QUIET, {
    status: 200,
    text: JSON.stringify(ACCOUNT),
  })

  await $.session.start(START)
  // The account is asked as the session starts, and not waited for.
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props({ isWorking: false }),
  })

  expect(held.fetched).toEqual(['https://api.anthropic.com/api/oauth/usage held'])
  expect(await ui.find({ type: 'Text', text: '31%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↻ 2h 14m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()

  // This session's own responses: the same five hours further on, and a
  // week the account's reading is ahead of.
  held.figures = {
    context: MEASURED.context,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-02T12:14:00Z' },
      { kind: 'seven_day', percentUsed: 11, resetsAt: '2026-10-08T14:00:00Z' },
    ],
  }
  await clock.advance(1000)

  expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()

  // Another session spends: only the account knows, a minute later at most.
  held.account = {
    status: 200,
    text: JSON.stringify({
      ...ACCOUNT,
      five_hour: { ...ACCOUNT.five_hour, utilization: 55.0 },
    }),
  }
  await ui.redraw(props({ isWorking: false, bodyColumns: 30 }))
  await clock.advance(60_000)
  await ui.redraw(props({ isWorking: false }))

  expect(held.fetched.length).toBe(2)
  expect(await ui.find({ type: 'Text', text: '55%' })).toBeDefined()
})

test('a window past its reset reads empty, and a refused account is left alone for a while', async ($, on) => {
  const { clock, held } = world(on, {
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-10-02T10:00:30Z' },
    ],
  }, { status: 429, text: '', headers: { 'retry-after': '120' } })

  await $.session.start(START)
  // A narrow band: one line, and one tick a second.
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props({ bodyColumns: 30 }),
  })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('ctx – · 5h 80%')

  await clock.advance(31_000)
  await ui.redraw()

  expect((await ui.find({ type: 'Text' }))?.text).toBe('ctx – · 5h 0%')

  // Refused and told how long: that long.
  await clock.advance(88_000)

  expect(held.fetched.length).toBe(1)

  held.account = { status: 429, text: '' }
  await clock.advance(2000)

  expect(held.fetched.length).toBe(2)

  // Refused with nothing said: five minutes, as the engine's own /usage waits.
  await clock.advance(298_000)

  expect(held.fetched.length).toBe(2)

  await clock.advance(2000)

  expect(held.fetched.length).toBe(3)
})

test('a light theme gets the deeper purple and the darker wand', async ($, on) => {
  const { clock, held } = world(on, QUIET)

  held.theme = 'light-daltonized'
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })

  expect((await ui.find({ type: 'Text', text: '✦' }))?.props.color).toBe('rgb(224,40,8)')

  await clock.set(NOW + CAST_2_AT + CALM)

  expect((await ui.find({ type: 'Text', text: '█████' }))?.props.color).toBe('rgb(135,0,255)')
})

test('an ANSI theme keeps Clawd to the theme colors, and still', async ($, on) => {
  const { clock, held } = world(on, QUIET)

  held.theme = 'dark-ansi'
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const drawn = async () => JSON.stringify(await ui.find({ key: 'clawd' }))
  const resting = await drawn()

  expect((await ui.find({ type: 'Text', text: '█████' }))?.props.color).toBe('clawd_body')
  expect((await ui.find({ type: 'Text', text: '✦' }))?.props).toEqual({
    color: 'warning',
    bold: false,
  })

  await clock.advance(1000 + CAST_MS)

  expect(await drawn()).toBe(resting)
})

test('reduced motion keeps Clawd still, the wand unlit', async ($, on) => {
  const { clock, held } = world(on, QUIET)

  held.isStill = true
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })
  const drawn = async () => JSON.stringify(await ui.find({ key: 'clawd' }))
  const resting = await drawn()

  expect((await ui.find({ type: 'Text', text: '█████' }))?.props.color).toBe(ORANGE)
  expect((await ui.find({ type: 'Text', text: '✦' }))?.props).toEqual({
    color: 'rgb(255,204,104)',
    bold: false,
  })

  await clock.advance(1000 + CAST_MS)

  expect(await drawn()).toBe(resting)
})

test('/clawd hides the band', async ($, on) => {
  world(on, QUIET)

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(),
  })

  expect(await ui.find({ key: 'clawd' })).toBeDefined()

  await $.command.run({
    command: 'clawd',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  await ui.redraw()

  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
})

test('a narrow band keeps the figures on one line', async ($, on) => {
  world(on, {
    context: { tokens: 20_000, window: 200_000, percent: 10 },
    rateLimits: [],
    cost: { usd: 0.5 },
  })

  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'clawd-usage',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props({ bodyColumns: 30 }),
  })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('ctx 10% · $0.50')
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
})
