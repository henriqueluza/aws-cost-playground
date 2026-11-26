import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import type { Quota } from '../../../shared/lib/api';
import { designStore } from '../../editor';
import { runEstimate } from '../application/runEstimate';
import type { EstimateFailure } from '../model/messages';
import { usageContract } from './usageContract';

export type EstimateRun = {
  readonly phase: 'idle' | 'loading';
  /** Impressão digital do que a última estimativa enviou; `null` se não houve nenhuma nesta tela. */
  readonly fingerprint: string | null;
  readonly quota: Quota | null;
  readonly failure: EstimateFailure | null;
  /** Blocos e arestas da última aplicação, para a frase de status. */
  readonly applied: { readonly blocks: number; readonly edges: number } | null;
};

const INITIAL: EstimateRun = {
  phase: 'idle',
  fingerprint: null,
  quota: null,
  failure: null,
  applied: null,
};

/**
 * Estado da tela de carga. `enabled` é `false` para o anônimo: nenhuma chamada sai (nem a da
 * quota). Uma estimativa por vez; ao desmontar, a resposta que chegar não toca mais a store.
 */
export function useWorkloadEstimate(enabled: boolean) {
  const api = useApi();
  const [run, setRun] = useState<EstimateRun>(INITIAL);
  const alive = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api.quota.get().then(
      (quota) => current && setRun((r) => ({ ...r, quota })),
      () => undefined, // sem a linha de quota; a estimativa ainda mostra o erro próprio
    );
    return () => {
      current = false;
    };
  }, [api, enabled]);

  const estimate = useCallback(async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    setRun((r) => ({ ...r, phase: 'loading', failure: null, applied: null }));
    try {
      const outcome = await runEstimate({
        api,
        document: {
          current: () => designStore.getState().document,
          commit: (next) => designStore.getState().applyEstimate(next).ok,
        },
        contract: usageContract,
        now: () => new Date().toISOString(),
        active: () => alive.current,
      });
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'failed') {
        setRun((r) => ({ ...r, phase: 'idle', failure: outcome.failure }));
        // A quota pode ter sido consumida mesmo com a falha: mostre o que resta de verdade.
        if (outcome.failure.kind !== 'sign-in') {
          api.quota.get().then(
            (quota) => alive.current && setRun((r) => ({ ...r, quota })),
            () => undefined,
          );
        }
        return;
      }
      const used = outcome.blocks + outcome.edges > 0;
      setRun((r) => ({
        phase: 'idle',
        quota: outcome.quota,
        failure: null,
        fingerprint: used ? outcome.fingerprint : r.fingerprint,
        applied: { blocks: outcome.blocks, edges: outcome.edges },
      }));
    } finally {
      busy.current = false;
    }
  }, [api, enabled]);

  return { run, estimate };
}
