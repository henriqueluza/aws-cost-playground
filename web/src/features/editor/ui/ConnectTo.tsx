import { useEffect, useRef, useState } from 'react';
import { Button, SelectField } from '../../../shared/ui';
import type { EdgeKind } from '../../../shared/lib/design';
import { announce } from '../hooks/announcer';
import { useDesignStore } from '../hooks/useDesignStore';
import { connectTargets, EDGE_STYLE } from '../model/edgeKinds';
import styles from './InspectorPanel.module.css';

/**
 * "Conectar a…": cria a aresta sem arrastar (WCAG 2.5.7). Só lista os destinos que o contrato
 * permite e que ainda não estão ligados; o tipo vem inferido e só se escolhe quando há mais de um.
 */
export function ConnectTo({ blockId }: { blockId: string }) {
  const doc = useDesignStore((s) => s.document);
  const connect = useDesignStore((s) => s.connect);
  const [targetId, setTargetId] = useState('');
  const [kindChoice, setKindChoice] = useState<EdgeKind | null>(null);
  const [connected, setConnected] = useState(0);
  const select = useRef<HTMLSelectElement>(null);
  const section = useRef<HTMLElement>(null);
  const targets = connectTargets(doc, blockId);
  // Depois de conectar o botão volta a ficar desligado: o foco vai para o campo (ou para a seção, se não restar destino).
  useEffect(() => {
    if (connected > 0) (select.current ?? section.current)?.focus();
  }, [connected]);
  const chosen = targets.find((t) => t.id === targetId);
  const kind = chosen && (chosen.kinds.find((k) => k === kindChoice) ?? chosen.kind);
  const submit = () => {
    if (!chosen || !kind) return;
    if (connect({ source: blockId, target: chosen.id, kind }).ok) {
      announce(`Conexão criada com ${chosen.name}`);
      setTargetId('');
      setKindChoice(null);
      setConnected((n) => n + 1);
    }
  };
  return (
    <section
      ref={section}
      tabIndex={-1}
      className={styles.group}
      aria-labelledby={`${blockId}-conectar`}
    >
      <h3 id={`${blockId}-conectar`} className={styles.section}>
        Conectar a…
      </h3>
      {targets.length === 0 ? (
        <p className={styles.note}>
          Nenhum destino disponível: o contrato não prevê outro, ou todos já estão ligados.
        </p>
      ) : (
        <>
          <SelectField
            ref={select}
            label="Destino"
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              setKindChoice(null);
            }}
          >
            <option value="">Escolha um destino</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          {chosen && chosen.kinds.length > 1 ? (
            <SelectField
              label="Tipo da conexão"
              value={kind}
              onChange={(e) =>
                setKindChoice(chosen.kinds.find((k) => k === e.target.value) ?? null)
              }
            >
              {chosen.kinds.map((k) => (
                <option key={k} value={k}>
                  {`${EDGE_STYLE[k].label} (${EDGE_STYLE[k].stroke})`}
                </option>
              ))}
            </SelectField>
          ) : null}
          <Button variant="secondary" disabled={!chosen} onClick={submit}>
            Conectar
          </Button>
        </>
      )}
    </section>
  );
}
