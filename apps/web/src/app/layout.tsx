import type { Metadata } from "next";
import { Noto_Sans_Tamil, Outfit } from "next/font/google";
import "./globals.css";
import "flatpickr/dist/flatpickr.css";
import { LanguageProvider } from "@/context/LanguageContext";
import { SidebarProvider } from "@/context/SidebarContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { env } from "@/lib/env";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

/**
 * Tamil glyph coverage for the bilingual instruction copy. Outfit has none at
 * all, so without this every Tamil string renders as tofu boxes.
 *
 * Only the `tamil` subset: the font also ships Latin, and pulling that in would
 * let it win for Latin text in any element where it happened to come first.
 * Outfit leads the stack in `globals.css`, which prevents that anyway — but the
 * hazard is not worth creating. See `.font-app` for how the two combine.
 */
const notoSansTamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-tamil",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: env.NEXT_PUBLIC_APP_NAME,
    template: `%s | ${env.NEXT_PUBLIC_APP_NAME}`,
  },
  description: "Admin console",
  openGraph: {
    type: "website",
    siteName: env.NEXT_PUBLIC_APP_NAME,
  },
};

/**
 * Applies the persisted theme before first paint.
 *
 * ThemeContext reads localStorage in an effect, which runs after hydration —
 * without this, dark-mode users see a light flash on every page load.
 */
const themeInitScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

/**
 * Applies the persisted instruction language before first paint.
 *
 * Sets the `lang` attribute only — never text. LanguageProvider deliberately
 * renders English on its first pass to keep hydration clean and swaps in a
 * layout effect; this script's job is narrower: have `lang` correct from the
 * very first paint so the Tamil font and the lang-dependent line-height apply
 * immediately and Tamil text never reflows once the effect runs.
 *
 * The storage key is duplicated from `@/i18n/locale` because this runs as an
 * inlined string and cannot import. Change both together.
 */
const languageInitScript = `
(function() {
  try {
    if (localStorage.getItem('lang') === 'ta') {
      document.documentElement.lang = 'ta';
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: languageInitScript }} />
      </head>
      {/* The page background comes from `bg-canvas` on `body` in the design
          tokens, which resolves per theme. A `dark:` class here would win over
          it and pin dark mode to the old #101828.

          `font-app` (globals.css) rather than `outfit.className`: it stacks
          Outfit over Noto Sans Tamil so Latin and Tamil each resolve to the
          font that has their glyphs. */}
      <body className={`${outfit.variable} ${notoSansTamil.variable} font-app`}>
        <ThemeProvider>
          <LanguageProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
