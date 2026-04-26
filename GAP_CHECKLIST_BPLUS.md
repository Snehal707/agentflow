# AgentFlow B+ Route Gap Checklist

Use this checklist to close the delta between current live UI and selected Stitch references.

## Landing (`/`)

**Reference set**
- Desktop Final: `a3277b05355d4d49a28661c290551d42`
- Mobile Final: `8b9468ec41d349a69d62a3d7a544f50c`
- Desktop Interaction: `61e1f964bfdf4b9388b3d316a22fcd8f`
- Mobile Interaction: `3fe67d2d1392429e83d8f6968b8083bd`

**Current gap**
- Live page still shows legacy marketing IA/copy instead of selected B+ landing composition.

**Checklist**
- [ ] Replace legacy hero/nav/content structure with selected B+ landing structure.
- [ ] Implement B+ headline/body hierarchy and spacing cadence.
- [ ] Implement primary/secondary CTA visual system and state transitions.
- [ ] Implement feature cards and trust strip per references.
- [ ] Implement desktop + mobile nav interaction states.
- [ ] Implement footer link hover/active states.

---

## Portfolio (`/portfolio`)

**Reference set**
- Desktop Final: `ae6b7979d2e24c19aeaff0f921e618cc`
- Mobile Final: `a01b4cec3b4c43f793a28503ae86461c`
- Desktop Interaction: `a161ebadb747473ba800a807b81cbd9f`
- Mobile Interaction: `fc23e87f59154b6686b9b03a21e821cf`

**Current gap**
- Route loads and core controls exist; needs strict parity pass for typography/surface/state polish.

**Checklist**
- [ ] Match B+ spacing/surface hierarchy exactly across hero, KPI, allocation, and activity sections.
- [ ] Ensure LIVE/HOLDINGS/PNL state styling matches companion states.
- [ ] Ensure activity row pressed feedback and nav hover/active differentiation match references.
- [ ] Verify mobile thumb-zone CTA hierarchy and bottom-nav active/tap behavior.
- [ ] Validate copy and label hierarchy against selected references.

---

## Workspace / Chat (`/chat`)

**Reference set**
- Desktop Final: `d772323bed5b4cc4b9ce964068cca5a9`
- Mobile Final: `7549c9da4a07426faa63de7edb61e224`
- Desktop Interaction: `95d0fcd1f9784224ab33cc9681734c1e`
- Mobile Interaction: `6c6f6aa93a4e47659759b8d584235b65`

**Current gap**
- Shell is live; visual language and interaction nuance still not fully at final B+ parity.

**Checklist**
- [ ] Align chat shell typography, panel hierarchy, and spacing with final desktop/mobile references.
- [ ] Implement explicit pressed states for New Chat and composer Run actions.
- [ ] Implement thread/message row hover/pressed feedback as specified.
- [ ] Implement mobile menu/open overlay parity.
- [ ] Align top nav/sidebar state differentiation with interaction companions.

---

## Funds (`/funds`)

**Reference set**
- Desktop Final: `5ece6ac429cd423b89239640e349e381`
- Mobile Final: `b9eced07254249a9907d1c19141933a3`
- Desktop Interaction: `ac1248f2ebec47fab35f0d8e434bb458`
- Mobile Interaction: `6527f959590c480fb8e207b13db3490d`

**Current gap**
- Page renders but remains shallow/minimal; lacks full B+ compositional depth and state richness.

**Checklist**
- [ ] Implement full B+ page composition (filters, KPI strip, richer fund cards).
- [ ] Implement chip active/hover/pressed states per interaction references.
- [ ] Implement card hover/pressed row feedback.
- [ ] Implement allocation modal visual and pressed confirm behavior.
- [ ] Ensure desktop sidebar and mobile bottom-nav transition parity.

---

## AgentPay (`/pay`)

**Reference set**
- Desktop Final: `d67e2d834b6c484182163a0fedd871ad`
- Mobile Final: `4176c7cddf6b4411bd023487e04ac14a`
- Desktop Interaction: `5edc186ce3d641938f824857ee5ffb15`
- Mobile Interaction: `fb742d866322435cbf34e7c2d73f0b52`

**Current gap**
- Route loads but still primarily gate/default content; lacks full B+ transactional layout depth.

**Checklist**
- [ ] Implement final tab/form/panel composition from selected desktop/mobile references.
- [ ] Implement tab active + pressed transition states.
- [ ] Implement primary CTA pressed behavior and modal state behavior.
- [ ] Implement transaction list row press feedback and hierarchy styling.
- [ ] Align nav state transitions with interaction companions.

---

## Settings (`/settings`)

**Reference set**
- Desktop Final: `e1229a16cadc4377af9cc3b9a224fa12`
- Mobile Final: `5c94472f9f6b4f6fb752372a29e5ef98`
- Desktop Interaction: `919252dcacac445a8994a26b47693da1`
- Mobile Interaction: `c3247c82a9e14702a17d266b195e93d0`

**Current gap**
- Route renders but remains wallet-gated/basic; lacks full B+ settings card/toggle system richness.

**Checklist**
- [ ] Implement full B+ settings section composition (integration/security/preferences cards).
- [ ] Implement toggle on/off with pressed transition cues.
- [ ] Implement ghost action pressed style and row hover/pressed feedback.
- [ ] Align desktop/mobile nav state behavior with companions.
- [ ] Verify copy hierarchy and spacing parity with references.

---

## Cross-Route Global Gaps

- [ ] Remove remaining legacy brand/copy traces where they conflict with chosen B+ references.
- [ ] Ensure no cyan accent regressions remain.
- [ ] Enforce consistent icon stroke weight and optical alignment across sections.
- [ ] Enforce consistent CTA contrast and pressed-state behavior across sections.
- [ ] Validate focus-visible + reduced-motion behavior globally.
- [ ] Re-run visual QA on all routes after each section merge.

