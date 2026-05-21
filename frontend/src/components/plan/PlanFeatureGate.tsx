import { type ReactNode } from 'react';
import { usePlan } from '@/hooks/usePlan';

interface PlanFeatureGateProps {
  feature: string;
  fallback?: ReactNode;
  children: ReactNode;
}

export default function PlanFeatureGate({ feature, fallback = null, children }: PlanFeatureGateProps) {
  const { hasFeature } = usePlan();

  if (!hasFeature(feature)) {
    return fallback;
  }

  return <>{children}</>;
}
