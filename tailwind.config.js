/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0A0B0D',
        'bg-surface': '#141519',
        'bg-elevated': '#1C1D22',
        'bg-hover': '#242529',
        'text-primary': '#FFFFFF',
        'text-secondary': '#8A8F98',
        'text-tertiary': '#4E535C',
        'accent-blue': '#1652F0',
        'accent-blue-light': '#2D6BFF',
        'color-up': '#05B169',
        'color-down': '#F6465D',
        'border-subtle': '#1E2026',
        'border-default': '#2C2F36',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
