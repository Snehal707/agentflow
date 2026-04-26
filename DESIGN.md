# Design System Strategy: AgentFlow V3

## 1. Overview & Creative North Star
**Creative North Star: "The Kinetic Obsidian"**

AgentFlow V3 is not a generic dashboard; it is a high-performance command center for artificial intelligence. The design system moves away from "flat" digital interfaces toward **Atmospheric Depth**. By blending the void-like qualities of deep charcoals with the high-energy pulse of electric blue, we create an environment that feels both infinitely vast and hyper-focused.

To break the "template" look, we utilize **Intentional Asymmetry**. Primary navigation and utility panels should not always mirror each other in width or weight. We use overlapping surfaces and varying translucency to suggest that the UI is a living, breathing stack of data layers rather than a static grid.

---

## 2. Colors & Surface Logic
The palette is rooted in a "Black-Ops" aesthetic—stealthy, professional, and expensive.

*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for structural sectioning. To separate a sidebar from a main content area, do not draw a line. Instead, shift the background from `surface` (#0c0e12) to `surface_container_low` (#111318). Boundaries are felt through tonal shifts, not seen through strokes.
*   **Surface Hierarchy & Nesting:** Treat the UI as physical layers. 
    *   **The Foundation:** Use `surface` (#0c0e12) for the primary application backdrop.
    *   **The Inset:** Use `surface_container_lowest` (#000000) for "well" elements like terminal outputs or code blocks to suggest depth.
    *   **The Projection:** Use `surface_container_high` (#1d2025) for active workspace modules that need to feel "closer" to the user.
*   **The "Glass & Gradient" Rule:** For floating modals or popovers, use `surface_container_highest` with a 60-80% opacity and a `20px` backdrop-blur. 
*   **Signature Textures:** For primary actions, never use a flat color. Apply a subtle linear gradient (45-degree) from `primary` (#69daff) to `primary_container` (#00cffc). This creates a "neon tube" luminosity that feels high-end and technical.

---

## 3. Typography
We utilize a dual-typeface system to balance "Editorial Authority" with "Technical Precision."

*   **Display & Headlines (Manrope):** Used for high-level data points and section titles. Manrope’s geometric nature feels engineered. 
    *   *Usage:* `headline-lg` (2rem) should be used sparingly to define major workspace transitions.
*   **Interface & Body (Inter):** Inter is our workhorse. It is chosen for its exceptional legibility in dark modes.
    *   *Hierarchy:* Use `label-md` (0.75rem) in `on_surface_variant` (#aaabb0) for metadata to ensure the "Technical" feel doesn't become cluttered.
*   **Tonal Contrast:** To move beyond the "template" look, maximize contrast between `title-lg` (Inter, 1.375rem) and `label-sm` (Inter, 0.6875rem). This "Big and Small" approach creates an editorial rhythm often found in high-end print magazines.

---

## 4. Elevation & Depth
Depth in this system is achieved through **Tonal Layering** rather than traditional drop shadows.

*   **The Layering Principle:** To lift a card, move it one step up the surface scale (e.g., a `surface_container_low` card sitting on a `surface` background). This creates a soft, natural lift.
*   **Ambient Shadows:** If a component must float (like a context menu), use an extra-diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4)`. The shadow should feel like a soft glow of "nothingness" beneath the element.
*   **The "Ghost Border":** For interactive elements like input fields, use a `1px` border using the `outline_variant` (#46484d) at **20% opacity**. It should be invisible at a glance but provide a "hint" of structure when the eye focuses on it.
*   **Glassmorphism:** Use `backdrop-filter: blur(12px)` on all overlay elements. This allows the electric blue accents from the background to bleed through, ensuring the UI feels integrated and fluid.

---

## 5. Components

### Buttons
*   **Primary:** Gradient of `primary` to `primary_container`. Text color `on_primary`. Roundedness: `md` (0.375rem). No border.
*   **Secondary:** Ghost style. Background `surface_container_high` at 40% opacity. `1px` Ghost Border (20% `outline_variant`).
*   **Tertiary:** Text only in `primary` (#69daff), used for low-priority actions like "Cancel."

### Input Fields
*   **Style:** Background `surface_container_lowest` (#000000). Border `outline_variant` at 20%.
*   **Focus State:** Border becomes `primary` (#69daff) at 100% opacity with a subtle `2px` outer glow (0% blur).

### Chips & Status Indicators
*   **Status:** Instead of a solid circle, use a "pulsing" dot using `secondary` (#10d5ff).
*   **Selection Chips:** Use `surface_container_highest` for unselected and `primary_container` with 20% opacity for selected.

### Cards & Lists
*   **Zero Dividers:** Never use horizontal lines to separate list items. Use the **Spacing Scale** `spacing-4` (0.9rem) to create clear air between items. If separation is needed, use a subtle background hover state shift to `surface_container_low`.

### AI Logic Nodes (Custom Component)
*   **Style:** `surface_container_high` with a 10% `primary` tint. Use `xl` (0.75rem) rounding to distinguish "Agent" logic from standard "UI" boxes.

---

## 6. Do's and Don'ts

### Do
*   **Do** use `surface_container_lowest` for background areas where "data" lives (code, logs, charts).
*   **Do** use `primary_fixed_dim` (#00c0ea) for icons to give them a "dimmed neon" look that doesn't distract from the text.
*   **Do** leverage asymmetry—let the right-side utility panel be narrower than the left-side navigation.

### Don't
*   **Don't** use pure white (#FFFFFF) for text. Always use `on_surface` (#f6f6fc) to prevent eye strain in dark mode.
*   **Don't** use standard `1px` borders to define the grid. If the layout feels "mushy," increase the contrast between your `surface` tiers instead.
*   **Don't** use high-opacity shadows. Shadows should be felt, not seen as a "black smudge."

---

## 7. Selected Stitch IDs (B+ Final)

Use these as the implementation and QA source of truth across sections.

| Section | Desktop Final B+ | Mobile Final B+ | Desktop Interaction | Mobile Interaction |
|---|---|---|---|---|
| Portfolio | `ae6b7979d2e24c19aeaff0f921e618cc` | `a01b4cec3b4c43f793a28503ae86461c` | `a161ebadb747473ba800a807b81cbd9f` | `fc23e87f59154b6686b9b03a21e821cf` |
| Landing | `a3277b05355d4d49a28661c290551d42` | `8b9468ec41d349a69d62a3d7a544f50c` | `61e1f964bfdf4b9388b3d316a22fcd8f` | `3fe67d2d1392429e83d8f6968b8083bd` |
| Workspace / Chat | `d772323bed5b4cc4b9ce964068cca5a9` | `7549c9da4a07426faa63de7edb61e224` | `95d0fcd1f9784224ab33cc9681734c1e` | `6c6f6aa93a4e47659759b8d584235b65` |
| Funds | `5ece6ac429cd423b89239640e349e381` | `b9eced07254249a9907d1c19141933a3` | `ac1248f2ebec47fab35f0d8e434bb458` | `6527f959590c480fb8e207b13db3490d` |
| AgentPay | `d67e2d834b6c484182163a0fedd871ad` | `4176c7cddf6b4411bd023487e04ac14a` | `5edc186ce3d641938f824857ee5ffb15` | `fb742d866322435cbf34e7c2d73f0b52` |
| Settings | `e1229a16cadc4377af9cc3b9a224fa12` | `5c94472f9f6b4f6fb752372a29e5ef98` | `919252dcacac445a8994a26b47693da1` | `c3247c82a9e14702a17d266b195e93d0` |