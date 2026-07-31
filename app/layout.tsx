import type { Metadata } from 'next';
import { Inter, Source_Serif_4 } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { LocaleProvider } from '@/lib/i18n';
import './globals.css';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
});

const sourceSerif = Source_Serif_4({
  variable: '--font-serif',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Christmas Chat',
  description: 'Minimalist AI chat powered by the llm.christmas gateway.',
  icons: {
    icon: '/icon.svg',
  },
};

const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('llm_christmas_theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans selection:bg-orange-200 selection:text-orange-900 dark:selection:bg-orange-900/50 dark:selection:text-orange-100">
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
