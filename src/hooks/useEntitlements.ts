import { useCallback, useMemo, useState } from 'react';

export type ProFeature =
  | 'advanced_analytics'
  | 'unlimited_price_alerts'
  | 'collection_export'
  | 'insurance_reports'
  | 'dealer_tools';

export interface Entitlements {
  isPro: boolean;
  isLoading: boolean;
  canUse: (feature: ProFeature) => boolean;
  willCheck: () => Promise<boolean>;
  restorePurchases: () => Promise<void>;
}

// Free is the secure default. Replace these methods with verified store data later;
// screens can keep using the same hook and typed feature keys.
export function useEntitlements(): Entitlements {
  const [isLoading, setIsLoading] = useState(false);
  const isPro = false;
  const canUse = useCallback((_feature: ProFeature) => isPro, [isPro]);
  const willCheck = useCallback(async () => isPro, [isPro]);
  const restorePurchases = useCallback(async () => {
    setIsLoading(true);
    try {
      // Future: restore and verify purchases, then refresh entitlement state.
    } finally {
      setIsLoading(false);
    }
  }, []);
  return useMemo(() => ({ isPro, isLoading, canUse, willCheck, restorePurchases }), [canUse, isLoading, restorePurchases, willCheck]);
}
