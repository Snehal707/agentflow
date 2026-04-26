# AgentFlow B+ Luxe Design Handoff Spec

This document defines production implementation details for the selected B+ visual direction across desktop and mobile. It is intended as an engineering handoff reference for consistent UI behavior.

## 1) Scope

- Product surfaces:
  - Portfolio (desktop + mobile)
  - Landing (desktop + mobile)
- Includes:
  - Visual tokens
  - Component-level interaction states
  - Accessibility and motion rules
  - Acceptance criteria checklist

## 2) Selected Reference Screens

- Portfolio Desktop B+ Polish: `ae6b7979d2e24c19aeaff0f921e618cc`
- Landing Desktop B+ Polish: `a3277b05355d4d49a28661c290551d42`
- Portfolio Mobile B+ Polish: `a01b4cec3b4c43f793a28503ae86461c`
- Landing Mobile B+ Polish: `8b9468ec41d349a69d62a3d7a544f50c`
- Portfolio Desktop Interaction States: `a161ebadb747473ba800a807b81cbd9f`
- Landing Desktop Interaction States: `61e1f964bfdf4b9388b3d316a22fcd8f`
- Portfolio Mobile Interaction States: `fc23e87f59154b6686b9b03a21e821cf`
- Landing Mobile Interaction States: `3fe67d2d1392429e83d8f6968b8083bd`

## 3) Design Tokens (B+ Luxe)

### Color

- Base background: `#131313`
- Surface tiers:
  - `surface-low`: `#1c1b1b`
  - `surface-mid`: `#201f1f`
  - `surface-high`: `#2a2a2a`
- Text:
  - Primary: `#e5e2e1`
  - Secondary: `#d0c5af`
- Brand gold:
  - Default primary: `#f2ca50`
  - Pressed/darker: `#d4af37`
- Outline (fallback only): `#4d4635` at low opacity

### Typography

- Headlines/hero/value: `Newsreader`
- UI labels/body/meta: `Manrope`
- Use tighter heading tracking with comfortable body line-height (`1.4` to `1.5` on mobile paragraphs).

### Radius / Depth

- Use medium rounded corners (no sharp corners).
- Avoid hard borders; define boundaries through tonal layering.
- Shadows are warm and restrained; avoid heavy bloom.

## 4) Global Interaction Rules

### State System

- `default`: neutral surface and standard contrast.
- `hover`: slight brighten/lift or subtle gold tint.
- `pressed`: darken gold fill, reduce shadow spread, optional 1px downward feel.
- `active`: persistent emphasis (gold text/icon/indicator).
- `disabled`: reduced opacity and no glow/elevation feedback.

### Transition Timing

- Hover/tap transitions: `120ms` to `180ms`, ease-out.
- Keep motion subtle and premium, never springy.

### Focus Visibility

- All interactive controls must expose visible `:focus-visible`.
- Focus ring should remain high contrast on dark backgrounds and not rely on glow alone.

## 5) Component Behavior Mapping

### Buttons

- Primary CTA:
  - Default: gold fill (`#f2ca50`)
  - Hover: slight lift or contrast increase
  - Pressed: darker gold (`#d4af37`) + tighter shadow
- Secondary/Ghost CTA:
  - Default: transparent/surface with subtle border
  - Hover: slight border brightening or tonal lift
  - Pressed: subtle fill increase while preserving hierarchy below primary

### Chips / Segmented Actions

- Default: low-emphasis neutral
- Hover: mild highlight
- Active: clear selected emphasis (gold accent and/or stronger contrast)

### Nav

- Desktop nav: current route always unambiguous; hover stays subordinate.
- Mobile bottom nav:
  - One active tab at a time
  - Tapped state briefly mirrors active styling during transition

### List Rows

- Pressed feedback uses tonal shift only (no dramatic color swings).
- Row interaction never overpowers surrounding content.

### Feature Cards (Landing)

- Hover state uses subtle elevation and controlled edge glow.
- Card content hierarchy remains unchanged across states.

## 6) Screen-Specific Acceptance Criteria

### Portfolio Desktop

- `Run AI Brief` has distinct default/hover/pressed states.
- Allocation toolbar shows clear inactive/hover/active distinctions.
- At least one activity row demonstrates pressed feedback.
- Sidebar action (`Discuss in Chat`) has hover/pressed behavior.
- Current nav item remains dominant while another item can show hover.

### Portfolio Mobile

- Primary CTA sits in comfortable thumb zone and keeps strongest emphasis.
- Secondary chips are visually subordinate.
- Bottom nav active state is clearly legible on dark background.
- Activity row pressed feedback is visible but subtle.
- Large currency and KPI values remain readable (kerning/line-height balanced).

### Landing Desktop

- Hero primary and secondary CTAs have clear interaction states.
- Top nav includes active + hover differentiation.
- At least one feature card shows hover lift behavior.
- Final CTA pressed state is consistent with hero primary.
- Footer links include active/hover treatment.

### Landing Mobile

- Mobile menu open state is defined and theme-consistent.
- Hero CTA pair has clear primary vs secondary interaction hierarchy.
- Final CTA block interaction mirrors primary behavior.
- Footer links expose active/tapped feedback.
- Vertical rhythm remains consistent between major sections.

## 7) Accessibility Requirements

- Ensure text and interactive contrast meets WCAG AA at minimum.
- Avoid state communication by color alone; pair with shape, weight, underline, or elevation cue.
- Touch targets on mobile should be comfortably tappable (recommended minimum 44x44 CSS px).
- Reduced motion mode should preserve clarity with minimal movement.

## 8) QA Checklist (Implementation Sign-off)

- [ ] Tokens match B+ palette and type choices.
- [ ] Primary/secondary CTA hierarchy is consistent on all screens.
- [ ] Interaction states implemented for nav, buttons, chips, rows, and links.
- [ ] Desktop + mobile behavior is consistent, not identical by force.
- [ ] No hard-border heavy or over-glow regressions introduced.
- [ ] Focus-visible is present for keyboard users.
- [ ] Contrast and touch targets verified.
- [ ] Final pass visually matches selected Stitch interaction companions.

## 9) Engineering Notes

- Prefer shared state tokens in one theme source of truth.
- Keep hover and press deltas small; premium quality comes from consistency and restraint.
- If tradeoffs are needed for performance, prioritize readability and interaction clarity over decorative effects.
