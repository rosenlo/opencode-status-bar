/** @jsxImportSource @opentui/solid */
// Persistent status bar for the OpenCode TUI.
//
// Registers a `session_prompt_right` slot showing throughput and session
// cost, derived from each AssistantMessage's tokens / timestamps and the live
// TUI session state. Generic across providers, no per-model logic.
//
// Loaded from tui.json (options optional):
//   { "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "cost"] }]] }
//
// Segments (order = array order):
//   tps   ⚡ 42.3 tok/s     live rate while streaming, final on complete
//   cost  $0.1234          cumulative cost for the session
//   ttft  ttft 420ms       time to first streamed token (after complete)
//   dur   8.3s             last turn wall time (after complete)
//
// Default show: ["tps", "cost"]

import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

type Stat = {
  tps: number
  tokens: number
  ms?: number
  cost?: number
  ttft?: number
  model?: string
  live: boolean
}

const DEFAULT_SHOW = ["tps", "cost"]
const SEP = " · "

const usd = (c: number) => (c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`)

const tui: TuiPlugin = async (api, options) => {
  const show = Array.isArray(options?.show)
    ? (options.show as unknown[]).filter((x): x is string => typeof x === "string")
    : DEFAULT_SHOW

  const [stats, setStats] = createSignal<Record<string, Stat>>({})

  // messageID -> last (tokens, timestamp) sample, for the live rate.
  const sample = new Map<string, { tokens: number; t: number }>()
  // messageID -> earliest streamed part timestamp, for ttft.
  const firstPart = new Map<string, number>()

  const put = (sessionID: string, stat: Stat) =>
    setStats((prev) => ({ ...prev, [sessionID]: stat }))

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
    for (const m of msgs) {
      if (m.role === "assistant" && typeof m.cost === "number") cost += m.cost
    }

    const seg: Record<string, string> = {
      tps: s && s.tps > 0 ? `⚡ ${s.tps.toFixed(1)} tok/s` : "",
      cost: cost > 0 ? usd(cost) : "",
      ttft: s && !s.live && s.ttft !== undefined && s.ttft >= 0 ? `ttft ${s.ttft}ms` : "",
      dur: s && !s.live && s.ms ? `${(s.ms / 1000).toFixed(1)}s` : "",
    }

    return show.map((k) => seg[k]).filter(Boolean).join(SEP)
  }

  const slot: TuiSlotPlugin = {
    slots: {
      session_prompt_right(ctx, value) {
        const fg = ctx.theme.current.textMuted
        return <text fg={fg}>{render(value.session_id)}</text>
      },
    },
  }

  api.slots.register(slot)
}

const plugin: TuiPluginModule & { id: string } = { id: "status-bar", tui }

export default plugin
