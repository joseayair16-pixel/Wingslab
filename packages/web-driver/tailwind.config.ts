import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#0ea5e9',
          hover: '#0284c7',
          soft: '#e0f2fe',
          'soft-hover': '#bae6fd',
          text: '#ffffff',
        },
        background: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        foreground: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#f43f5e',
        info: '#0ea5e9',
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '15%': { transform: 'rotate(-4deg) scale(1.02)' },
          '30%': { transform: 'rotate(3deg) scale(1.03)' },
          '45%': { transform: 'rotate(-2deg) scale(1.01)' },
          '60%': { transform: 'rotate(2deg)' },
          '75%': { transform: 'rotate(-1deg)' },
        },
        'moto-rumble': {
          '0%, 100%': { transform: 'translateY(0) scaleX(1) rotate(0deg)' },
          '20%': { transform: 'translateY(-6px) scaleX(0.98) rotate(-4deg)' },
          '40%': { transform: 'translateY(1px) scaleX(1.02) rotate(2deg)' },
          '60%': { transform: 'translateY(-4px) scaleX(0.99) rotate(-2deg)' },
          '80%': { transform: 'translateY(0) scaleX(1.01) rotate(1deg)' },
        },
      },
      animation: {
        wiggle: 'wiggle 1.2s ease-in-out infinite',
        'moto-ride': 'moto-rumble 0.8s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};
export default config;
