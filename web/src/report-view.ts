import { useState } from 'react';

const key = 'app.fableshot.report-views.v1';
type ViewValue = string | number | null;
type Views = { id: string; fields: Record<string, ViewValue> }[];

function readViews(): Views {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' &&
      item.fields && typeof item.fields === 'object').slice(0, 20) : [];
  } catch { return []; }
}

export function useReportView<T extends ViewValue>(id: string | undefined, field: string, fallback: T): [T, (value: T) => void] {
  const [local, setLocal] = useState<{ id: string | undefined; field: string; value: T }>();
  const stored = readViews().find(item => item.id === id)?.fields[field];
  const storedValue = stored === null || typeof stored === 'string' || typeof stored === 'number' && Number.isFinite(stored) ? stored as T : fallback;
  const value = local && local.id === id && local.field === field ? local.value : storedValue;
  return [value, next => {
    setLocal({ id, field, value: next });
    if (!id) return;
    const views = readViews();
    const fields = { ...views.find(item => item.id === id)?.fields, [field]: next };
    try { localStorage.setItem(key, JSON.stringify([{ id, fields }, ...views.filter(item => item.id !== id)].slice(0, 20))); }
    catch { /* The report can still be read when view preferences cannot be stored. */ }
  }];
}
