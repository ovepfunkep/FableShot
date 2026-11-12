import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { WEB_RELEASE_CODE, WEB_RELEASE_VERSION, pendingWebReleases, webReleaseHistory } from './web-releases.ts';
import './web-release-notes.css';

export function WebReleaseVersion({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="web-release-version" data-testid="settings-version" onClick={onOpen}>
    <span>FableShot {WEB_RELEASE_VERSION}</span><span>Что нового</span><Icon name="right" />
  </button>;
}

function Highlights({ values }: { values: readonly string[] }) {
  return <ul className="web-release-highlights">{values.map(text => <li key={text}>{text}</li>)}</ul>;
}

export function WebReleaseNotes({ seen, onSeen, showHistory, onCloseHistory }: {
  seen: number | null | undefined;
  onSeen: (code: number) => boolean;
  showHistory: boolean;
  onCloseHistory: () => void;
}) {
  const triedBaseline = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (seen !== undefined || triedBaseline.current) return;
    triedBaseline.current = true;
    onSeen(WEB_RELEASE_CODE);
  }, [seen, onSeen]);

  if (showHistory) return <BottomSheet title="История обновлений" tag="release-history" onClose={onCloseHistory}>
    <div className="web-release-notes">
      {webReleaseHistory().map(release => <section key={release.code} className="web-release-entry" data-testid={`release-history-${release.code}`}>
        <h3>{release.title} <span className="web-release-label">{release.version}</span></h3>
        <Highlights values={release.highlights} />
      </section>)}
      <button type="button" className="primary" onClick={onCloseHistory}>Закрыть</button>
    </div>
  </BottomSheet>;

  const pending = pendingWebReleases(seen);
  if (!pending.length) return null;
  const previousVersion = webReleaseHistory().find(release => release.code === seen)?.version;
  const highlights = [...new Set(pending.flatMap(release => release.highlights))];
  function acknowledge() { setFailed(!onSeen(WEB_RELEASE_CODE)); }

  return <BottomSheet title="Что нового" tag="release-notes" onClose={acknowledge}>
    <div className="web-release-notes">
      <p className="web-release-label" data-testid="release-notes-range">{previousVersion ? `${previousVersion} → ${WEB_RELEASE_VERSION}` : WEB_RELEASE_VERSION}</p>
      <Highlights values={highlights} />
      {failed && <p className="web-release-error" role="alert">Не удалось отметить обновление просмотренным. Повтори действие.</p>}
      <button type="button" className="primary" data-testid="release-notes-confirm" onClick={acknowledge}>{failed ? 'Повторить' : 'Понятно'}</button>
    </div>
  </BottomSheet>;
}
