# DESIGN.md — Omlet Arcade clone

Pinned brief: **dark arcade world, electric blue accent, no purple.** The brief
wins over category defaults (craft-floor "Refuse" list is a default list, not a
ban here). Mode: **Operate** on every surface — familiarity over expression,
150–250 ms motion, state change only.

## World in one line
A night arcade cabinet: deep blue-black glass, one live signal blue for anything
that is happening right now, everything else receding to a cool slate.

## Palette (OKLCH, no purple anywhere)
| Token | Value | Role |
|---|---|---|
| `--canvas` | `oklch(0.17 0.024 258)` | page ground, opaque stage |
| `--surface-1` | `oklch(0.21 0.026 258)` | cards, sheets, bars |
| `--surface-2` | `oklch(0.255 0.028 258)` | raised rows, inputs |
| `--surface-3` | `oklch(0.30 0.03 258)` | hover / pressed fill |
| `--line` | `oklch(0.36 0.03 258)` | hairline borders, separators |
| `--line-soft` | `oklch(0.30 0.028 258)` | inner separators |
| `--ink` | `oklch(0.975 0.006 258)` | primary text |
| `--ink-2` | `oklch(0.84 0.016 258)` | secondary text, tinted not gray |
| `--ink-3` | `oklch(0.66 0.024 258)` | tertiary / meta, tinted |
| `--accent` | `oklch(0.72 0.17 232)` | primary action, selection, live |
| `--accent-ink` | `oklch(0.16 0.03 258)` | text on accent |
| `--accent-soft` | `oklch(0.34 0.09 232)` | accent container / tint fill |
| `--live` | `oklch(0.80 0.15 195)` | voice-active ring, streaming dot |
| `--ok` | `oklch(0.78 0.16 155)` | online, success, confirmed |
| `--warn` | `oklch(0.83 0.15 78)` | degraded, pending |
| `--err` | `oklch(0.66 0.20 25)` | error, destructive, offline |

Hue band is 195–258 (cyan→blue) plus green/amber/red semantics. Purple band
(285–330) is not in the file and must not be introduced.

Contrast checked at build time (`tools/check-contrast.mjs`): body text on every
surface ≥ 4.5:1, large text and icons ≥ 3:1.

## Type
One family, Material type-scale roles, fixed rem steps (no fluid clamp on an
Operate surface). Ratio 1.125–1.2.

| Role | Size / weight / tracking |
|---|---|
| display | 1.75rem / 700 / -0.02em |
| headline | 1.375rem / 700 / -0.015em |
| title-lg | 1.125rem / 650 / -0.01em |
| title | 1rem / 600 / 0 |
| body-lg | 0.9375rem / 450 / 0 |
| body | 0.875rem / 450 / 0 |
| label | 0.8125rem / 600 / 0.005em |
| meta | 0.75rem / 500 / 0.01em |

Stack: `-apple-system, "Roboto", "Segoe UI", system-ui, sans-serif` — system
face, allowed on Operate surfaces and required offline (no network fonts in the
APK). Tabular numerals (`font-variant-numeric: tabular-nums`) on counters,
viewers, ping, and timestamps.

## Shape, depth, spacing
- Radius scale: 6 / 10 / 14 / 999 px. One shape vocabulary, no mixed corners.
- Elevation = tonal surface step + shadow with offset and blur:
  `0 1px 2px oklch(0.1 0.02 258 / 0.5), 0 8px 24px oklch(0.08 0.02 258 / 0.35)`.
  No zero-offset halos.
- Spacing scale on 4: 4 / 8 / 12 / 16 / 20 / 24 / 32. Tight inside a group,
  generous between groups, more space above a heading than below.
- Touch targets ≥ 48×48 dp, ≥ 8 dp apart.

## Icons
Drawn inline SVG only, one system: 24 px viewBox, 1.75 px stroke, round caps
and joins, currentColor. No emoji, no unicode glyph icons, no filled/stroked
mixing. The set lives in `app/web/assets/icons.js` and is rendered by name.

## Motion (hyperframes doctrine applied to an app)
- Duration 150–250 ms, `cubic-bezier(0.2, 0, 0, 1)` (Material emphasized decel).
- Vector law across screen transitions: a screen entered from the right exits to
  the right; the app's current is **LEFT** for forward navigation, **UP** for
  elevation (sheets, dialogs). Never mirrored, never ping-pong on consecutive
  transitions, direction change needs a cause (tap, swipe, back).
- Carriers: the tapped row is the carrier — it scales/fades as the detail screen
  enters mid-flight. No crossfades between screens (no carrier).
- One authored moment per session: the party-join "signal" sweep. Everything
  else is state feedback.
- Idle wobble is banned: nothing breathes, pulses, or floats without cause. The
  only sustained animation is the live-speaking ring, which is causal (audio).
- Honors `prefers-reduced-motion` and the Android "remove animations" setting:
  cut to an instant state change.

## Browser surfaces that ship with the design
Themed text selection, caret color, focus ring (`2px --accent`, `2px offset`),
scrollbar track/thumb from `--surface-2`/`--line`, `::selection` on accent,
`input` autofill tint override, empty-state copy in product language.

## Components (each ships all states)
Filled / tonal / outlined / text button, FAB (one per screen, primary action
only), switch, chip, segmented control, text field, bottom sheet, dialog,
snackbar, list row, avatar (with presence dot and speaking ring), party card,
server card, mic button, tab bar, top app bar, skeleton, empty state, error
state. States: default, hover (pointer only), focus, pressed, disabled, loading,
error, empty.

## Layout
Bottom navigation with 5 destinations on compact width (Home, Parties, Minecraft,
Feed, You). Top app bar per screen. Safe-area insets applied top and bottom.
Expanded width (tablet/foldable) switches the bottom bar to a navigation rail —
a phone bottom bar is never shipped untouched to a tablet.

## Asset provenance
Every raster is authored here and carries its generation prompt in
`.impeccable/assets.json`. No sourced or stock imagery. Icon set, launcher icon,
avatar plates, and the Minecraft-host illustration are drawn/generated for this
product only.
