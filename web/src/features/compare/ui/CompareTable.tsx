import { useId, type ReactElement } from 'react';
import { formatUsd } from '../../pricing';
import { compare, decimal, div, toFixed, type Decimal } from '../../../shared/lib/money';
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
function Diff(props: { diff: Decimal; large?: boolean; only?: 'A' | 'B' }): ReactElement {
  const { diff, large = false, only } = props;
  const direction = directionOf(diff);
  return (
    <span className={large ? `${styles.diff} ${styles.large}` : styles.diff}>
      <svg viewBox="0 0 16 16" className={styles.icon} aria-hidden="true" focusable="false">
        <path d={ICONS[direction]} />
      </svg>
      <span className={styles.amount}>{formatDiff(diff)}</span>
      <span className={styles.word}>
        {direction === 'same' && only ? `só no ${only}` : DIRECTION_WORD[direction]}
      </span>
    </span>
  );
}

/** Fração `part / whole` como número para geometria (só desenho; dinheiro segue em `Decimal`). */
function fraction(part: Decimal, whole: Decimal): number {
  if (compare(whole, decimal(0)) <= 0) return 0;
  return Math.min(1, Math.max(0, Number(toFixed(div(part, whole), 6))));
}

/**
 * Tinta do fixo (sólida) e do variável (hachurada, DESIGN.md): `width` é a fração do desenho que
 * ocupa e `solid`, a fração dela que é fixo. Lê-se sem cor; os números ficam ao lado.
 */
function Ink(props: { width: number; solid: number; className?: string }): ReactElement {
  const hatch = useId();
  const width = (share: number) => `${props.width * share * 100}%`;
  return (
    <svg className={props.className} aria-hidden="true" focusable="false">
      <defs>
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" className={styles.hatchLine} />
        </pattern>
      </defs>
      <rect width={width(1)} height="100%" className={styles.outline} fill={`url(#${hatch})`} />
      <rect width={width(props.solid)} height="100%" className={styles.solid} />
    </svg>
  );
}

/** Barras dos dois totais na mesma escala (o maior ocupa a largura toda). */
function SplitBars({ comparison: { total, fixed } }: { comparison: Comparison }): ReactElement {
  const scale = compare(total.a, total.b) >= 0 ? total.a : total.b;
  const sides = [
    { side: 'A', total: total.a, fixed: fixed.a },
    { side: 'B', total: total.b, fixed: fixed.b },
  ];
  return (
    <div className={styles.bars} aria-hidden="true">
      {sides.map((one) => (
        <div key={one.side} className={styles.barRow}>
          <span className={styles.barSide}>{one.side}</span>
          <Ink
            className={styles.bar}
            width={fraction(one.total, scale)}
            solid={fraction(one.fixed, one.total)}
          />
        </div>
      ))}
    </div>
  );
}

function Cell(props: {
  title: string;
  amounts: Amounts;
  large?: boolean;
  swatch?: 'fixed' | 'variable';
  bars?: ReactElement;
}) {
  const { title, amounts, large } = props;
  return (
    <div role="group" aria-label={title} className={styles.cell}>
      <p className={styles.cellTitle} aria-hidden="true">
        {props.swatch !== undefined && (
          <Ink className={styles.swatch} width={1} solid={props.swatch === 'fixed' ? 1 : 0} />
        )}
        {title}
        <span className={styles.convention}>B − A</span>
      </p>
      <Diff diff={amounts.diff} large={large} />
      <p className={styles.sides}>
        <span>A {formatUsd(amounts.a)}</span>
        <span>B {formatUsd(amounts.b)}</span>
      </p>
      {props.bars}
    </div>
  );
}

/** Total, fixo e variável numa faixa dividida acima da tabela (DESIGN.md), não num rodapé. */
export function SummaryStrip({ comparison }: { comparison: Comparison }): ReactElement {
  return (
    <section aria-label="Resumo do custo mensal" className={styles.strip}>
      <Cell
        title="Total por mês"
        amounts={comparison.total}
        large
        bars={<SplitBars comparison={comparison} />}
      />
      <Cell title="Fixo" amounts={comparison.fixed} swatch="fixed" />
      <Cell title="Variável" amounts={comparison.variable} swatch="variable" />
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
        <span className={styles.amounts}>
          <span className={styles.money}>{formatUsd(amount)}</span>
          <span className={styles.count}>{plural(count, ...unit)}</span>
        </span>
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
            <Diff
              diff={row.total.diff}
              only={row.countA === 0 ? 'B' : row.countB === 0 ? 'A' : undefined}
            />
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
