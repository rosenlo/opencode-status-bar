# opencode-status-bar

A small TUI plugin for [opencode](https://opencode.ai) that adds a persistent
status line on its own full-width row below the prompt, for the active session.

```
⚡ 42.3 tok/s · $0.1234
```

- **tps** — live tokens/sec while streaming, final end-to-end rate on completion
- **cost** — cumulative cost for the session
- **ttft** — time to first streamed token (after completion)
- **dur** — last turn wall time (after completion)
- **cache** — prompt cache hit rate of the last request
- **todo** — completed/total todos for the session
- **pending** — pending permission + question requests

Everything is generic across providers/models: it is derived from each
assistant message's `tokens` and `time` fields plus the live TUI session
state. There is no per-model logic.

## Requirements

- opencode with TUI plugin support (1.18+)
- No build step: opencode transpiles the `.tsx` at load time

## Install

1. Drop the plugin into your opencode config:

   ```bash
   mkdir -p ~/.config/opencode/plugins
   curl -fsSL https://raw.githubusercontent.com/rosenlo/opencode-status-bar/main/status-bar.tsx \
     -o ~/.config/opencode/plugins/status-bar.tsx
   ```

2. Register it in `~/.config/opencode/tui.json`. TUI plugins are **not**
   auto-discovered — they must be listed here:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "cost"] }]]
   }
   ```

3. Restart opencode.

If the line does not appear, open the command palette and run **Plugins** to
check that `status-bar` is active.

## Configuration

The optional second tuple element controls which segments are shown and in
what order. Any subset of `tps`, `cost`, `ttft`, `dur`, `cache`, `todo`,
`pending`:

```json
{
  "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "cost", "dur"] }]]
}
```

Default: `["tps", "cost"]`.

Vertical spacing can be tuned with `marginTop`, `marginBottom`, `paddingTop`
and `paddingBottom` (numbers, default `0`). `marginTop` may be negative to
cancel the host's padding above the `app_bottom` slot:

```json
{
  "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "cost"], "marginTop": 0 }]]
}
```

## Notes

- TPS is `(output + reasoning) / (completed − created)`. That is wall-clock
  and includes time-to-first-token, so it understates pure decode speed for
  slow-starting models.
- Providers that do not report token usage produce no `tps` segment.
- The status line renders into opencode's full-width `app_bottom` slot, so it
  does not compete with the prompt input for horizontal space. It is hidden on
  non-session routes (e.g. the home screen).

## License

MIT
