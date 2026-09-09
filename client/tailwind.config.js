/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--color-surface-2) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        'text-1': 'rgb(var(--color-text-1) / <alpha-value>)',
        'text-2': 'rgb(var(--color-text-2) / <alpha-value>)',
        'text-3': 'rgb(var(--color-text-3) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-2': 'rgb(var(--color-accent-2) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        'pile-done': 'rgb(var(--color-pile-done) / <alpha-value>)',
        violet: 'rgb(var(--color-violet) / <alpha-value>)',
        amber: 'rgb(var(--color-amber) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        serif: ['"Newsreader"', 'Georgia', 'serif'],
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        'space-grotesk': ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        plex: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Space Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(29,29,27,0.05), 0 18px 48px -24px rgba(29,29,27,0.18)',
        'card-hover': '0 4px 20px rgba(29,29,27,0.12), 0 1px 4px rgba(29,29,27,0.06)',
        glow: '0 0 20px rgba(29,29,27,0.10)',
        'glow-lg': '0 0 32px rgba(29,29,27,0.18)',
      },
      animation: {
        'check-pulse': 'check-pulse 0.4s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
        'slide-up-delay': 'slide-up 0.35s ease-out 0.1s both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'bounce-in': 'bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'check-pulse': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'bounce-in': {
          from: { opacity: '0', transform: 'scale(0.9)' },
          '60%': { transform: 'scale(1.03)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
