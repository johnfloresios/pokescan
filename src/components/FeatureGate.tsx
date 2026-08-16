import type { ReactNode } from 'react';
import type { ProFeature } from '@/hooks/useEntitlements';
import { useEntitlements } from '@/hooks/useEntitlements';

/** Central entitlement boundary for premium screens and components. */
export function FeatureGate({feature,children,fallback=null}:{feature:ProFeature;children:ReactNode;fallback?:ReactNode}){
  const {isLoading,canUse}=useEntitlements();
  if(isLoading||!canUse(feature))return <>{fallback}</>;
  return <>{children}</>;
}
