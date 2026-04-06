---
name: content-forge
description: "Write iron, sound human. Content pipeline: idea → angle → write → humanize → verify. Use: /content-forge 'idea', /content-forge --habr, --tg, --humanize, --reframe"
---

Route to the `content-forge` skill with the user's arguments.

Flags:
- `--habr` — full pipeline optimized for Habr (3 title variants, codex review, hub selection)
- `--tg` — short Telegram post (voice-check only, skip codex)
- `--humanize <file>` — run existing text through humanize + fact-check + voice-check
- `--reframe "idea"` — find the "+277 angle" on a "+3 idea"
