import { useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';

const guides = {
  standard: [
    { title: 'Отметь попадание', image: 'standard-lens.jpg', text: 'Коснись мишени. Для точной отметки удерживай палец, наведи кольцо лупы и отпусти.' },
    { title: 'Проверь серию', image: 'standard-series.jpg', text: 'Нажми на очки стрелы, чтобы поправить попадание. Когда закончишь ввод, нажми «Следующая серия».' },
  ],
  triple: [
    { title: 'Переключай пятна', image: 'triple-focus.jpg', text: 'Стрелки рядом с мишенью фокусируют верхнее или нижнее пятно. Нажми на кратность масштаба, чтобы вернуться к общему виду.' },
    { title: 'Задай порядок', image: 'triple-order.jpg', text: 'В условиях открой «Дополнительно». Включи автопереход и укажи порядок. Фокус переходит после сохранения стрелы, а новая серия начинается с первого пятна.' },
  ],
} as const;

export function TargetGuide({ kind, onClose }: { kind: keyof typeof guides; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const steps = guides[kind];
  const step = steps[index];
  return <BottomSheet title={kind === 'triple' ? 'Мишень «Светофор»' : 'Работа с мишенью'} tag="target-guide" onClose={onClose}>
    <section className="target-guide-step" aria-live="polite">
      <h3>{step.title}</h3>
      <img src={`${import.meta.env.BASE_URL}guides/${step.image}`} alt={`${step.title} в интерфейсе FableShot`} />
      <p>{step.text}</p>
    </section>
    <nav className="target-guide-controls" aria-label="Шаги гайда">
      <button type="button" className="icon-button" aria-label="Предыдущий шаг" disabled={!index} onClick={() => setIndex(index - 1)}><Icon name="left" /></button>
      <span>{index + 1} / {steps.length}</span>
      <button type="button" className="primary" onClick={index < steps.length - 1 ? () => setIndex(index + 1) : onClose}>
        {index < steps.length - 1 ? 'Дальше' : 'Готово'}
      </button>
    </nav>
  </BottomSheet>;
}
