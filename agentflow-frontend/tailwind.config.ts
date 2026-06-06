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
        primary: "#6366f1",
        accent: "#22d3ee",
        surface: "#1a1a2e",
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
