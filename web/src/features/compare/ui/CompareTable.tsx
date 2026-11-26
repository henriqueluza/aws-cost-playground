import type { ReactElement } from 'react';
import { formatUsd } from '../../pricing';
import type { Decimal } from '../../../shared/lib/money';
import {
  DIRECTION_WORD,
  blockTypeLabel,
  edgeKindLabel,
  formatDiff,
  plural,
} from '../application/format';
import { directionOf, type Amounts, type CompareRow, type Comparison } from '../model/compare';
import styles from './CompareTable.module.css';

// Lucide (arrow-up-right, arrow-down-right, equal) na grade de 16: a forma diz o sentido.
const ICONS = {
  more: 'M4.67 11.33 11.33 4.67M5.33 4.67h6v6',
  less: 'M4.67 4.67l6.66 6.66M11.33 5.33v6h-6',
  same: 'M3.33 6h9.34M3.33 10h9.34',
};

/** `B − A` em três canais além da cor: sinal no texto, palavra ("a mais", "a menos", "igual") e ícone. */
function Diff({ diff, large = false }: { diff: Decimal; large?: boolean }): ReactElement {
  const direction = directionOf(diff);
  return (
    <span className={large ? `${styles.diff} ${styles.large}` : styles.diff}>
      <svg viewBox="0 0 16 16" className={styles.icon} aria-hidden="true" focusable="false">
        <path d={ICONS[direction]} />
      </svg>
      <span className={styles.amount}>{formatDiff(diff)}</span>
      <span className={styles.word}>{DIRECTION_WORD[direction]}</span>
    </span>
  );
}

function Cell({ title, amounts, large }: { title: string; amounts: Amounts; large?: boolean }) {
  return (
    <div role="group" aria-label={title} className={styles.cell}>
      <p className={styles.cellTitle} aria-hidden="true">
        {title}
      </p>
      <Diff diff={amounts.diff} large={large} />
      <p className={styles.sides}>
        <span>A {formatUsd(amounts.a)}</span>
        <span>B {formatUsd(amounts.b)}</span>
      </p>
    </div>
  );
}

/** Total, fixo e variável numa faixa dividida acima da tabela (DESIGN.md), não num rodapé. */
export function SummaryStrip({ comparison }: { comparison: Comparison }): ReactElement {
  return (
    <section aria-label="Resumo do custo mensal" className={styles.strip}>
      <Cell title="Total por mês" amounts={comparison.total} large />
      <Cell title="Fixo" amounts={comparison.fixed} />
      <Cell title="Variável" amounts={comparison.variable} />
    </section>
  );
}

function Side({ amount, count, unit }: { amount: Decimal; count: number; unit: [string, string] }) {
  return (
    <td className={styles.num}>
      {count === 0 ? (
        <>
          <span className={styles.absent} aria-hidden="true">
            —
          </span>
          <span className={styles.srOnly}>Este design não tem {unit[1]} deste tipo.</span>
        </>
      ) : (
        <>
          <span className={styles.money}>{formatUsd(amount)}</span>
          <span className={styles.count}>{plural(count, ...unit)}</span>
        </>
      )}
    </td>
  );
}

function Group(props: {
  title: string;
  rows: readonly CompareRow[];
  label: (key: string) => string;
  unit: [string, string];
}): ReactElement {
  return (
    <tbody>
      <tr>
        <th scope="rowgroup" colSpan={4} className={styles.group}>
          {props.title}
        </th>
      </tr>
      {props.rows.map((row) => (
        <tr key={row.key}>
          <th scope="row" className={styles.name}>
            {props.label(row.key)}
          </th>
          <Side amount={row.total.a} count={row.countA} unit={props.unit} />
          <Side amount={row.total.b} count={row.countB} unit={props.unit} />
          <td className={styles.num}>
            <Diff diff={row.total.diff} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** Diferença por tipo de bloco e de aresta. Tabela semântica: `caption`, `scope`, valores em texto. */
export function CompareTable({ comparison }: { comparison: Comparison }): ReactElement {
  return (
    <div
      className={styles.scroll}
      role="region"
      tabIndex={0}
      aria-label="Tabela de comparação por tipo"
    >
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          Custo mensal por tipo de bloco e por tipo de aresta, em dólares, com a diferença do design
          B em relação ao A
        </caption>
        <thead>
          <tr>
            <th scope="col">Tipo</th>
            <th scope="col" className={styles.num}>
              Design A
            </th>
            <th scope="col" className={styles.num}>
              Design B
            </th>
            <th scope="col" className={styles.num}>
              Diferença (B − A)
            </th>
          </tr>
        </thead>
        <Group
          title="Blocos"
          rows={comparison.blocks}
          label={blockTypeLabel}
          unit={['bloco', 'blocos']}
        />
        <Group
          title="Arestas"
          rows={comparison.edges}
          label={edgeKindLabel}
          unit={['aresta', 'arestas']}
        />
      </table>
    </div>
  );
}
