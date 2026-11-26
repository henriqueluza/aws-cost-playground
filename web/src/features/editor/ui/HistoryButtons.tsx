import type { ReactElement } from 'react';
import { IconButton } from '../../../shared/ui';
import { redoAndAnnounce, undoAndAnnounce } from '../hooks/historyCommands';
import { useDesignStore } from '../hooks/useDesignStore';
import { Icon } from './CategoryIcon';
import styles from './EditorPage.module.css';

const isApple = (): boolean => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

/** Desfazer e refazer na barra de ações; a dica traz o atalho, ou o motivo de estar desligado. */
export function HistoryButtons(): ReactElement {
  const canUndo = useDesignStore((s) => s.history.past.length > 0);
  const canRedo = useDesignStore((s) => s.history.future.length > 0);
  const apple = isApple();
  const mod = apple ? '⌘' : 'Ctrl+';
  const redoKeys = apple ? '⇧⌘Z' : 'Ctrl+Shift+Z ou Ctrl+Y';
  return (
    <div role="group" aria-label="Histórico" className={styles.history}>
      <IconButton
        aria-label="Desfazer"
        title={canUndo ? `Desfazer (${mod}Z)` : 'Nada para desfazer'}
        aria-keyshortcuts={apple ? 'Meta+Z' : 'Control+Z'}
        disabled={!canUndo}
        onClick={undoAndAnnounce}
      >
        <Icon name="undo" />
      </IconButton>
      <IconButton
        aria-label="Refazer"
        title={canRedo ? `Refazer (${redoKeys})` : 'Nada para refazer'}
        aria-keyshortcuts={apple ? 'Meta+Shift+Z' : 'Control+Shift+Z Control+Y'}
        disabled={!canRedo}
        onClick={redoAndAnnounce}
      >
        <Icon name="redo" />
      </IconButton>
    </div>
  );
}
