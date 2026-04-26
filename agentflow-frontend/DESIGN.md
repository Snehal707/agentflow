# Design System Document: The Sovereign Command

## 1. Overview & Creative North Star
### Creative North Star: "The Private Atelier"
This design system rejects the "SaaS dashboard" aesthetic in favor of a high-end editorial experience. It is designed to feel like a bespoke wealth management suite—private, authoritative, and tranquil. We move beyond the "template" look by utilizing intentional asymmetry, expansive negative space (luxury is found in the margins), and a focus on tonal depth over structural lines.

**Editorial Foundations:**
- **Asymmetric Balance:** Avoid perfect symmetry. Let data visualizations breathe with generous, off-center padding.
- **Micro-Interactions:** Every transition should feel weighted and deliberate, mimicking the tactile feel of high-quality physical materials.
- **The Glow:** Light is treated as a physical medium. Warm, golden glows emanate from "active" high-value data points, creating a sense of living wealth.

---

## 2. Colors: Tonal Architecture
The palette is rooted in a "Luxury Black" ecosystem, utilizing metallic gold accents to guide the eye toward critical actions and growth metrics.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning. Boundaries must be defined through:
- **Background Color Shifts:** Placing a `surface_container_low` card against a `surface` background.
- **Tonal Transitions:** Using subtle variations in the container tiers to imply edge without a line.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following hierarchy to create "nested" depth:
- **Base Layer:** `background` (#131313).
- **Primary Sections:** `surface_container_low` (#1c1b1b).
- **Interactive Cards:** `surface_container` (#201f1f).
- **Floating Overlays/Modals:** `surface_container_highest` (#353534).

### The "Glass & Gold" Rule
To achieve professional polish, utilize Glassmorphism for floating elements (e.g., navigation sidebars or global filters). 
- Use semi-transparent `surface_variant` with a 20px `backdrop-blur`.
- **Signature Texture:** For main CTAs, apply a linear gradient from `primary` (#f2ca50) to `primary_container` (#d4af37) at a 45-degree angle to simulate the shimmer of brushed gold.

---

## 3. Typography: The Editorial Voice
We employ a sophisticated pairing of **Newsreader** (Serif) and **Manrope** (Sans-Serif) to balance heritage with modern precision.

*   **Display & Headlines (Newsreader):** Used for large data summaries and section headers. The serif high-contrast strokes convey prestige and "Old Money" reliability.
*   **Body & Titles (Manrope):** Used for functional data, labels, and secondary information. The geometric sans-serif ensures maximum readability for complex financial figures.
*   **Hierarchy as Identity:** Use `display-lg` sparingly to highlight "Total Net Worth" or "Portfolio Alpha." The drastic scale difference between `display-lg` and `label-sm` creates the signature editorial look.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows and borders are replaced with "Atmospheric Depth."

- **The Layering Principle:** Depth is achieved by stacking. A `surface_container_lowest` (#0e0e0e) element "carves" into the interface, while a `surface_container_high` (#2a2a2a) element "rises" out of it.
- **Ambient Shadows:** When a float is required, use a shadow with a blur radius of 40px+, at 6% opacity, using the `primary_container` color. This creates a "warm glow" rather than a grey shadow.
- **The Ghost Border Fallback:** If a border is required for accessibility, use the `outline_variant` (#4d4635) at **15% opacity**. Never use 100% opaque lines.

---

## 5. Components: Refined Interaction

### Buttons
- **Primary:** Gradient-filled (`primary` to `primary_container`), `roundness-md` (0.375rem). No border. Type: `label-md` in `on_primary`.
- **Secondary:** Transparent background with a "Ghost Border" of `outline`. Hover state triggers a subtle `surface_bright` fill.
- **Tertiary:** Text-only in `primary`. No container. Use for low-emphasis actions like "View More."

### Input Fields
- Avoid boxed inputs. Use a "Soft Underline" approach: a `surface_container_high` background with a subtle highlight on the bottom edge using `primary` only when focused.
- Labels (`label-sm`) should be persistent and set in `on_surface_variant`.

### Cards & Lists
- **The Borderless Rule:** Cards are distinguished solely by their background tier (e.g., `surface_container_low`).
- **Lists:** Forbid divider lines. Use `1.5rem` (24px) of vertical white space to separate list items. The eye will naturally group elements based on proximity.

### Iconography (Custom Geometric Motifs)
- **Thin-Line Quality:** All icons must be 1.5px stroke weight.
- **Motifs:** Use the *Spark* for insights, *Shield* for security, *Orbit* for total assets, and *Pulse* for live market movements. Icons should be `primary` (#f2ca50) when active.

### Additional Premium Component: The "Growth Glow" Graph
- Line charts should use a `primary` stroke. 
- Area charts should use a gradient fill from `primary` (20% opacity) at the top to `transparent` at the baseline, creating a luminous "rising" effect.

---

## 6. Do’s and Don’ts

### Do:
- Use `display-md` (Newsreader) for the primary "Hero" number on any page.
- Use `surface_container_lowest` to create a "well" effect for data entry areas.
- Leverage `primary_fixed_dim` for non-critical status indicators to maintain the gold theme without over-powering the UI.

### Don’t:
- **No Pure White:** Never use #FFFFFF. Use `on_surface` (#e5e2e1) to keep the contrast high but the tone sophisticated.
- **No Sharp Corners:** Never use `none` or `sm` rounding for containers; stick to `md` (0.375rem) or `lg` (0.5rem) to maintain the "refined" feel.
- **No Crowding:** If you think a section needs a divider, it likely needs more padding instead. Add `1rem` of space before adding any visual separator.