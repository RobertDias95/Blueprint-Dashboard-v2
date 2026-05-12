/** @type {import('tailwindcss').Config} */
// Q1 color palette ported from v1 (Blueprint-Dashboard-/index.html:46-57).
// Q9.5.b: typography simplified to system-sans-everywhere per Bobby's
// call — `sans`, `display`, and `mono` all now resolve to OS-native
// stacks. The `font-display` class is kept as a no-op so existing
// usage doesn't need a sweep; it just renders the same family as
// `font-sans` now. Box-shadow tokens added to bind the per-surface
// shadows from v1 (matching the CSS vars in index.css :root).
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
        // Q9.5.b: system-sans-everywhere. All three families resolve to
        // the same OS-native sans stack. Keeping `display` + `mono`
        // entries means existing `font-display` / `font-mono` Tailwind
        // class usages don't need a code sweep; they just render the
        // body font now. (`.font-mono` class is overridden in
        // index.css base layer for true monospace contexts.)
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SF Mono',
          'Monaco',
          'Cascadia Code',
          'Roboto Mono',
          'monospace',
        ],
      },
      boxShadow: {
        // Per-surface tokens matching :root CSS vars in index.css.
        fab: '0 4px 24px rgba(59, 130, 246, .4)',
        'block-hover': '0 2px 8px rgba(0, 0, 0, .15)',
        modal: '0 20px 60px rgba(0, 0, 0, 0.3)',
        dropdown: '0 8px 24px rgba(0, 0, 0, .4)',
        popup: '0 4px 24px rgba(0, 0, 80, .15)',
      },
    },
  },
  plugins: [],
};
