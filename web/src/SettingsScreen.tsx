import type { ComponentProps, ReactNode } from 'react';
import { Icon } from './TrainingChrome.tsx';
import './settings-screen.css';

const sections = [
  { id: 'appearance', title: 'Оформление', icon: 'spark' },
  { id: 'motion', title: 'Движение и отклик', icon: 'motion' },
  { id: 'training', title: 'Тренировка', icon: 'target' },
  { id: 'statistics', title: 'Статистика', icon: 'stats' },
  { id: 'data', title: 'Данные и перенос', icon: 'download' },
  { id: 'help', title: 'Помощь', icon: 'help' },
  { id: 'about', title: 'О приложении', icon: 'about' },
] as const;

export type SettingsSection = typeof sections[number]['id'];
const paths = {
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  motion: 'M2 12h4l3-7 5 14 3-7h5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  about: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 8v6m0-10h.01',
  archive: 'M3 4h18v5H3zM5 9v11h14V9m-9 4h4',
  book: 'M12 6v15M3 4h4a5 5 0 0 1 5 2 5 5 0 0 1 5-2h4v14h-4a6 6 0 0 0-5 3 6 6 0 0 0-5-3H3Z',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  send: 'm3 10 18-6-5 16-4-6-4 3 1-6m3 3 5-6',
  heart: 'M12 21 4 13a5 5 0 1 1 8-6 5 5 0 1 1 8 6Z',
  external: 'M13 4h7v7m0-7-9 9m6 0v7H4V7h7',
} as const;
type CustomIcon = keyof typeof paths;
type SettingsIcon = CustomIcon | ComponentProps<typeof Icon>['name'];

function isCustomIcon(name: SettingsIcon): name is CustomIcon { return Object.hasOwn(paths, name); }

function SectionGlyph({ name }: { name: SettingsIcon }) {
  if (!isCustomIcon(name)) return <Icon name={name} />;
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function SettingsAction({ icon, children, tone, ...props }: {
  icon: SettingsIcon;
  children: ReactNode;
  tone?: 'danger';
} & ({ href: string } | Pick<ComponentProps<'button'>, 'onClick' | 'disabled' | 'aria-haspopup'> & { 'data-testid'?: string })) {
  const content = <>
    <span className="settings-glyph"><SectionGlyph name={icon} /></span>
    <span className="settings-action-label">{children}</span>
    {!tone && <SectionGlyph name={'href' in props ? 'external' : 'right'} />}
  </>;
  if ('href' in props) return <a className="settings-entry" href={props.href} target="_blank" rel="noreferrer">{content}</a>;
  return <button type="button" className="settings-entry" data-tone={tone} {...props}>{content}</button>;
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
      <span className="settings-header-glyph"><SectionGlyph name={selected?.icon ?? 'settings'} /></span>
    </header>
    <div className="conditions-content settings-content" key={section ?? 'root'}>
      {section ? content[section] : <nav className="settings-entries" aria-label="Разделы настроек">
        {sections.map(item => <SettingsAction key={item.id} icon={item.icon} data-testid={`settings-${item.id}`}
          onClick={() => onSection(item.id)}>{item.title}</SettingsAction>)}
      </nav>}
    </div>
    {children}
  </main>;
}
