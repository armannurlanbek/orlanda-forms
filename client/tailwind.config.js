/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // hover: styles apply only on devices that truly support hover, so a tapped
  // button on touch devices never gets "stuck" in its hover state (§ mobile).
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        // Public-form theme tokens map to CSS variables set per-form (§17.8).
        brand: {
          primary: 'var(--color-primary)',
          onPrimary: 'var(--color-on-primary)',
          bg: 'var(--color-bg)',
          text: 'var(--color-text)',
          focus: 'var(--color-focus)',
        },
        // Builder/admin chrome accent (fixed indigo — NOT the per-form theme).
        // Used for primary actions, focus rings, active states, gradient headers.
        accent: {
          DEFAULT: '#4f46e5', // indigo-600
          hover: '#4338ca', // indigo-700
          fg: '#ffffff',
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.08)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25), 0 4px 8px rgb(15 23 42 / 0.08)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
      minHeight: {
        tap: '44px',
      },
      minWidth: {
        tap: '44px',
      },
    },
  },
  plugins: [],
};
