# AgentFlow B+ Implementation Matrix

This matrix maps approved Stitch screens to implementation targets in `agentflow-frontend` and defines build priority for each section.

## 1) Source of Truth Screens

### Portfolio
- Desktop Final B+: `ae6b7979d2e24c19aeaff0f921e618cc`
- Mobile Final B+: `a01b4cec3b4c43f793a28503ae86461c`
- Desktop Interaction States: `a161ebadb747473ba800a807b81cbd9f`
- Mobile Interaction States: `fc23e87f59154b6686b9b03a21e821cf`

### Landing
- Desktop Final B+: `a3277b05355d4d49a28661c290551d42`
- Mobile Final B+: `8b9468ec41d349a69d62a3d7a544f50c`
- Desktop Interaction States: `61e1f964bfdf4b9388b3d316a22fcd8f`
- Mobile Interaction States: `3fe67d2d1392429e83d8f6968b8083bd`

### Workspace / Chat
- Desktop Final B+: `d772323bed5b4cc4b9ce964068cca5a9`
- Mobile Final B+: `7549c9da4a07426faa63de7edb61e224`
- Desktop Interaction States: `95d0fcd1f9784224ab33cc9681734c1e`
- Mobile Interaction States: `6c6f6aa93a4e47659759b8d584235b65`

### Funds
- Desktop Final B+: `5ece6ac429cd423b89239640e349e381`
- Mobile Final B+: `b9eced07254249a9907d1c19141933a3`
- Desktop Interaction States: `ac1248f2ebec47fab35f0d8e434bb458`
- Mobile Interaction States: `6527f959590c480fb8e207b13db3490d`

### AgentPay
- Desktop Final B+: `d67e2d834b6c484182163a0fedd871ad`
- Mobile Final B+: `4176c7cddf6b4411bd023487e04ac14a`
- Desktop Interaction States: `5edc186ce3d641938f824857ee5ffb15`
- Mobile Interaction States: `fb742d866322435cbf34e7c2d73f0b52`

### Settings
- Desktop Final B+: `e1229a16cadc4377af9cc3b9a224fa12`
- Mobile Final B+: `5c94472f9f6b4f6fb752372a29e5ef98`
- Desktop Interaction States: `919252dcacac445a8994a26b47693da1`
- Mobile Interaction States: `c3247c82a9e14702a17d266b195e93d0`

## 2) Build Order (Do This First)

1. **Shared foundation**
   - Theme tokens (`globals.css`, `tailwind.config.ts`)
   - Reusable state classes (`af-btn-primary`, `af-btn-ghost`, `af-chip`, `af-row`, `af-nav-item`)
   - Shared typography and spacing scale

2. **App shell primitives**
   - Sidebar/top-nav states (active, hover, pressed)
   - Bottom navigation mobile active/tap states
   - Surface hierarchy and card primitives

3. **Section-by-section implementation**
   - Portfolio
   - Landing
   - Workspace/Chat
   - Funds
   - AgentPay
   - Settings

4. **Cross-device parity pass**
   - Verify desktop/mobile spacing rhythm
   - Verify interaction parity from companion screens

5. **Accessibility + QA**
   - Focus-visible coverage
   - Contrast checks
   - Touch target checks on mobile

## 3) Component Matrix by Section

## Portfolio (`agentflow-frontend/app/(app)/portfolio/page.tsx`)
- **Build first**
  - Hero/KPI card stack
  - Allocation module + toolbar chips
  - Activity feed rows
  - Sidebar report and CTA pair
- **Required states**
  - Toolbar chip active/inactive/pressed
  - Primary CTA hover/pressed
  - Activity row pressed
  - Nav active + hover differentiation

## Landing (`agentflow-frontend/app/page.tsx` or landing entry)
- **Build first**
  - Hero + CTA group
  - Feature card grid
  - Trust strip + footer links
- **Required states**
  - Primary and secondary CTA hover/pressed
  - Feature card hover elevation
  - Footer link hover/active

## Workspace / Chat (`agentflow-frontend/app/(app)/chat/page.tsx`)
- **Build first**
  - Chat shell (header, feed, composer)
  - Command brief panel/card
  - Mobile menu/open overlay handling
- **Required states**
  - New Chat pressed
  - Composer run action pressed
  - Thread/message row hover/pressed
  - Desktop nav active+hover and mobile nav tap transitions

## Funds (`agentflow-frontend/app/(app)/funds/page.tsx`)
- **Build first**
  - Filter chip row + search
  - KPI strip/cards
  - Fund cards + allocation modal
- **Required states**
  - Chip active/hover/pressed
  - Fund card hover lift / row press
  - Allocate and confirm CTA pressed
  - Nav active + hover (desktop), tap transition (mobile)

## AgentPay (`agentflow-frontend/app/(app)/pay/page.tsx`)
- **Build first**
  - Tab rail (Send/Receive/Requests/History)
  - Send form + preview/confirm modal
  - Recent transactions list
- **Required states**
  - Tabs active + pressed transition
  - Primary CTA pressed
  - Modal primary/secondary pressed
  - Transaction row pressed
  - Desktop and mobile nav transition states

## Settings (`agentflow-frontend/app/(app)/settings/page.tsx`)
- **Build first**
  - Integration cards
  - Toggle rows and preference lists
  - Security/privacy cards
- **Required states**
  - Toggle on/off + pressed transition cue
  - Ghost action pressed
  - Row hover/pressed
  - Nav active + hover/tap differentiation

## 4) Definition of Done (Per Section)

- Screen matches final B+ reference for desktop and mobile.
- Interaction states match desktop/mobile interaction companions.
- No cyan accents or legacy neon styling remains.
- Visual hierarchy follows B+ surface tiers and restrained gold usage.
- Keyboard focus-visible and mobile touch targets are validated.

