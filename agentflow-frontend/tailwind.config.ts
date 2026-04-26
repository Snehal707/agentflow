import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Stitch B+ Luxe palette — canonical token set
        primary: "#f2ca50",
        "primary-container": "#d4af37",
        "primary-fixed": "#ffe088",
        "primary-fixed-dim": "#e9c349",
        "on-primary": "#3c2f00",
        "on-primary-container": "#554300",
        secondary: "#eac249",
        "secondary-container": "#b08c10",
        "secondary-fixed": "#ffe08b",
        "secondary-fixed-dim": "#eac249",
        "on-secondary": "#3d2f00",
        "on-secondary-container": "#352800",
        surface: "#131313",
        "surface-dim": "#131313",
        "surface-bright": "#3a3939",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "surface-container-highest": "#353534",
        "surface-variant": "#353534",
        "surface-tint": "#e9c349",
        "on-surface": "#e5e2e1",
        "on-surface-variant": "#d0c5af",
        background: "#131313",
        "on-background": "#e5e2e1",
        outline: "#99907c",
        "outline-variant": "#4d4635",
        "inverse-surface": "#e5e2e1",
        "inverse-on-surface": "#313030",
        "inverse-primary": "#735c00",
        // Shorthand tokens used throughout components
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
      fontFamily: {
        headline: ["var(--font-headline)", "Newsreader", "Georgia", "serif"],
        body: ["var(--font-body)", "Manrope", "sans-serif"],
        label: ["var(--font-body)", "Manrope", "sans-serif"],
        // legacy aliases kept for backwards compat
        display: ["var(--font-headline)", "Newsreader", "Georgia", "serif"],
        sans: ["var(--font-body)", "Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-headline)", "Newsreader", "Georgia", "serif"],
      },
      boxShadow: {
        "af-soft": "0 8px 24px rgba(212,175,55,0.12)",
        "af-press": "0 4px 12px rgba(212,175,55,0.16)",
        "af-card": "0 20px 40px -15px rgba(0,0,0,0.4)",
        "af-glow": "0 0 20px -5px rgba(242,202,80,0.3)",
        "cinematic": "0 25px 50px -12px rgba(0,0,0,0.7)",
      },
      borderRadius: {
        af: "10px",
        "af-lg": "14px",
        DEFAULT: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px",
      },
      transitionTimingFunction: {
        af: "cubic-bezier(0.22,0.61,0.36,1)",
      },
      letterSpacing: {
        widest: "0.2em",
        ultrawide: "0.4em",
      },
      typography: {
        invert: {
          css: {
            "--tw-prose-body": "rgba(255, 255, 255, 0.78)",
            "--tw-prose-headings": "#f4f6f8",
            "--tw-prose-links": "#8cc8ff",
            "--tw-prose-bold": "#f4f6f8",
            "--tw-prose-code": "#92f0bf",
            "--tw-prose-pre-bg": "rgba(0, 0, 0, 0.3)",
          },
        },
      },
    },
  },
  plugins: [typography],
};
export default config;
