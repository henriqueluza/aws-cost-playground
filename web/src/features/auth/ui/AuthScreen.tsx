import type { ReactNode } from 'react';
import styles from './AuthScreen.module.css';

/** Folha única, no meio da moldura, para o que acontece entre o site e o login gerenciado. */
export function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
