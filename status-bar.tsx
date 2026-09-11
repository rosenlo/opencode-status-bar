/** @jsxImportSource @opentui/solid */
// Persistent status bar for the OpenCode TUI.
//
// Registers the full-width `app_bottom` slot (rendered below the prompt, so it
// never competes with the input for width) and shows throughput + session
// cost for the active session. Hidden on non-session routes (e.g. home).
//
// Derived from each AssistantMessage's tokens / timestamps and the live TUI
// session state. Generic across providers, no per-model logic.
//
// Loaded from tui.json (options optional):
//   { "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "cost"] }]] }
//
// Spacing options (all optional):
//   marginTop, marginBottom, paddingTop, paddingBottom (default 0; margin may be negative)
//   paddingLeft (default 3), paddingRight (default 2)
//
// Segments (order = array order):
//   tps     ⚡ 42.3 tok/s   live rate while streaming, final on complete
//   cost    $0.1234        cumulative cost for the session
//   ttft    ttft 0.42s     time to first streamed token (after complete)
//   dur     8.3s           last turn wall time (after complete)
//   cache   cache 82%      prompt cache hit rate of the last request
//   todo    todo 2/5       completed/total todos for the session
//   pending pending 1      pending permission + question requests
//
// Default show: ["tps", "cost"]

import { createMemo, createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

type Stat = {
  tps: number
  tokens: number
  ms?: number
  cost?: number
  ttft?: number
  live: boolean
}

const DEFAULT_SHOW = ["tps", "cost"]
const SEP = " · "

const usd = (c: number) => (c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`)
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)

const tui: TuiPlugin = async (api, options) => {
  const show = Array.isArray(options?.show)
    ? (options.show as unknown[]).filter((x): x is string => typeof x === "string")
    : DEFAULT_SHOW

  // Vertical spacing knobs. marginTop may be negative to cancel the host's
  // padding above app_bottom.
  const marginTop = num(options?.marginTop, 0)
  const marginBottom = num(options?.marginBottom, 0)
  const paddingTop = num(options?.paddingTop, 0)
  const paddingBottom = num(options?.paddingBottom, 0)
  // Horizontal inset. opencode's session content has paddingLeft 2 and the
  // prompt adds a left border (1), so its status row starts at column 3.
  const paddingLeft = num(options?.paddingLeft, 3)
  const paddingRight = num(options?.paddingRight, 2)

  const [stats, setStats] = createSignal<Record<string, Stat>>({})

  // messageID -> last (tokens, timestamp) sample, for the live rate.
  const sample = new Map<string, { tokens: number; t: number }>()
  // messageID -> earliest streamed part timestamp, for ttft.
  const firstPart = new Map<string, number>()

  const put = (sessionID: string, stat: Stat) =>
    setStats((prev) => ({ ...prev, [sessionID]: stat }))

  const currentSession = createMemo(() => {
    const route = api.route.current
    if (route.name !== "session" || !("params" in route)) return undefined
    const id = route.params?.sessionID
    return typeof id === "string" ? id : undefined
  })

  api.event.on("message.part.updated", (event) => {
    const part = event.properties?.part
    const start = part?.time?.start
    if (!part?.messageID || typeof start !== "number") return
    const prev = firstPart.get(part.messageID)
    if (prev === undefined || start < prev) firstPart.set(part.messageID, start)
  })

  api.event.on("message.updated", (event) => {
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return
    const { tokens, time } = info
    if (!tokens || !time || typeof time.created !== "number") return

    const total = (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    if (total <= 0) return

    // Still streaming: derive a rate from the last token-delta sample.
    if (typeof time.completed !== "number") {
      const now = Date.now()
      const last = sample.get(info.id)
      sample.set(info.id, { tokens: total, t: now })
      if (!last || now - last.t < 200 || total <= last.tokens) return
      const tps = (total - last.tokens) / ((now - last.t) / 1000)
      if (Number.isFinite(tps) && tps > 0) {
        put(info.sessionID, { tps, tokens: total, live: true })
      }
      return
    }

    // Completed: end-to-end throughput for this assistant message.
    const ms = time.completed - time.created
    const start = firstPart.get(info.id)
    firstPart.delete(info.id)
    sample.delete(info.id)
    if (ms <= 0) return
    put(info.sessionID, {
      tps: total / (ms / 1000),
      tokens: total,
      ms,
      ttft: start !== undefined && start >= time.created ? start - time.created : undefined,
      cost: typeof info.cost === "number" ? info.cost : undefined,
      live: false,
    })
  })

  const render = (sessionID: string): string => {
    const s = stats()[sessionID]
    const msgs = api.state.session.messages(sessionID) ?? []

    let cost = 0
    let last
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role !== "assistant") continue
      if (!last) last = m
      if (typeof m.cost === "number") cost += m.cost
    }

    const cacheRead = last?.tokens.cache?.read ?? 0
    const cacheInput = last?.tokens.input ?? 0
    const cacheRate = cacheRead + cacheInput > 0 ? cacheRead / (cacheRead + cacheInput) : undefined

    const todos = api.state.session.todo(sessionID) ?? []
    let done = 0
    let total = 0
    for (const t of todos) {
      if (t.status === "cancelled") continue
      total++
      if (t.status === "completed") done++
    }

    const waiting =
      (api.state.session.permission(sessionID)?.length ?? 0) +
      (api.state.session.question(sessionID)?.length ?? 0)

    const seg: Record<string, string> = {
      tps: s && s.tps > 0 ? `⚡ ${s.tps.toFixed(1)} tok/s` : "",
      cost: cost > 0 ? usd(cost) : "",
      ttft: s && !s.live && s.ttft !== undefined && s.ttft >= 0 ? `ttft ${(s.ttft / 1000).toFixed(2)}s` : "",
      dur: s && !s.live && s.ms ? `${(s.ms / 1000).toFixed(1)}s` : "",
      cache: cacheRate !== undefined ? `cache ${Math.round(cacheRate * 100)}%` : "",
      todo: total > 0 ? `todo ${done}/${total}` : "",
      pending: waiting > 0 ? `pending ${waiting}` : "",
    }

    return show.map((k) => seg[k]).filter(Boolean).join(SEP)
  }

  const slot: TuiSlotPlugin = {
    slots: {
      app_bottom(ctx) {
        const fg = ctx.theme.current.textMuted
        return (
          <box
            visible={currentSession() !== undefined}
            width="100%"
            paddingLeft={paddingLeft}
            paddingRight={paddingRight}
            paddingTop={paddingTop}
            paddingBottom={paddingBottom}
            marginTop={marginTop}
            marginBottom={marginBottom}
          >
            <text fg={fg}>{render(currentSession() ?? "")}</text>
          </box>
        )
      },
    },
  }

  api.slots.register(slot)
}

const plugin: TuiPluginModule & { id: string } = { id: "status-bar", tui }

export default plugin
