import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#0ea5e9', // sky-500
          hover: '#0284c7', // sky-600
          soft: '#e0f2fe', // sky-100
          'soft-hover': '#bae6fd', // sky-200
          text: '#ffffff',
        },
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
      },
      animation: {
        wiggle: 'wiggle 1.2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};
export default config;
