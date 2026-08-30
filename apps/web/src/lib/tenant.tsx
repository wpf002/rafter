'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TenantSummary } from '@rafter/types';
import { api, errorMessage, TENANT_KEY } from './api';

interface TenantContextValue {
  tenants: TenantSummary[];
  tenantId: string | null;
  setTenant: (id: string) => void;
  error: string | null;
}

const TenantContext = createContext<TenantContextValue>({
  tenants: [],
  tenantId: null,
  setTenant: () => undefined,
  error: null,
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .tenants()
      .then((ts) => {
        if (!live) return;
        setTenants(ts);
        const stored = window.localStorage.getItem(TENANT_KEY);
        const valid = ts.find((t) => t.id === stored)?.id ?? ts[0]?.id ?? null;
        if (valid !== null) window.localStorage.setItem(TENANT_KEY, valid);
        setTenantId(valid);
      })
      .catch((e: unknown) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const setTenant = (id: string) => {
    window.localStorage.setItem(TENANT_KEY, id);
    setTenantId(id);
  };

  return (
    <TenantContext.Provider value={{ tenants, tenantId, setTenant, error }}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}
