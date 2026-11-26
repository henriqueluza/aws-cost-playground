import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { DesignDocument } from '../../../shared/lib/design';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Notice } from '../../../shared/ui/Notice';
import { fixedShare, type CostRow } from '../application/costRows';
import { formatQuantity, formatUnitPrice, formatUsd } from '../application/formatUsd';
import type { CatalogErrorKind } from '../application/loadCatalog';
import { useCostView } from '../hooks/useCostView';
import type { PriceCatalogState } from '../hooks/usePriceCatalog';
import { CategoryIcon } from './CategoryIcon';
import styles from './PricingPanel.module.css';

/** Seleção do painel: o mesmo formato da store do editor, declarado aqui para não importá-la. */
export type CostSelection = { readonly kind: 'block' | 'edge'; readonly id: string } | null;

export interface PricingPanelProps {
  readonly design: DesignDocument;
  readonly catalog: PriceCatalogState;
  readonly selection: CostSelection;
  readonly onSelect: (selection: CostSelection) => void;
}

/** Texto próprio por tipo de erro; nunca `error.message` (DESIGN.md, estado de erro). */
function errorText(kind: CatalogErrorKind, region: string): string {
  if (kind === 'network')
    return 'Não foi possível buscar os preços. Verifique a conexão e tente de novo.';
  if (kind === 'missing') return `Sem preços de ${region} neste momento.`;
  if (kind === 'integrity')
    return 'Os preços não passaram na verificação de integridade e foram recusados.';
  return 'O arquivo de preços chegou inválido e foi recusado.';
}

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

function SplitBar(props: { fixed: number }): ReactElement {
  const hatch = useId();
  const fixedPct = `${props.fixed * 100}%`;
  return (
    <svg className={styles.split} aria-hidden="true" focusable="false">
      <defs>
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" className={styles.hatch} />
        </pattern>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="8"
        className={styles.variable}
        fill={`url(#${hatch})`}
      />
      <rect x="0" y="0" width={fixedPct} height="8" className={styles.fixed} />
    </svg>
  );
}

