import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import { announcerStore } from '../hooks/announcer';
import styles from './EditorPage.module.css';

/**
 * Região `aria-live` educada do editor. Duas regiões se alternam a cada frase: a mesma frase
 * duas vezes seguidas muda o conteúdo de uma região diferente e é lida de novo.
 */
export function LiveAnnouncer(): ReactElement {
  const { message, seq } = useStore(announcerStore);
  return (
    <div className={styles.hidden}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {seq % 2 === 1 ? message : ''}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {seq % 2 === 0 ? message : ''}
      </div>
    </div>
  );
}
