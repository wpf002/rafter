'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/lib/tenant';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/models', label: 'Price Models' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { tenants, tenantId, setTenant } = useTenant();

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
      <div className="tenant-box">
        <label className="side-label" htmlFor="tenant-select">
          Tenant
        </label>
        <select
          id="tenant-select"
          className="tenant-select"
          value={tenantId ?? ''}
          onChange={(e) => setTenant(e.target.value)}
        >
          {tenants.length === 0 ? (
            <option value="">—</option>
          ) : (
            tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))
          )}
        </select>
      </div>
    </aside>
  );
}
