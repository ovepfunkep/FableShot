import { WebReleaseVersion } from './WebReleaseNotes.tsx';
import { AndroidUpdateCard } from './AndroidUpdateCard.tsx';
import type { useAndroidUpdates } from './android-updates.ts';
import { SettingsAction } from './SettingsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import './about-screen.css';

const thanks = [
  'Моего папу, Тябина Алексея Владимировича, за то, как он меня вдохновляет всю мою жизнь.',
  'Моего тренера, Попова Алексея, за неоценимый вклад в развитие моих стрелковых навыков',
  'Клуб «Вольные Стрелки» за незабываемую атмосферу дружелюбия',
];

export function AboutScreen({ onReleaseNotes, updates }: { onReleaseNotes: () => void; updates: ReturnType<typeof useAndroidUpdates> }) {
  return <section className="about-screen" aria-label="О FableShot">
    <div className="about-brand">
      <img src={`${import.meta.env.BASE_URL}icons/fableshot-192.png`} width="46" height="46" alt="" />
      <WebReleaseVersion onOpen={onReleaseNotes} />
    </div>
    <AndroidUpdateCard updates={updates} manual />
    <div className="settings-actions">
      <SettingsAction icon="code" href="https://github.com/ovepfunkep/FableShot">GitHub</SettingsAction>
      <SettingsAction icon="send" href="https://t.me/IncludeIntelligence">Telegram</SettingsAction>
      <SettingsAction icon="heart" href="https://boosty.to/ivantyabin/donate?forPost=send">Поддержать на Boosty</SettingsAction>
    </div>
    <details className="about-credits">
      <summary><span className="settings-glyph"><Icon name="trophy" /></span><span>Благодарности</span><Icon name="right" /></summary>
      <div className="about-credits-list">
        <h2>Благодарю</h2>
        {thanks.map(line => <p key={line}>{line}</p>)}
      </div>
    </details>
    <p className="about-copyright">© 2026 Тябин Иван Алексеевич</p>
  </section>;
}
