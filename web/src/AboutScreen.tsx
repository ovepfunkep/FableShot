import { WebReleaseVersion } from './WebReleaseNotes.tsx';
import { AndroidUpdateCard } from './AndroidUpdateCard.tsx';
import type { useAndroidUpdates } from './android-updates.ts';
import './about-screen.css';

const thanks = [
  'Моего папу, Тябина Алексея Владимировича, за то, как он меня вдохновляет всю мою жизнь.',
  'Моего тренера, Попова Алексея, за неоценимый вклад в развитие моих стрелковых навыков',
  'Клуб «Вольные Стрелки» за незабываемую атмосферу дружелюбия',
];

export function AboutScreen({ onReleaseNotes, updates }: { onReleaseNotes: () => void; updates: ReturnType<typeof useAndroidUpdates> }) {
  return <section className="about-screen" aria-label="О FableShot">
    <WebReleaseVersion onOpen={onReleaseNotes} />
    <AndroidUpdateCard updates={updates} manual />
    <div className="about-links">
      <a className="technique-condition-link" href="https://github.com/ovepfunkep/FableShot" target="_blank" rel="noreferrer">GitHub</a>
      <a className="technique-condition-link" href="https://t.me/IncludeIntelligence" target="_blank" rel="noreferrer">Telegram</a>
      <a className="technique-condition-link" href="https://boosty.to/ivantyabin/donate?forPost=send" target="_blank" rel="noreferrer">Поддержать на Boosty</a>
    </div>
    <details className="about-credits">
      <summary>Благодарности</summary>
      <div className="about-credits-list">
        <h2>Благодарю</h2>
        {thanks.map(line => <p key={line}>{line}</p>)}
      </div>
    </details>
    <p className="about-copyright">© 2026 Тябин Иван Алексеевич</p>
  </section>;
}
