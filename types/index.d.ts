export type Limit = {
  kind: string
  percentUsed: number
  resetsAt: string | null
}

export type Usage = {
  tokens: number | null
  window: number
  percent: number | null
  limits: Limit[]
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-usage': { usage: Usage | null; isHidden: boolean }
  }
}
