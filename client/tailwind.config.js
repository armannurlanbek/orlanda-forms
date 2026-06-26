/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
