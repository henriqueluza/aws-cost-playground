import type { ReactElement, ReactNode } from 'react';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  /** O que está vazio, em poucas palavras; vira heading. Texto, nunca HTML. */
  title: string;
  /** Uma frase que diz o que fazer. Texto, nunca HTML. */
  description: string;
  /** A próxima ação (um `Button` ou um link). Obrigatória: o vazio sempre indica o próximo passo. */
  action: ReactNode;
  /** Nível do heading, conforme o lugar na página. Padrão 3: o vazio costuma ficar num painel de h2. */
  headingLevel?: 2 | 3 | 4;
};

/** Estado vazio: título, uma frase e a próxima ação dentro de um contorno tracejado de 1px. */
export function EmptyState(props: EmptyStateProps): ReactElement {
  const { title, description, action, headingLevel = 3 } = props;
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={styles.empty}>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.description}>{description}</p>
      {action}
    </div>
  );
}
