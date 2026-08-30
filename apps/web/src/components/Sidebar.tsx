'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/models', label: 'Price Models' },
  { href: '/benchmark', label: 'Compare' },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <aside className="sidebar no-print">
      <div className="wordmark">
        R<span className="wm-a">A</span>FTER
      </div>
      <nav className="side-nav">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`side-link${isActive(n.href) ? ' is-active' : ''}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
