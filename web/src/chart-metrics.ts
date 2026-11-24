import { formatAverage } from './preferences.ts';
import { RANK_LABELS } from './sport-ranks.ts';

const ranks = [...RANK_LABELS].reverse();

export function rankChartValue(label: string | null) {
  const index = ranks.findIndex(rank => rank === label);
  return index === -1 ? null : index + 1;
}

export function chartLabel(metric: string, value: number, hundredths = false) {
  return metric === 'rank' ? ranks[Math.round(value) - 1] ?? '—' : formatAverage(value, hundredths);
}

export function chartScale(values: readonly number[], metric: string) {
  if (metric === 'rank') return { lower: 1, upper: ranks.length, ticks: [1, 3, 5, 7, 9] };
  const isShare = metric.endsWith('Share') || metric === 'stability';
  const step = metric === 'average' ? .5 : 5;
  const cap = metric === 'average' ? 10 : isShare ? 100 : metric === 'cg3' ? 105 : Infinity;
  const minimum = values.reduce((min, value) => Math.min(min, value), Infinity);
  const maximum = values.reduce((max, value) => Math.max(max, value), -Infinity);
  if (!values.length) return { lower: 0, upper: step * 2, ticks: [0, step, step * 2] };
  const pad = Math.max(step / 2, (maximum - minimum) * .1);
  const lower = Math.max(metric === 'progress' ? -100 : 0, Math.floor((minimum - pad) / step) * step);
  const upper = Math.min(cap, Math.max(lower + step, Math.ceil((maximum + pad) / step) * step));
  return { lower, upper, ticks: [lower, (lower + upper) / 2, upper] };
}
