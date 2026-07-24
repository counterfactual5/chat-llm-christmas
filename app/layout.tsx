import type { Metadata } from 'next';
import { Inter, Source_Serif_4 } from 'next/font/google';
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
  title: 'llm.christmas Chat — Universal AI Assistant',
  description: 'Minimalist, fast, and powerful AI conversation experience powered by llm.christmas.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans selection:bg-orange-200 selection:text-orange-900 dark:selection:bg-orange-900/50 dark:selection:text-orange-100">{children}</body>
    </html>
  );
}
