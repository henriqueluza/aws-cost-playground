import { SelectField } from '../../../shared/ui';
import type { Edge, EdgeKind } from '../../../shared/lib/design';
import { announce } from '../hooks/announcer';
import { useDesignStore } from '../hooks/useDesignStore';
import { buildEdgeForm } from '../model/blockForm';
import {
  allowedKinds,
  edgeCostNote,
  edgeKindDefinition,
  endpointService,
  endpointType,
  EDGE_STYLE,
} from '../model/edgeKinds';
import styles from './InspectorPanel.module.css';
import { UsageItem } from './UsageItem';

/** Uma ponta: o nome do serviço (do contrato) e, se for bloco, o rótulo do usuário como texto. */
function End({ id, term }: { id: string; term: string }) {
  const doc = useDesignStore((s) => s.document);
  const label = doc.blocks.find((b) => b.id === id)?.label.trim();
  const service = endpointService(doc, id);
  return (
    <div className={styles.end}>
      <dt>{term}</dt>
      <dd>{label ? `${service}, ${label}` : service}</dd>
    </div>
  );
}

/** Inspetor da aresta selecionada: pontas, tipo, volume com origem e se ela custa. */
export function EdgeInspector({ edge }: { edge: Edge }) {
  const doc = useDesignStore((s) => s.document);
  const setEdgeKind = useDesignStore((s) => s.setEdgeKind);
  const setOverride = useDesignStore((s) => s.setOverride);
  const target = { kind: 'edge', id: edge.id } as const;
  const source = endpointType(doc, edge.source);
  const to = endpointType(doc, edge.target);
  const kinds = source && to ? allowedKinds(source, to) : [];
  const definition = edgeKindDefinition(edge.kind);
  const form = definition ? buildEdgeForm(definition, edge) : { usage: [] };
  const note = edgeCostNote(doc, edge);
  const locked = kinds.length < 2;
  return (
    <div className={styles.inspector}>
      <h2 className={styles.title}>Conexão</h2>
      <dl className={styles.ends} aria-label="Pontas da conexão">
        <End id={edge.source} term="De" />
        <End id={edge.target} term="Para" />
      </dl>
      <section className={styles.group} aria-labelledby={`${edge.id}-tipo`}>
        <h3 id={`${edge.id}-tipo`} className={styles.section}>
          Tipo
        </h3>
        <SelectField
          label="Tipo da conexão"
          value={edge.kind}
          disabled={locked}
          onChange={(e) => {
            const next = kinds.find((kind) => kind === e.target.value);
            if (next && setEdgeKind(edge.id, next).ok) {
              announce(`Tipo da conexão: ${EDGE_STYLE[next].label}`);
            }
          }}
        >
          {(kinds.length > 0 ? kinds : [edge.kind]).map((kind: EdgeKind) => (
            <option key={kind} value={kind}>
              {`${EDGE_STYLE[kind].label} (${EDGE_STYLE[kind].stroke})`}
            </option>
          ))}
        </SelectField>
        {locked ? (
          <p className={styles.note}>O contrato só permite este tipo entre estes dois blocos.</p>
        ) : null}
      </section>
      {form.usage.length > 0 ? (
        <section className={styles.group} aria-labelledby={`${edge.id}-uso`}>
          <h3 id={`${edge.id}-uso`} className={styles.section}>
            Uso mensal
          </h3>
          {form.usage.map((field) => (
            <UsageItem
              key={field.key}
              field={field}
              estimated={edge.usage.source === 'llm'}
              onChange={(key, value) => setOverride(target, key, value)}
              onReset={(key) => setOverride(target, key, null)}
            />
          ))}
        </section>
      ) : (
        <p className={styles.note}>Este tipo de conexão não tem volume de dados.</p>
      )}
      <section className={styles.group} aria-labelledby={`${edge.id}-custo`}>
        <h3 id={`${edge.id}-custo`} className={styles.section}>
          Custo
        </h3>
        <p className={styles.note}>{note.text}</p>
      </section>
    </div>
  );
}
