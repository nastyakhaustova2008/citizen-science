/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Muted, adult "forest" palette. Warm paper ground, deep evergreen ink.
        paper: {
          DEFAULT: '#F7F4ED', // warm beige-cream background
          raised: '#FFFDF8', // cards / raised surfaces
          sunk: '#EFEBE0', // inset areas
        },
        ink: {
          DEFAULT: '#1F3A2E', // deep dark green — text & primary accents
          soft: '#33493D',
          faint: '#5C6B60',
        },
        moss: {
          DEFAULT: '#5A7A5F', // muted moss — secondary elements
          light: '#7C9880',
          dark: '#43604A',
        },
        bark: {
          DEFAULT: '#8B6F47', // bark / ochre — accent buttons
          light: '#A98A5E',
          dark: '#6E5638',
        },
        edge: {
          DEFAULT: '#D7D0BF', // warm grey-green borders
          strong: '#C2BBA6',
        },
        // Dark theme: charcoal ground, same greens.
        char: {
          DEFAULT: '#1A1C19', // charcoal background
          raised: '#232622',
          sunk: '#141613',
        },
        // Semantic (kept muted, AA on paper/char)
        ok: '#4F7A52',
        warn: '#B8862F',
        danger: '#A6462F',
      },
      fontFamily: {
        // Serif for headings, grotesque for UI/data, mono for numbers.
        serif: ['"Frank Ruhl Libre"', '"Noto Serif Hebrew"', 'Georgia', 'serif'],
        sans: ['"Assistant"', '"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Roboto Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '10px',
        xl: '12px',
      },
      fontSize: {
        'data-xs': ['0.75rem', { lineHeight: '1rem' }],
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
      maxWidth: {
        content: '1180px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-end': {
          from: { transform: 'translateX(8px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in-end': 'slide-in-end 180ms ease-out',
      },
    },
  },
  plugins: [],
};
