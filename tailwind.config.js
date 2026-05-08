/** @type {import('tailwindcss').Config} */
// Q1 color palette ported from v1 (Blueprint-Dashboard-/index.html lines 46-57).
// Keeps visual identity. Each stage color (de/pm/co/jv/is) gets a tone group:
//   `de` → primary, `de-bg` → tinted background, `de-border` → mid-tone border.
// Use as `bg-de`, `bg-de-bg`, `border-de-border`, `text-de`, etc.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Chrome
        bg: '#f0f4f8',
        surface: '#ffffff',
        s2: '#e8edf3',
        s3: '#dce3ec',
        border: '#c8d3e0',
        text: '#1a2540',
        muted: '#5a6a85',
        dim: '#8a9bb5',

        // Design/Entitlements (blue)
        de: { DEFAULT: '#2563eb', bg: '#dbeafe', border: '#93c5fd' },
        // Permitting (green)
        pm: { DEFAULT: '#059669', bg: '#d1fae5', border: '#6ee7b7' },
        // Corrections (orange)
        co: { DEFAULT: '#d97706', bg: '#fef3c7', border: '#fcd34d' },
        // Reports / JV accent (purple)
        jv: { DEFAULT: '#7c3aed', bg: '#ede9fe', border: '#c4b5fd' },
        // Issued (teal)
        is: { DEFAULT: '#0891b2', bg: '#cffafe', border: '#67e8f9' },

        // Role tints
        ent: '#0284c7',
        arch: '#ea580c',
        miles: { bg: '#e0f2fe', c: '#0369a1' },
        bri: { bg: '#fce7f3', c: '#be185d' },
      },
      fontFamily: {
        // Used for body copy
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Used for headings + buttons + selects (matches v1's display font)
        display: ['Syne', 'sans-serif'],
        // Reserved for tabular/data contexts
        mono: ['DM Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
