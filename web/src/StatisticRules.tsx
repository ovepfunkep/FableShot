import type { ReactNode } from 'react';

export function StatisticRules({ children }: { children: ReactNode }) {
  return <details className="statistic-rules">
    <summary>Формулы и точные правила</summary>
    {children}
  </details>;
}
