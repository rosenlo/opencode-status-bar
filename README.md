# opencode-status-bar

A small TUI plugin for [opencode](https://opencode.ai) that adds a persistent
multi-metric status line to the session prompt (right side of the input box).

```
⚡ 42.3 tok/s · ctx 24.1k/200k · $0.1234 · opus
```

- **tps** — live tokens/sec while streaming, final end-to-end rate on completion
- **ctx** — last request context size / model context window
- **cost** — cumulative cost for the session
- **model** — model id of the last assistant message
- **ttft** — time to first streamed token (after completion)
- **dur** — last turn wall time (after completion)

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
     "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "ctx", "cost", "model"] }]]
   }
   ```

3. Restart opencode.

If the line does not appear, open the command palette and run **Plugins** to
check that `status-bar` is active.

## Configuration

The optional second tuple element controls which segments are shown and in
what order. Any subset of `tps`, `ctx`, `cost`, `model`, `ttft`, `dur`:

```json
{
  "plugin": [["./plugins/status-bar.tsx", { "show": ["tps", "model"] }]]
}
```

Default: `["tps", "ctx", "cost", "model"]`.

## Notes

- TPS is `(output + reasoning) / (completed − created)`. That is wall-clock
  and includes time-to-first-token, so it understates pure decode speed for
  slow-starting models.
- Providers that do not report token usage produce no `tps` segment.
- The status line renders into opencode's `session_prompt_right` slot.

## License

MIT
