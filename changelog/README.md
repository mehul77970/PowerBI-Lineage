# Changelog index

Per-version release notes. The root `CHANGELOG.md` is a thin pointer — each release lives in its own file under this directory.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html). Pre-1.0 convention:

- `0.x.0` — new user-visible features or refactors with behaviour change
- `0.x.y` (`y > 0`) — patches, infrastructure, or hardening without UI change

## Releases

| Version | Date | Theme |
|---|---|---|
| [0.11.3](0.11.3.md) | 2026-04-26 | Mobile responsive — landing card + tabs row + primary tabs + modals clean up at ≤720 / ≤480 |
| [0.11.2](0.11.2.md) | 2026-04-25 | Lineage typeahead bleed-through fix — solid dropdown background + hide placeholder while typing |
| [0.11.1](0.11.1.md) | 2026-04-25 | Lineage tab is search-driven — typeahead replaces the passive empty state; external clicks still work |
| [0.11.0](0.11.0.md) | 2026-04-25 | Drop Mermaid from generated MDs — render-quality across GitHub / ADO Wiki / dashboard never stabilised; `EMIT_MERMAID = false`; helpers retained for one-line revival |
| [0.10.2](0.10.2.md) | 2026-04-25 | erDiagram render fix (underscore-leader entity names broke Mermaid parsing on GitHub) + Measures Depends-on chips linked |
| [0.10.1](0.10.1.md) | 2026-04-25 | Cross-doc xref links (F13) across Measures / DataDict / Sources / Pages / Functions; F6 source-alias dropped after post-cleanup re-examination |
| [0.10.0](0.10.0.md) | 2026-04-25 | Lite / Detailed MD modes — paste-into-wiki stakeholder summary alongside the engineer reference; Detailed-mode cleanup (F5/F7/F8/F9/F10 from /sc:analyze audit) |
| [0.9.0](0.9.0.md) | 2026-04-24 | Data-engineer depth — relationship cardinality + cross-filter, Value.NativeQuery SQL preview, broken-ref detection, M-step parser (10 kinds) |
| [0.8.1](0.8.1.md) | 2026-04-24 | Post-/sc:analyze hardening — CI bundle guard, pair-picker extraction + 37 tests, strict typing on main.ts |
| [0.8.0](0.8.0.md) | 2026-04-24 | Browser mode, pair picker, Source Map, page-layout wireframe |
| [0.7.0](0.7.0.md) | 2026-04-18 | ADO Wiki + GitHub MD compatibility |
| [0.6.0](0.6.0.md) | 2026-04-18 | Generated-MD pass |
| [0.5.2](0.5.2.md) | 2026-04-18 | Post-`/sc:analyze` follow-ups |
| [0.5.1](0.5.1.md) | 2026-04-18 | Inline-handler cleanup, CSS extraction, module carve |
| [0.5.0](0.5.0.md) | 2026-04-18 | Stop 6 — composite-model fixes |
| [0.4.0](0.4.0.md) | 2026-04-18 | Stop 5 pass 1 — client code extracted to `src/client/` |
| [0.3.1](0.3.1.md) | 2026-04-18 | DAX syntax highlighting |
| [0.3.0](0.3.0.md) | 2026-04-18 | Stop 4 — event delegation |
| [0.2.1](0.2.1.md) | 2026-04-18 | Stop 3 — data-embed safety |
| [0.2.0](0.2.0.md) | 2026-04-18 | Stop 2 — server-boundary hardening |
| [0.1.1](0.1.1.md) | 2026-04-18 | Stop 1 — safe helpers + tests |
| [0.1.0](0.1.0.md) | 2026-04-18 | Stop 0 — composite-model + chips |
| [0.0.4](0.0.4.md) | 2026-04-17 | `examples` commit |
| [0.0.3](0.0.3.md) | 2026-04-17 | PR #2 |
| [0.0.2](0.0.2.md) | 2026-04-16 | PR #1 |
| [0.0.1](0.0.1.md) | 2026-04-16 | Initial commit |

## How to add a new release

1. Create a new file `changelog/<x.y.z>.md`. Copy the top-of-file pattern from the latest entry:

   ```
   ## [x.y.z] — YYYY-MM-DD · <short theme>

   <one-or-two-line release blurb>

   ### Added
   ...
   ### Changed
   ...
   ### Fixed
   ...
   ```

2. Add a row to the table above, newest at the top.
3. Bump `package.json` version to match.
4. The dashboard's Docs tab → Changelog entry auto-concatenates every file in this directory at build time, so the new release shows up without additional wiring.
