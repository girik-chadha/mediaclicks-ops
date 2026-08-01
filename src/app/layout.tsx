import type { Metadata } from 'next'
import { Bricolage_Grotesque, Instrument_Sans, Martian_Mono } from 'next/font/google'
import './globals.css'

/* Brief §3 names these as Google Fonts. next/font self-hosts them at build
   time, so there is no runtime request to fonts.gstatic.com and no FOIT —
   the same three faces, without the third-party dependency the design file's
   <link> tags would have introduced. */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bricolage',
})

const instrument = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
})

const martian = Martian_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-martian',
})

export const metadata: Metadata = {
  title: 'MediaClicks Operations',
  description: 'Scheduling and meeting operations for MediaClicks.',
}

/* Runs before first paint so a dark-mode user never sees a white flash.
   Inlined deliberately: any deferred script is already too late. */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${martian.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
