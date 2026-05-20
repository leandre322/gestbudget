/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E40AF',
          light:   '#3B82F6',
          dark:    '#1E3A8A',
          50:      '#EFF6FF',
          100:     '#DBEAFE',
        },
        success:  '#10B981',
        warning:  '#F59E0B',
        danger:   '#EF4444',
        bg:       '#F8FAFC',
        surface:  '#FFFFFF',
        // Dark mode
        dark: {
          bg:      '#0F172A',
          surface: '#1E293B',
          card:    '#253347',
          border:  '#334155',
          text:    '#E2E8F0',
          muted:   '#94A3B8',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      transitionDuration: { DEFAULT: '200ms' },
    },
  },
  plugins: [],
};
