import { useId } from 'react';
import type { ReactNode } from 'react';
import styles from './Panel.module.css';

export type PanelProps = {
  /** Título Section; também é o nome da região. */
  title: string;
  /** Nível do heading, conforme o lugar do painel na página. */
  headingLevel?: 2 | 3 | 4;
  children: ReactNode;
};

/** Painel: região rotulada pelo próprio título, com algarismos tabulares nos números. */
export function Panel({ title, headingLevel = 2, children }: PanelProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <Heading id={titleId} className={styles.title}>
        {title}
      </Heading>
      {children}
    </section>
  );
}
