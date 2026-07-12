/**
 * Midas design tokens — glassmorphism / agentic web3 aesthetic.
 * Single source of truth consumed by apps/web (CSS vars) and apps/mobile (RN styles).
 * Extends the original mobile theme (apps/mobile/src/theme re-exports from here).
 */

export const Colors = {
  // Brand
  primary: "#10B981",
  primaryDark: "#059669",
  primaryLight: "#34D399",

  // Trade signals
  profit: "#10B981",
  loss: "#EF4444",
  warning: "#F59E0B",
  neutral: "#6B7280",

  dark: {
    bg: "#0F0F0F",
    bgGradient: ["#0F0F0F", "#0D1F17"] as [string, string],
    bgCard: "rgba(255,255,255,0.05)",
    bgCardBorder: "rgba(255,255,255,0.1)",
    surface: "#1A1A1A",
    surfaceHover: "#242424",
    text: "#FFFFFF",
    textSecondary: "#9CA3AF",
    textMuted: "#6B7280",
    border: "rgba(255,255,255,0.08)",
    overlay: "rgba(0,0,0,0.6)",
  },

  light: {
    bg: "#FAFAFA",
    bgGradient: ["#FAFAFA", "#F0FDF4"] as [string, string],
    bgCard: "rgba(0,0,0,0.03)",
    bgCardBorder: "rgba(0,0,0,0.08)",
    surface: "#FFFFFF",
    surfaceHover: "#F3F4F6",
    text: "#0F0F0F",
    textSecondary: "#4B5563",
    textMuted: "#9CA3AF",
    border: "rgba(0,0,0,0.08)",
    overlay: "rgba(255,255,255,0.6)",
  },
} as const;

export const Typography = {
  sizes: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, "2xl": 30, "3xl": 36 },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 9999 } as const;

/** Glass surface treatment — blur radii used with backdrop-filter (web) / expo-blur (mobile). */
export const Glass = {
  blur: { sm: 8, md: 16, lg: 24 },
  glow: "0 0 24px rgba(16,185,129,0.25)",
} as const;

export const Shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;