function Detail({ row, id, open }: { row: CostRow; id: string; open: boolean }): ReactElement {
  let body: ReactElement;
  if (row.status === 'unavailable') {
    body = (
      <p className={styles.legend}>Sem preço no catálogo para este item. Ele fica fora do total.</p>
    );
  } else if (row.lines.length === 0) {
    body = <p className={styles.legend}>Este item não tem cobrança própria.</p>;
  } else {
    body = (
      <ul className={styles.lines} aria-label={`Cobranças de ${row.name}`}>
        {row.lines.map((line, i) => (
          <li key={`${line.sku}-${i}`} className={styles.line}>
            <span className={styles.sku}>{line.sku}</span>
            <span className={styles.amount}>{formatUsd(line.amount)}</span>
            <span className={styles.calc}>
              {formatQuantity(line.quantity)} × {formatUnitPrice(line.unitPrice)}
            </span>
            <span className={styles.charge}>{line.charge === 'fixed' ? 'fixo' : 'variável'}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <tr id={id} hidden={!open}>
      <td colSpan={2} className={styles.detail}>
        {body}
      </td>
    </tr>
  );
}

interface TableProps {
  readonly caption: string;
  readonly rows: readonly CostRow[];
  readonly selection: CostSelection;
  readonly onSelect: (selection: CostSelection) => void;
  readonly register: (key: string, el: HTMLElement | null) => void;
}

function CostTable({ caption, rows, selection, onSelect, register }: TableProps): ReactElement {
  const base = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{caption}</caption>
      <thead className={styles.srOnly}>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Custo por mês</th>
        </tr>
      </thead>
      {rows.map((row) => {
        const key = keyOf(row.kind, row.id);
        const detailId = `${base}-${key}`;
        const isOpen = open.has(key);
        const selected = selection?.kind === row.kind && selection.id === row.id;
        const unavailable = row.status === 'unavailable';
        const zero = !unavailable && row.total === 0n;
        const sub = [row.kind === 'edge' ? row.meta : null, unavailable ? 'sem preço' : null]
          .filter(Boolean)
          .join(' · ');
        return (
          <tbody key={key} ref={(el) => register(key, el)} data-selected={selected || undefined}>
            <tr className={styles.row}>
              <th scope="row">
                <button
                  type="button"
                  className={styles.button}
                  aria-expanded={isOpen}
                  aria-controls={detailId}
                  aria-current={selected || undefined}
                  onClick={() => {
                    onSelect({ kind: row.kind, id: row.id });
                    toggle(key);
                  }}
                >
                  <span className={styles.label}>
                    {row.category && (
                      <CategoryIcon category={row.category} className={styles.icon} />
                    )}
                    <span className={styles.text} title={row.name}>
                      {row.name}
                    </span>
                  </span>
                  {sub && <span className={styles.sub}>{sub}</span>}
                  <svg className={styles.bar} aria-hidden="true" focusable="false">
                    <rect width="100%" height="2" className={styles.trail} />
                    <rect
                      width={`${row.share * 100}%`}
                      height="2"
                      className={row.share === 1 ? styles.fillTop : styles.fill}
                    />
                  </svg>
                </button>
              </th>
              <td className={`${styles.num} ${zero || unavailable ? styles.dim : ''}`}>
                {unavailable ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className={styles.srOnly}>sem preço</span>
                  </>
                ) : (
                  formatUsd(row.total)
                )}
              </td>
            </tr>
            <Detail row={row} id={detailId} open={isOpen} />
          </tbody>
        );
      })}
    </table>
  );
}

function Loading(): ReactElement {
  return (
    <div role="status" className={styles.loading}>
      <span className={styles.srOnly}>Carregando preços</span>
      <span className={`${styles.skel} ${styles.skelTotal}`} aria-hidden="true" />
      {[0, 1, 2].map((i) => (
        <span key={i} className={`${styles.skel} ${styles.skelRow}`} aria-hidden="true" />
      ))}
    </div>
  );
}

export function PricingPanel(props: PricingPanelProps): ReactElement {
  const { design, catalog, selection, onSelect } = props;
  const view = useCostView(design, catalog);
  const titleId = useId();
  const elements = useRef(new Map<string, HTMLElement>());
  const register = (key: string, el: HTMLElement | null) => {
    if (el) elements.current.set(key, el);
    else elements.current.delete(key);
  };
  const selectedKey = selection ? keyOf(selection.kind, selection.id) : null;
  useEffect(() => {
    if (selectedKey) elements.current.get(selectedKey)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedKey]);

  let body: ReactElement;
  if (view.status === 'idle') {
    body = (
      <EmptyState
        title="Nenhum bloco com preço"
        description="Arraste um bloco da paleta para ver o custo mensal."
        action={null}
      />
    );
  } else if (view.status === 'loading') {
    body = <Loading />;
  } else if (view.status === 'error') {
    body = (
      <div className={styles.error}>
        <p className={styles.total}>
          <span aria-hidden="true">—</span>
          <span className={styles.srOnly}>Total indisponível</span>
        </p>
        <Notice tone="negative" message={errorText(view.kind, design.region)} />
        <Button variant="tertiary" onClick={view.retry}>
          Tentar de novo
        </Button>
      </div>
    );
  } else {
    const { estimate, rows, updating } = view;
    body = (
      <div aria-busy={updating}>
        <div className={styles.head}>
          <p className={styles.total}>
            <span>{formatUsd(estimate.total)}</span>
            <span className={styles.per}>/mês</span>
          </p>
          <SplitBar fixed={fixedShare(estimate.fixed, estimate.variable)} />
          <p className={styles.legend}>
            Fixo {formatUsd(estimate.fixed)} · Variável {formatUsd(estimate.variable)}
            {rows.unavailable > 0 && ' · total parcial'}
          </p>
        </div>
        {updating && (
          <p role="status" className={styles.legend}>
            Atualizando os preços…
          </p>
        )}
        {rows.unavailable > 0 && (
          <Notice
            tone="warning"
            message={
              rows.unavailable === 1
                ? '1 item está sem preço e ficou fora do total. O total é parcial.'
                : `${rows.unavailable} itens estão sem preço e ficaram fora do total. O total é parcial.`
            }
          />
        )}
        <CostTable
          caption="Por bloco"
          rows={rows.blocks}
          selection={selection}
          onSelect={onSelect}
          register={register}
        />
        {rows.edges.length > 0 && (
          <CostTable
            caption="Por aresta"
            rows={rows.edges}
            selection={selection}
            onSelect={onSelect}
            register={register}
          />
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <h2 id={titleId} className={styles.title}>
        Preço
      </h2>
      {body}
    </section>
  );
}
