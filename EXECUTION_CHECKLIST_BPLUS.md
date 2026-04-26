# AgentFlow B+ Execution Checklist (PR-by-PR)

Use this as the implementation sequence after `IMPLEMENTATION_MATRIX_BPLUS.md`.

## PR 0 - Foundation and Shared State System

**Goal:** lock the shared design system primitives before section work starts.

- [ ] Confirm B+ tokens are present and final in `agentflow-frontend/app/globals.css`.
- [ ] Confirm Tailwind extension values are final in `agentflow-frontend/tailwind.config.ts`.
- [ ] Add/verify shared utility classes for:
  - [ ] Primary button states (default/hover/pressed/focus-visible)
  - [ ] Ghost button states
  - [ ] Chip states (default/hover/active/pressed)
  - [ ] Row states (hover/pressed)
  - [ ] Nav states (active + hover distinction)
- [ ] Validate reduced-motion behavior for transitions.
- [ ] QA pass on focus-visible for keyboard navigation.

**Done when:**
- [ ] Base tokens and state classes are reusable across all sections.
- [ ] No component-level one-off color hacks are required for B+ styling.

---

## PR 1 - Portfolio (Desktop + Mobile + Interaction States)

**Reference screens:**  
`ae6b7979d2e24c19aeaff0f921e618cc` / `a01b4cec3b4c43f793a28503ae86461c` / `a161ebadb747473ba800a807b81cbd9f` / `fc23e87f59154b6686b9b03a21e821cf`

- [ ] Match final B+ layout and typography hierarchy.
- [ ] Implement allocation toolbar state system (live/holdings/pnl visual states).
- [ ] Implement activity row pressed feedback.
- [ ] Implement report/sidebar CTA state behavior.
- [ ] Verify mobile thumb-zone CTA hierarchy and bottom-nav active/tap states.
- [ ] Regression-check portfolio functional logic (search/filter/activity/report/chat link).

**Done when:**
- [ ] Visual parity is achieved with desktop/mobile final screens.
- [ ] Interaction parity is achieved with both interaction-state companions.

---

## PR 2 - Landing (Desktop + Mobile + Interaction States)

**Reference screens:**  
`a3277b05355d4d49a28661c290551d42` / `8b9468ec41d349a69d62a3d7a544f50c` / `61e1f964bfdf4b9388b3d316a22fcd8f` / `3fe67d2d1392429e83d8f6968b8083bd`

- [ ] Match hero, feature cards, trust strip, and footer hierarchy.
- [ ] Implement primary/secondary CTA states.
- [ ] Implement feature card hover elevation behavior.
- [ ] Implement footer and nav link hover/active states.
- [ ] Verify mobile menu open state + CTA tap feedback.

**Done when:**
- [ ] Desktop and mobile landing visuals match selected B+ direction.
- [ ] All defined interaction states are implemented and testable.

---

## PR 3 - Workspace/Chat (Desktop + Mobile + Interaction States)

**Reference screens:**  
`d772323bed5b4cc4b9ce964068cca5a9` / `7549c9da4a07426faa63de7edb61e224` / `95d0fcd1f9784224ab33cc9681734c1e` / `6c6f6aa93a4e47659759b8d584235b65`

- [ ] Implement desktop chat shell parity (header/feed/composer/brief).
- [ ] Implement mobile companion shell parity and menu overlay state.
- [ ] Add pressed states for New Chat and composer Run action.
- [ ] Add hover/pressed thread row feedback.
- [ ] Ensure active+hover nav differentiation (desktop) and tap transitions (mobile).

**Done when:**
- [ ] Chat shell is visually consistent with B+ system across breakpoints.
- [ ] Interaction-state companion behavior is reproduced.

---

## PR 4 - Funds (Desktop + Mobile + Interaction States)

**Reference screens:**  
`5ece6ac429cd423b89239640e349e381` / `b9eced07254249a9907d1c19141933a3` / `ac1248f2ebec47fab35f0d8e434bb458` / `6527f959590c480fb8e207b13db3490d`

- [ ] Implement final B+ card/KPI/filter composition.
- [ ] Implement chip state behavior (active/hover/pressed).
- [ ] Implement fund-card hover/pressed row behaviors.
- [ ] Implement modal confirm CTA pressed behavior.
- [ ] Verify desktop sidebar hover + mobile bottom-nav tap transitions.

**Done when:**
- [ ] Funds page matches final B+ references on desktop/mobile.
- [ ] State behavior matches interaction companions.

---

## PR 5 - AgentPay (Desktop + Mobile + Interaction States)

**Reference screens:**  
`d67e2d834b6c484182163a0fedd871ad` / `4176c7cddf6b4411bd023487e04ac14a` / `5edc186ce3d641938f824857ee5ffb15` / `fb742d866322435cbf34e7c2d73f0b52`

- [ ] Implement final B+ tab rail, forms, and transaction list styling.
- [ ] Implement tab active + pressed transition states.
- [ ] Implement primary payment CTA pressed state.
- [ ] Implement modal primary/secondary button state behaviors.
- [ ] Implement transaction row pressed feedback.
- [ ] Verify nav active+hover (desktop) and tap transitions (mobile).

**Done when:**
- [ ] AgentPay visuals and interactions match all B+ references.
- [ ] No legacy cyan or conflicting state styling remains.

---

## PR 6 - Settings (Desktop + Mobile + Interaction States)

**Reference screens:**  
`e1229a16cadc4377af9cc3b9a224fa12` / `5c94472f9f6b4f6fb752372a29e5ef98` / `919252dcacac445a8994a26b47693da1` / `c3247c82a9e14702a17d266b195e93d0`

- [ ] Implement final B+ layout for integrations, toggles, and preferences.
- [ ] Implement toggle on/off + pressed transition cue.
- [ ] Implement ghost action pressed behavior.
- [ ] Implement list row hover/pressed feedback.
- [ ] Verify nav active+hover/tap differentiation across breakpoints.

**Done when:**
- [ ] Settings section reaches desktop/mobile visual parity.
- [ ] Interaction-state parity is complete.

---

## PR 7 - Final QA and Cross-Section Consistency

**Goal:** remove drift between sections and sign off production readiness.

- [ ] Cross-check spacing rhythm consistency (desktop + mobile).
- [ ] Cross-check icon stroke consistency (all sections).
- [ ] Validate CTA contrast and pressed feedback consistency.
- [ ] Validate chip/nav/row interaction behavior consistency.
- [ ] Validate focus-visible across all interactive controls.
- [ ] Validate reduced-motion behavior.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build` in `agentflow-frontend`.

**Done when:**
- [ ] All sections pass visual/state/accessibility QA.
- [ ] Build and typecheck pass with no new regressions.

