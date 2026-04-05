import { createTheme, lightThemePrimitives, type Theme } from 'baseui'

const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const monoFontFamily = 'JetBrains Mono, "Fira Code", Monaco, Consolas, "Courier New", monospace'

const primitives = {
  ...lightThemePrimitives,
  primaryFontFamily: fontFamily,
  primary: '#1a73e8',
  primary50: '#e8f0fe',
  primary100: '#d2e3fc',
  primary200: '#aecbfa',
  primary300: '#8ab4f8',
  primary400: '#669df6',
  primary500: '#4285f4',
  primary600: '#1a73e8',
  primary700: '#1967d2',
  accent: '#f0f4f8',
  accent50: '#fafbfc',
  accent100: '#f0f4f8',
  accent200: '#e1e7ef',
  accent300: '#c9d1dc',
  accent400: '#a8b3c2',
  accent500: '#8694a7',
  accent600: '#5f6d80',
  accent700: '#3e4556',
}

const overrides = {
  typography: {
    font100: { fontFamily },
    font150: { fontFamily },
    font200: { fontFamily },
    font250: { fontFamily },
    font300: { fontFamily },
    font350: { fontFamily },
    font400: { fontFamily },
    font450: { fontFamily },
    font550: { fontFamily },
    font650: { fontFamily },
    font750: { fontFamily },
    font850: { fontFamily },
    font950: { fontFamily },
    font1050: { fontFamily },
    font1150: { fontFamily },
    font1250: { fontFamily },
    font1350: { fontFamily },
    font1450: { fontFamily },
    MonoParagraphXSmall: { fontFamily: monoFontFamily },
    MonoParagraphSmall: { fontFamily: monoFontFamily },
    MonoParagraphMedium: { fontFamily: monoFontFamily },
    MonoParagraphLarge: { fontFamily: monoFontFamily },
    MonoLabelXSmall: { fontFamily: monoFontFamily },
    MonoLabelSmall: { fontFamily: monoFontFamily },
    MonoLabelMedium: { fontFamily: monoFontFamily },
    MonoLabelLarge: { fontFamily: monoFontFamily },
    MonoHeadingXSmall: { fontFamily: monoFontFamily },
    MonoHeadingSmall: { fontFamily: monoFontFamily },
    MonoHeadingMedium: { fontFamily: monoFontFamily },
    MonoHeadingLarge: { fontFamily: monoFontFamily },
    MonoDisplayXSmall: { fontFamily: monoFontFamily },
    MonoDisplaySmall: { fontFamily: monoFontFamily },
    MonoDisplayMedium: { fontFamily: monoFontFamily },
    MonoDisplayLarge: { fontFamily: monoFontFamily },
  },
}

const baseTheme = createTheme(primitives)

// Deep merge typography overrides (fontFamily only) with base theme typography
const mergedTypography = { ...baseTheme.typography } as Record<string, any>
for (const [key, val] of Object.entries(overrides.typography)) {
  if (mergedTypography[key]) {
    mergedTypography[key] = { ...mergedTypography[key], ...val }
  }
}

export const customLightTheme = {
  ...baseTheme,
  typography: mergedTypography,
} as unknown as Theme

export const colors = {
  bgPrimary: '#ffffff',
  bgSecondary: '#f7f8fa',
  bgTertiary: '#e5e7eb',
  bgElevated: '#ffffff',

  textPrimary: '#111827',
  textSecondary: '#374151',
  textMuted: '#6b7280',
  textDisabled: '#9ca3af',

  border: '#e5e7eb',
  borderLight: '#d1d5db',

  primary: '#1a73e8',
  primaryHover: '#1557b0',
  primaryLight: '#4285f4',

  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  sidebarBg: '#1e293b',
  sidebarText: '#e2e8f0',
  sidebarTextMuted: '#94a3b8',
  sidebarHover: '#334155',
  sidebarActive: '#1a73e8',
}
