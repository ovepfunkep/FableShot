type ResultRow = { name: string; bow: string; place: number | null; score: string };

export function roomResultCard(title: string, date: number, mode: string, series: number, scope: string, rows: readonly ResultRow[]): File {
  const canvas = document.createElement('canvas');
  canvas.width = 880;
  canvas.height = 270 + rows.length * 74;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось нарисовать карточку.');
  const ink = '#f2f6ed', muted = '#b2c0b1', accent = '#c6f43d';
  ctx.fillStyle = '#111811';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  function text(value: string, x: number, y: number, size: number, color: string, maxWidth: number, bold = false) {
    ctx!.font = `${bold ? 700 : 400} ${size}px system-ui, sans-serif`;
    ctx!.fillStyle = color;
    if (ctx!.measureText(value).width > maxWidth) {
      const letters = Array.from(value);
      while (letters.length && ctx!.measureText(letters.join('') + '…').width > maxWidth) letters.pop();
      value = letters.join('') + '…';
    }
    ctx!.fillText(value, x, y);
  }
  text('FableShot · Итоги комнаты', 42, 57, 23, accent, 796, true);
  text(title, 42, 115, 45, ink, 796, true);
  text(`${mode} · Срез до серии ${series} · ${new Date(date).toLocaleDateString('ru-RU')}`, 42, 158, 22, muted, 796);
  text(scope || 'Все луки и условия', 42, 193, 20, muted, 796);
  rows.forEach((row, index) => {
    const y = 218 + index * 74;
    ctx.fillStyle = index % 2 ? '#202c22' : '#19241b';
    ctx.beginPath(); ctx.roundRect(42, y, 796, 66, 13); ctx.fill();
    text(row.place === null ? '—' : String(row.place), 63, y + 40, 25, accent, 52, true);
    text(row.name, 132, y + 29, 24, ink, 497, true);
    text(row.bow, 132, y + 53, 17, muted, 497);
    text(row.score, 652, y + 41, 24, ink, 162, true);
  });
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png;base64,')) throw new Error('Карточка слишком большая.');
  const bytes = Uint8Array.from(atob(url.slice('data:image/png;base64,'.length)), value => value.charCodeAt(0));
  return new File([bytes], 'FableShot-итоги-комнаты.png', { type: 'image/png' });
}
