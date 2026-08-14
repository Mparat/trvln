import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

interface EntitlementsState {
  /** Trip credits remaining (sum of the ledger). */
  balance: number;
  /** True once the user has ever completed a purchase — purchasers don't get preview trips. */
  hasPurchased: boolean;
  /** Batches unlocked for full generation. */
  entitledBatches: Set<string>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const EntitlementsContext = createContext<EntitlementsState | undefined>(undefined);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [entitledBatches, setEntitledBatches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setBalance(0);
      setHasPurchased(false);
      setEntitledBatches(new Set());
      return;
    }
    setLoading(true);
    try {
      const [bal, purchases, ents] = await Promise.all([
        supabase.from('credit_balances').select('balance').maybeSingle(),
        supabase.from('purchases').select('id').limit(1),
        supabase.from('trip_entitlements').select('batch_id'),
      ]);
      setBalance(bal.data?.balance ?? 0);
      setHasPurchased((purchases.data?.length ?? 0) > 0);
      setEntitledBatches(new Set((ents.data ?? []).map(r => r.batch_id)));
    } catch (error) {
      console.warn('Failed to load entitlements:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <EntitlementsContext.Provider value={{ balance, hasPurchased, entitledBatches, loading, refresh }}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements() {
  const context = useContext(EntitlementsContext);
  if (context === undefined) {
    throw new Error('useEntitlements must be used within an EntitlementsProvider');
  }
  return context;
}
