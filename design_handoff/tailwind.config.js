/** ============================================================
 *  HotelZippo — Tailwind Design Tokens
 *  ------------------------------------------------------------
 *  The single source of truth for the HotelZippo design system,
 *  expressed for Tailwind CSS (Next.js App Router).
 *
 *  Mirrors tokens.css exactly. Every value here was finalised in
 *  the design-system review. Notes:
 *   • Brand is a warm terracotta. Primary 500 (#C75C3C) is the core.
 *   • Amber & red are RESERVED for hard-flag alerts — never use them
 *     for general UI. They are namespaced under `flag.*` on purpose.
 *   • Fonts: Newsreader (serif, "voice"), Geist (sans, UI),
 *     Geist Mono (labels/meta). Load via next/font or <link>.
 *
 *  Usage examples:
 *     bg-bg  text-text  border-border
 *     bg-primary hover:bg-primary-hover text-on-primary
 *     bg-flag-amber-bg border-flag-amber-border text-flag-amber-text
 *     font-serif italic            // Claude's verdict voice
 *     rounded-card shadow-toppick  // the Top Pick card
 *     shadow-panel                 // shortlist panel
 *     animate-typing               // 3-dot indicator
 *
 *  Brand accent flexibility:
 *   • Default brand = Terracotta. Four harmonised accent ramps ship in
 *     `brandThemes` (terracotta · teal · ocean · plum) — all share the same
 *     lightness + chroma, differing only in hue, so the whole UI stays balanced.
 *   • BUILD-TIME swap (one line): set `primary: brandThemes.ocean` below.
 *   • RUNTIME swap (no rebuild): import `brand-themes.css` and set
 *     <html data-brand="ocean"> — re-tints every component live. Pair with
 *     `npm i` of nothing; it's pure CSS variables matching tokens.css.
 *   • `brandThemes` is also re-exported (module.exports.brandThemes) so app
 *     code / Storybook / Claude Code can read the ramps programmatically.
 * ============================================================ */

