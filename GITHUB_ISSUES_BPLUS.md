# AgentFlow B+ GitHub Issue Pack

Copy each block into a new GitHub issue.

---

## Issue 1: B+ Foundation and Shared State System

**Title:** `B+ Foundation: tokens, shared states, and accessibility primitives`

**Body:**

### Scope
Establish shared B+ tokens and reusable interaction-state utilities for all sections.

### Tasks
- [ ] Confirm final B+ tokens in `agentflow-frontend/app/globals.css`
- [ ] Confirm final Tailwind theme extension in `agentflow-frontend/tailwind.config.ts`
- [ ] Validate shared utility classes for:
  - [ ] primary button states
  - [ ] ghost button states
  - [ ] chip states
  - [ ] row hover/pressed states
  - [ ] nav active/hover states
- [ ] Validate reduced-motion behavior
- [ ] Validate focus-visible behavior

### Acceptance Criteria
- [ ] Shared primitives are reusable across all app sections
- [ ] No section needs one-off token overrides to match B+
- [ ] Keyboard focus states are visible and consistent

### References
- `IMPLEMENTATION_MATRIX_BPLUS.md`
- `EXECUTION_CHECKLIST_BPLUS.md`

---

## Issue 2: Portfolio B+ (Desktop/Mobile + Interaction States)

**Title:** `Portfolio B+ implementation with desktop/mobile interaction parity`

**Body:**

### Scope
Implement final B+ portfolio visuals and interaction states across desktop and mobile.

### Stitch References
- Desktop Final: `ae6b7979d2e24c19aeaff0f921e618cc`
- Mobile Final: `a01b4cec3b4c43f793a28503ae86461c`
- Desktop Interaction: `a161ebadb747473ba800a807b81cbd9f`
- Mobile Interaction: `fc23e87f59154b6686b9b03a21e821cf`

### Tasks
- [ ] Match final B+ portfolio hierarchy and spacing
- [ ] Implement allocation toolbar state styling
- [ ] Implement activity row pressed feedback
- [ ] Implement sidebar/report CTA states
- [ ] Validate mobile thumb-zone and bottom-nav interaction parity

### Acceptance Criteria
- [ ] Visual parity on desktop and mobile
- [ ] Interaction parity on desktop and mobile
- [ ] No legacy cyan styles remain

---

## Issue 3: Landing B+ (Desktop/Mobile + Interaction States)

**Title:** `Landing B+ implementation with full interaction-state parity`

**Body:**

### Scope
Implement final B+ landing page visuals with desktop/mobile interaction states.

### Stitch References
- Desktop Final: `a3277b05355d4d49a28661c290551d42`
- Mobile Final: `8b9468ec41d349a69d62a3d7a544f50c`
- Desktop Interaction: `61e1f964bfdf4b9388b3d316a22fcd8f`
- Mobile Interaction: `3fe67d2d1392429e83d8f6968b8083bd`

### Tasks
- [ ] Implement hero + CTA hierarchy
- [ ] Implement feature card visual treatment
- [ ] Implement CTA and link interaction states
- [ ] Implement mobile menu/open state

### Acceptance Criteria
- [ ] Landing matches final B+ on desktop/mobile
- [ ] CTA and card interactions match companions
- [ ] Navigation and footer interactions are consistent

---

## Issue 4: Workspace/Chat B+ (Desktop/Mobile + Interaction States)

**Title:** `Workspace/Chat B+ implementation with interaction companions`

**Body:**

### Scope
Implement B+ chat shell for desktop and mobile with companion interaction states.

### Stitch References
- Desktop Final: `d772323bed5b4cc4b9ce964068cca5a9`
- Mobile Final: `7549c9da4a07426faa63de7edb61e224`
- Desktop Interaction: `95d0fcd1f9784224ab33cc9681734c1e`
- Mobile Interaction: `6c6f6aa93a4e47659759b8d584235b65`

### Tasks
- [ ] Implement chat shell layout parity
- [ ] Implement command brief visual treatment
- [ ] Implement New Chat and composer Run pressed states
- [ ] Implement thread/message row feedback
- [ ] Implement mobile menu overlay state

