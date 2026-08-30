import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, Libre_Franklin } from 'next/font/google';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TenantProvider } from '@/lib/tenant';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-head', display: 'swap' });
const libreFranklin = Libre_Franklin({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Rafter',
  description: 'Fixed-price roof replacement quoting with mandatory cost-actuals capture.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${libreFranklin.variable} ${plexMono.variable}`}>
      <body>
        <TenantProvider>
          <div className="shell">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </TenantProvider>
      </body>
    </html>
  );
}
