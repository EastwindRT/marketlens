/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#F7F5F1',
        'bg-surface': '#FFFFFF',
        'bg-elevated': '#F2EFEA',
        'bg-hover': '#ECE7DF',
        'text-primary': '#202532',
        'text-secondary': '#667085',
        'text-tertiary': '#8B94A5',
        'accent-blue': '#2F80ED',
        'accent-blue-light': '#4C95F7',
        'color-up': '#079A6A',
        'color-down': '#D94A55',
        'border-subtle': '#E7E1D8',
        'border-default': '#D7D0C5',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
