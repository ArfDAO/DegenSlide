/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'aurora-magenta': '#995bb9',
        'deep-iris': '#5b638c',
        'midnight-ink': '#1d2630',
        'obsidian': '#000000',
        'lavender-mist': '#e0dde2',
        'paper-white': '#ffffff',
        'frost-shadow': '#f0f0f0',
        'pebble': '#9aa1b2',
        'silver-lining': '#a5afcb',
        'cloud-veil': '#abbdcf',
        'tidewater-navy': '#3a4766',
        'aurora-green': '#69c966',
      },
      fontFamily: {
        sans: ['"averta standard"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"averta standard"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'cards': '18px',
        'buttons': '100px',
        'asymmetric': '34px',
        'decorative': '22px',
      },
      boxShadow: {
        'md': 'rgba(97, 110, 124, 0.114) 0px 4px 15px 0px, rgba(255, 255, 255, 0.39) 0px 1px 1px 0px inset, rgba(34, 50, 94, 0.08) 0px 1px 1px 0px',
      },
    },
  },
  plugins: [],
};

