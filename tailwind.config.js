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
          DEFAULT: '#3B82F6',
          light:   '#60A5FA',
          dark:    '#2563EB',
          50:      '#EFF6FF',
          100:     '#DBEAFE',
        },
        gold: {
          DEFAULT: '#F59E0B',
          light:   '#FCD34D',
          dark:    '#D97706',
        },
        success:  '#10B981',
        warning:  '#F59E0B',
        danger:   '#EF4444',
        // Dark mode glass tokens
        dark: {
          bg:      'transparent',
          surface: 'rgba(14, 22, 42, 0.68)',
          card:    'rgba(20, 30, 55, 0.75)',
          border:  'rgba(148, 163, 184, 0.10)',
          text:    '#E2E8F0',
          muted:   '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs:  '4px',
        sm:  '8px',
        md:  '12px',
        lg:  '20px',
        xl:  '32px',
        '2xl': '48px',
      },
      boxShadow: {
        glass:       '0 4px 24px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.80)',
        'glass-dark':'0 8px 32px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.05)',
        glow:        '0 0 24px rgba(59,130,246,0.30)',
        'glow-gold': '0 0 24px rgba(245,158,11,0.25)',
        'glow-sm':   '0 0 12px rgba(59,130,246,0.20)',
      },
      animation: {
        'aurora-1':     'aurora-1 28s ease-in-out infinite alternate',
        'aurora-2':     'aurora-2 35s ease-in-out infinite alternate-reverse',
        'fade-up':      'fadeUp 0.30s ease forwards',
        'glow-pulse':   'glow-pulse 2.5s ease-in-out infinite',
        'float':        'float 6s ease-in-out infinite',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
      },
      transitionDuration: { DEFAULT: '200ms' },
    },
  },
  plugins: [],
};