// ---- Brand accent ramps ---------------------------------------------------
// One terracotta-derived ramp shape, re-hued. [step, L, C, hueDrift].
const _STOPS = [
  [50, 0.971, 0.013, 5], [100, 0.940, 0.028, 4], [200, 0.890, 0.050, 3],
  [300, 0.818, 0.078, 2], [400, 0.728, 0.105, 1], [500, 0.638, 0.122, 0],
  [600, 0.576, 0.118, -1], [700, 0.502, 0.100, -2], [800, 0.430, 0.082, -3],
  [900, 0.366, 0.064, -4],
];
function _ramp(hue) {
  const r = {};
  for (const [k, L, C, d] of _STOPS) r[k] = `oklch(${L} ${C} ${hue + d})`;
  r.DEFAULT = r[500]; r.hover = r[600]; r.press = r[700]; r.tint = r[50];
  return r;
}
const brandThemes = {
  terracotta: _ramp(41),   // #C75C3C — default HotelZippo brand
  teal:       _ramp(168),  // calm, spa-like
  ocean:      _ramp(245),  // trust-forward blue
  plum:       _ramp(338),  // warm editorial magenta
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ---------- Brand accent (default: Terracotta) ----------
           Swap the entire ramp in one line — e.g. `primary: brandThemes.ocean`.
           For runtime switching without a rebuild, see brand-themes.css +
           <html data-brand="…">. All four ramps live in `brandThemes` (top of file). */
        primary: brandThemes.terracotta, // #C75C3C core
        'on-primary': '#FFFFFF',

        /* ---------- Warm neutrals (stone) ---------- */
        bg:        '#FBFAF8', // app canvas
        surface: {
          DEFAULT: '#FFFFFF', // cards
          2:       '#F5F3EF', // recessed panels, skeletons
          3:       '#EEEBE4',
        },
        border: {
          DEFAULT: '#E8E4DD',
          strong:  '#D8D2C8',
        },
        text: {
          DEFAULT:   '#1F1B17', // warm near-black
          secondary: '#6B6359',
          tertiary:  '#9A9186',
          'on-dark': '#FBFAF8',
        },

        /* ---------- Hard-flag semantics — RESERVED ---------- */
        flag: {
          amber: {
            DEFAULT: '#F59E0B',
            bg:      '#FEF6E7',
            border:  '#F4D38C',
            text:    '#8A540A',
          },
          red: {
            DEFAULT: '#EF4444',
            bg:      '#FDEDEC',
            border:  '#F3BFBC',
            text:    '#A82820',
          },
        },

        /* ---------- Other semantics ---------- */
        success: {
          DEFAULT: '#0E7C66',
          bg:      '#E7F2EE',
          text:    '#0B5E4D',
        },
        star: '#E0972B', // rating gold
      },

      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'Times New Roman', 'serif'],
        sans:  ['Geist', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono:  ['Geist Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },

      /* Editorial type scale — [size, { lineHeight, letterSpacing }] */
      fontSize: {
        'display-lg': ['52px', { lineHeight: '1.04', letterSpacing: '-0.02em',  fontWeight: '500' }],
        'display':    ['40px', { lineHeight: '1.08', letterSpacing: '-0.018em', fontWeight: '500' }],
        'h1':         ['32px', { lineHeight: '1.14', letterSpacing: '-0.015em', fontWeight: '500' }],
        'h2':         ['24px', { lineHeight: '1.22', letterSpacing: '-0.01em',  fontWeight: '500' }],
        'h3':         ['20px', { lineHeight: '1.3',  letterSpacing: '-0.006em', fontWeight: '600' }],
        'body-lg':    ['18px', { lineHeight: '1.55' }],
        'body':       ['16px', { lineHeight: '1.6' }],
        'body-sm':    ['14px', { lineHeight: '1.55' }],
        'caption':    ['13px', { lineHeight: '1.45' }],
        'label':      ['12px', { lineHeight: '1.2',  letterSpacing: '0.08em' }],
      },

      /* 4px-based spacing (extends Tailwind's default scale) */
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px',
        8: '32px', 10: '40px', 12: '48px', 16: '64px', 20: '80px',
      },

      borderRadius: {
        xs:    '6px',
        input: '10px',
        btn:   '10px',
        card:  '16px',
        panel: '20px',
        pill:  '9999px',
      },

      boxShadow: {
        /* warm-tinted elevation system */
        xs:    '0 1px 2px rgba(31,27,23,0.06)',
        sm:    '0 1px 2px rgba(31,27,23,0.05), 0 1px 3px rgba(31,27,23,0.06)',
        md:    '0 4px 14px -4px rgba(31,27,23,0.10), 0 2px 4px rgba(31,27,23,0.04)',
        lg:    '0 14px 36px -10px rgba(31,27,23,0.18), 0 3px 8px rgba(31,27,23,0.06)',
        /* semantic aliases for the three card altitudes */
        card:    '0 1px 2px rgba(31,27,23,0.05), 0 1px 3px rgba(31,27,23,0.06)', // standard card
        toppick: '0 14px 36px -10px rgba(31,27,23,0.18), 0 3px 8px rgba(31,27,23,0.06)', // lifted
        panel:   '-24px 0 60px -20px rgba(31,27,23,0.22)', // shortlist panel
      },

      ringColor: {
        primary: 'color-mix(in oklch, oklch(0.638 0.122 41) 22%, transparent)',
      },

      transitionDuration: {
        fast:  '120ms',
        base:  '200ms',
        slow:  '320ms',
        panel: '380ms',
      },

      transitionTimingFunction: {
        out:      'cubic-bezier(0.2, 0.7, 0.2, 1)',
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
        in:       'cubic-bezier(0.4, 0, 1, 1)',
      },

      keyframes: {
        /* streaming-text caret */
        caret:   { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        /* 3-dot typing indicator */
        typing:  {
          '0%,60%,100%': { opacity: '0.25', transform: 'translateY(0)' },
          '30%':         { opacity: '1',    transform: 'translateY(-3px)' },
        },
        /* message / card reveal — position only, never opacity-from-0
           (keeps print, PDF & reduced-motion legible) */
        rise:    { from: { transform: 'translateY(8px)' }, to: { transform: 'translateY(0)' } },
        /* panel slide-in */
        slideInRight: { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        slideInUp:    { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
      },

      animation: {
        caret:   'caret 1s steps(1) infinite',
        typing:  'typing 1.4s infinite both',
        rise:    'rise 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'panel-in':  'slideInRight 380ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'sheet-in':  'slideInUp 380ms cubic-bezier(0.2, 0.7, 0.2, 1)',
      },

      maxWidth: {
        chat: '760px',  // conversation column
        card: '680px',  // hotel card / recommendation block
      },
    },
  },
  plugins: [],
};

// Re-export the accent ramps so app code, Storybook, or Claude Code can read
// them programmatically (e.g. to render a brand-accent picker).
module.exports.brandThemes = brandThemes;
