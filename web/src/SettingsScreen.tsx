import type { ReactNode } from 'react';
import { Icon } from './TrainingChrome.tsx';
import './settings-screen.css';

const sections = [
  { id: 'appearance', title: 'Оформление', icon: 'spark' },
  { id: 'motion', title: 'Движение и отклик', icon: 'settings' },
  { id: 'training', title: 'Тренировка', icon: 'target' },
  { id: 'statistics', title: 'Статистика', icon: 'stats' },
  { id: 'data', title: 'Данные и перенос', icon: 'download' },
  { id: 'help', title: 'Помощь', icon: 'help' },
  { id: 'about', title: 'О приложении', icon: 'about' },
] as const;

export type SettingsSection = typeof sections[number]['id'];
type SectionIcon = typeof sections[number]['icon'];
const paths = {
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  target: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-5a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 8v2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  help: 'M9 9a3 3 0 1 1 5 2.2c-1.2.7-2 1.2-2 2.8m0 3h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
  about: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 8v6m0-10h.01',
} as const;

function SectionGlyph({ name }: { name: SectionIcon }) {
  if (name === 'settings' || name === 'stats') return <Icon name={name} />;
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function SettingsScreen({ section, onSection, onBack, appearance, motion, training, statistics, data, help, about, children }: {
  section: SettingsSection | null;
  onSection: (section: SettingsSection | null) => void;
  onBack: () => void;
  appearance: ReactNode;
  motion: ReactNode;
  training: ReactNode;
  statistics: ReactNode;
  data: ReactNode;
  help: ReactNode;
  about: ReactNode;
  children?: ReactNode;
}) {
  const selected = sections.find(item => item.id === section);
  const content = { appearance, motion, training, statistics, data, help, about };
  return <main className="conditions-page settings-page" data-testid="settings-screen" data-section={section ?? 'root'}>
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={() => section ? onSection(null) : onBack()}><Icon name="back" /></button>
      <h1>{selected?.title ?? 'Настройки'}</h1>
    </header>
    <div className="conditions-content settings-content" key={section ?? 'root'}>
      {section ? content[section] : <nav className="settings-entries" aria-label="Разделы настроек">
        {sections.map(item => <button type="button" key={item.id} className="settings-entry" data-testid={`settings-${item.id}`}
          onClick={() => onSection(item.id)}><SectionGlyph name={item.icon} /><span>{item.title}</span><Icon name="right" /></button>)}
      </nav>}
    </div>
    {children}
  </main>;
}
