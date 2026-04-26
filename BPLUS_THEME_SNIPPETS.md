# AgentFlow B+ Theme Snippets (CSS + Tailwind)

Use this as a copy-paste starter for implementing the B+ luxe interaction system in the frontend.

## 1) CSS Variables (global tokens)

```css
:root {
  /* Core palette */
  --af-bg: #131313;
  --af-surface-low: #1c1b1b;
  --af-surface-mid: #201f1f;
  --af-surface-high: #2a2a2a;

  /* Text */
  --af-text-primary: #e5e2e1;
  --af-text-secondary: #d0c5af;

  /* Brand gold */
  --af-gold: #f2ca50;
  --af-gold-press: #d4af37;

  /* Stroke fallback */
  --af-outline-soft: rgba(77, 70, 53, 0.35);

  /* Focus */
  --af-focus-ring: rgba(242, 202, 80, 0.55);

  /* Radius */
  --af-radius-md: 10px;
  --af-radius-lg: 14px;

  /* Motion */
  --af-ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  --af-speed-fast: 120ms;
  --af-speed-base: 160ms;
  --af-speed-slow: 180ms;

  /* Shadows (restrained, warm) */
  --af-shadow-soft: 0 8px 24px rgba(212, 175, 55, 0.12);
  --af-shadow-press: 0 4px 12px rgba(212, 175, 55, 0.16);
}
```

## 2) Base helpers (plain CSS)

```css
.af-surface {
  background: var(--af-surface-mid);
  color: var(--af-text-primary);
  border-radius: var(--af-radius-md);
}

.af-focusable:focus-visible {
  outline: 2px solid var(--af-focus-ring);
  outline-offset: 2px;
}

.af-transition {
  transition:
    background-color var(--af-speed-base) var(--af-ease),
    color var(--af-speed-base) var(--af-ease),
    border-color var(--af-speed-base) var(--af-ease),
    box-shadow var(--af-speed-base) var(--af-ease),
    transform var(--af-speed-fast) var(--af-ease);
}
```

## 3) Button state patterns

```css
.af-btn-primary {
  background: linear-gradient(135deg, var(--af-gold), var(--af-gold-press));
  color: #3c2f00;
  border: 0;
  border-radius: var(--af-radius-md);
  box-shadow: var(--af-shadow-soft);
}

.af-btn-primary:hover {
  filter: brightness(1.04);
}

.af-btn-primary:active,
.af-btn-primary[data-state="pressed"] {
  background: var(--af-gold-press);
  box-shadow: var(--af-shadow-press);
  transform: translateY(1px);
}

.af-btn-ghost {
  background: transparent;
  color: var(--af-text-primary);
  border: 1px solid var(--af-outline-soft);
  border-radius: var(--af-radius-md);
}

.af-btn-ghost:hover {
  background: rgba(242, 202, 80, 0.08);
  border-color: rgba(242, 202, 80, 0.35);
}

.af-btn-ghost:active {
  background: rgba(242, 202, 80, 0.14);
}
```

## 4) Nav, chips, rows (state examples)

```css
.af-nav-item {
  color: var(--af-text-secondary);
}

.af-nav-item:hover {
  color: var(--af-text-primary);
}

.af-nav-item[data-state="active"] {
  color: var(--af-gold);
}

.af-chip {
  background: var(--af-surface-low);
  border: 1px solid transparent;
  color: var(--af-text-secondary);
}

.af-chip:hover {
  border-color: var(--af-outline-soft);
  color: var(--af-text-primary);
}

.af-chip[data-state="active"] {
  border-color: rgba(242, 202, 80, 0.45);
  color: var(--af-gold);
  background: rgba(242, 202, 80, 0.08);
}

.af-row:active,
.af-row[data-state="pressed"] {
  background: var(--af-surface-high);
}
```

## 5) Tailwind config extension (example)

Add to `tailwind.config` theme extension:

```ts
extend: {
  colors: {
    af: {
      bg: "#131313",
      surfaceLow: "#1c1b1b",
      surface: "#201f1f",
      surfaceHigh: "#2a2a2a",
      text: "#e5e2e1",
      textMuted: "#d0c5af",
      gold: "#f2ca50",
      goldPress: "#d4af37",
    },
  },
  boxShadow: {
    "af-soft": "0 8px 24px rgba(212,175,55,0.12)",
    "af-press": "0 4px 12px rgba(212,175,55,0.16)",
  },
  borderRadius: {
    af: "10px",
    "af-lg": "14px",
  },
  transitionTimingFunction: {
    af: "cubic-bezier(0.22,0.61,0.36,1)",
  },
}
```

## 6) Tailwind utility recipes

### Primary CTA

```html
<button
  class="rounded-af bg-gradient-to-br from-af-gold to-af-goldPress px-5 py-3 text-sm font-semibold text-[#3c2f00] shadow-af-soft transition-all duration-150 ease-af hover:brightness-105 active:translate-y-px active:shadow-af-press"
>
  Run AI Brief
</button>
```

### Secondary ghost CTA

```html
<button
  class="rounded-af border border-[#4d463559] bg-transparent px-5 py-3 text-sm font-medium text-af-text transition-all duration-150 ease-af hover:border-[#f2ca5059] hover:bg-[#f2ca5014] active:bg-[#f2ca5024]"
>
  Request Credentials
</button>
```

### Active nav item

```html
<a class="text-af-gold">Portfolio</a>
```

### Hover nav item

```html
<a class="text-af-textMuted transition-colors duration-150 ease-af hover:text-af-text">Market Insights</a>
```

### Active chip

```html
<button class="rounded-af border border-[#f2ca5073] bg-[#f2ca5014] px-3 py-2 text-xs text-af-gold">
  Asset Allocation
</button>
```

## 7) Accessibility and reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  .af-transition,
  .af-btn-primary,
  .af-btn-ghost {
    transition: background-color var(--af-speed-fast) linear,
      color var(--af-speed-fast) linear,
      border-color var(--af-speed-fast) linear;
    transform: none !important;
  }
}
```

Implementation note: keep state differences visible but restrained; premium feel comes from consistency, not large effects.
