export const MAX_TARGET_ZOOM = 8;
export const TARGET_ZOOM_STEP = 1.5;

export function clampTargetZoom(zoom: number): number {
  return Math.max(1, Math.min(MAX_TARGET_ZOOM, zoom));
}

export function TargetZoom({ zoom, onStep, onReset, className = 'zoom' }: {
  zoom: number;
  onStep: (factor: number) => void;
  onReset: () => void;
  className?: string;
}) {
  return <div className={className} role="group" aria-label="Приближение мишени">
    <button type="button" aria-label="Уменьшить" onClick={() => onStep(1 / TARGET_ZOOM_STEP)} disabled={zoom <= 1}>−</button>
    <button type="button" className="zoom-value" aria-label="Сбросить приближение" onClick={onReset}>
      {zoom.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×
    </button>
    <button type="button" aria-label="Увеличить" onClick={() => onStep(TARGET_ZOOM_STEP)} disabled={zoom >= MAX_TARGET_ZOOM}>+</button>
  </div>;
}
