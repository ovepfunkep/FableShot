import { useState } from 'react';
import { Icon } from './TrainingChrome.tsx';

export function ProfileAvatar({ picture, name, size = 36 }: { picture?: string; name?: string; size?: number }) {
  const [failedPicture, setFailedPicture] = useState<string>();
  return <span className="profile-avatar" style={{ width: size, height: size }} aria-hidden="true">
    {picture && picture !== failedPicture
      ? <img src={picture} width={size} height={size} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(picture)} />
      : name ? <strong>{Array.from(name)[0]?.toLocaleUpperCase('ru-RU')}</strong> : <Icon name="user" />}
  </span>;
}