### Acceptance Criteria
- [ ] Desktop/mobile shell parity achieved
- [ ] Interaction-state parity achieved
- [ ] Navigation state behavior aligns with B+ system

---

## Issue 5: Funds B+ (Desktop/Mobile + Interaction States)

**Title:** `Funds B+ implementation with chips/cards/modal interaction parity`

**Body:**

### Scope
Implement B+ Funds UI for desktop/mobile with interaction-state parity.

### Stitch References
- Desktop Final: `5ece6ac429cd423b89239640e349e381`
- Mobile Final: `b9eced07254249a9907d1c19141933a3`
- Desktop Interaction: `ac1248f2ebec47fab35f0d8e434bb458`
- Mobile Interaction: `6527f959590c480fb8e207b13db3490d`

### Tasks
- [ ] Implement filter chip + KPI + card stack
- [ ] Implement chip active/hover/pressed states
- [ ] Implement fund card hover/pressed behavior
- [ ] Implement modal confirm CTA pressed state
- [ ] Validate nav transition states across breakpoints

### Acceptance Criteria
- [ ] Visual parity with final screens
- [ ] Interaction parity with companion screens
- [ ] State transitions are subtle and readable

---

## Issue 6: AgentPay B+ (Desktop/Mobile + Interaction States)

**Title:** `AgentPay B+ implementation with tab/form/modal interaction parity`

**Body:**

### Scope
Implement B+ AgentPay across desktop/mobile and interaction companions.

### Stitch References
- Desktop Final: `d67e2d834b6c484182163a0fedd871ad`
- Mobile Final: `4176c7cddf6b4411bd023487e04ac14a`
- Desktop Interaction: `5edc186ce3d641938f824857ee5ffb15`
- Mobile Interaction: `fb742d866322435cbf34e7c2d73f0b52`

### Tasks
- [ ] Implement tab rail and form hierarchy
- [ ] Implement tab active + pressed transitions
- [ ] Implement primary payment CTA pressed state
- [ ] Implement modal primary/secondary interaction states
- [ ] Implement transaction row pressed behavior

### Acceptance Criteria
- [ ] Desktop/mobile visual parity with references
- [ ] Interaction-state parity in tabs, modal, rows, nav
- [ ] No visual regressions in payment flows

---

## Issue 7: Settings B+ (Desktop/Mobile + Interaction States)

**Title:** `Settings B+ implementation with toggle and row interaction parity`

**Body:**

### Scope
Implement B+ settings section across desktop/mobile with interaction companions.

### Stitch References
- Desktop Final: `e1229a16cadc4377af9cc3b9a224fa12`
- Mobile Final: `5c94472f9f6b4f6fb752372a29e5ef98`
- Desktop Interaction: `919252dcacac445a8994a26b47693da1`
- Mobile Interaction: `c3247c82a9e14702a17d266b195e93d0`

### Tasks
- [ ] Implement integration/security/preferences visual hierarchy
- [ ] Implement toggle on/off and pressed transition cue
- [ ] Implement ghost action pressed state
- [ ] Implement row hover/pressed feedback
- [ ] Validate nav active + hover/tap differentiation

### Acceptance Criteria
- [ ] Desktop/mobile parity with final references
- [ ] Interaction-state parity for toggles/actions/rows/nav
- [ ] Accessibility states remain clear and consistent

---

## Issue 8: Final B+ Cross-Section QA and Sign-off

**Title:** `B+ final QA: cross-section consistency, accessibility, and build sign-off`

**Body:**

### Scope
Cross-section QA after all B+ implementation issues merge.

### Tasks
- [ ] Verify spacing rhythm consistency across all sections
- [ ] Verify icon stroke and visual weight consistency
- [ ] Verify CTA contrast and pressed-state consistency
- [ ] Verify chip/nav/row interaction consistency
- [ ] Verify focus-visible behavior across all interactive controls
- [ ] Verify reduced-motion behavior
- [ ] Run `npm run typecheck`
- [ ] Run `npm run build` in `agentflow-frontend`

### Acceptance Criteria
- [ ] All sections pass visual and interaction QA
- [ ] Accessibility checks pass (focus/contrast/touch targets)
- [ ] Typecheck and build pass without regressions

