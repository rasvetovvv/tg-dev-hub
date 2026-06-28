# Design

Visual system for Dev Hub — **"Amber Terminal"**: deep cool ink with a single warm amber phosphor accent. Source of truth is `src/client/styles.css` (`:root` tokens). This file documents it; the CSS is canonical.

## Theme

Dark, terminal-native. Deep blue-black surfaces, warm amber accent, mint for success/owned, soft red for danger. Mobile-first (primary surface is the Telegram WebApp on a phone); scales up to a 1180px shell.

## Color

Strategy: **Restrained** — tinted-neutral surfaces + one accent (amber) used for primary actions, current selection, and state only.

| Role | Token | Value |
|------|-------|-------|
| Background | `--bg` | `#0b0d12` |
| Surface / 2 / 3 | `--surface` / `--surface-2` / `--surface-3` | `#121620` / `#171c28` / `#1d2433` |
| Border / strong | `--border` / `--border-strong` | `#232a39` / `#303a4f` |
| Text / muted / faint | `--text` / `--muted` / `--faint` | `#eef1f7` / `#969db1` / `#626a80` |
| Accent (amber) | `--amber` / `--amber-bright` | `#ffb454` / `#ffc56e` |
| Accent ink (on amber) | `--amber-ink` | `#1d1503` |
| Success / owned | `--mint` | `#4fe0a6` |
| Danger | `--danger` | `#ff7a6b` |
| Syntax tokens (code preview) | `--tok-kw/str/fn/num` | violet / mint / blue / amber |

Tiers: free = neutral, paid/vip = amber, subscription = blue (`#9cc4ff`), owned = mint. Contrast target: WCAG AA (body ≥4.5:1, large ≥3:1), placeholders use `--faint` verified against `--surface`.

## Typography

Three families on a contrast axis (not similar pairings):
- **Display** `--font-display`: "Space Grotesk" — brand/headings, titles, section labels.
- **Body** `--font-body`: Inter — descriptions, controls, copy.
- **Mono** `--font-mono`: "JetBrains Mono" — data, prices, versions, badges, metrics, code.

Product-register scale (fixed rem-ish px, not fluid): brand 21px, drawer title 25px, card title 17px, section 16–18px, body 14px, meta/mono 11–13px. Letter-spacing floor −0.02em on display.

## Radii & Effects

`--r-xs 8` `--r-sm 10` `--r 14` `--r-lg 20` `--r-pill 999`. Focus ring `--ring` = `0 0 0 3px rgba(255,180,84,.28)`. Card shadow `--shadow-card`, popover `--shadow-pop`. Body has two faint radial glows over `--bg`.

## Components

Shared vocabulary across catalog / drawer / account / admin: project cards, collapsible filter bar (`.filterBar` + `.filterToggle`), pill tabs, access badges (`.accessBadge` + tier modifiers), status/plan cards, unified form fields (surface bg, `--border`, amber focus ring), primary button = amber gradient with `--amber-ink` text. Empty states teach; loading uses shimmer skeletons, not spinners. Every interactive element carries default/hover/focus/active/disabled states.

## Motion

Product motion: 150–250ms typical, ≤300ms ceiling for UI; drawer/sheet 200–500ms. Easing: ease-out for enter, iOS curve `cubic-bezier(0.32,0.72,0,1)` for the drawer/sheet. Press feedback `scale(0.97)`, asymmetric (fast press, slightly slower release). Animate transform/opacity (+ blur/backdrop where it earns it), not layout properties. Lists may stagger their items. Every animation has a `prefers-reduced-motion` fallback (crossfade or instant). Motion conveys state — never decoration, no orchestrated page-load.

## Layout

Shell `min(1180px, 100%)`, mobile-first padding. Catalog grid 3→2→1 columns. Filter selects `repeat(auto-fit, minmax(150px,1fr))`, 2-col on phones. Admin two-column → single column under 900px. No horizontal overflow at any width.
