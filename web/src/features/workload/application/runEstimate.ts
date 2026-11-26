import { isApiError, type Api, type Quota } from '../../../shared/lib/api';
import type { DesignDocument } from '../../../shared/lib/design';
import { failureOf, type EstimateFailure } from '../model/messages';
import {
  applyEstimate,
  estimateFingerprint,
  toEstimateRequest,
  type UsageContract,
} from '../model/estimateModel';

/** O que o fluxo precisa do editor: ler o documento de agora e gravá-lo num passo só. */
export type DocumentPort = {
  current(): DesignDocument;
  commit(next: DesignDocument): boolean;
};

export type EstimateOutcome =
  | {
      readonly status: 'applied';
      readonly quota: Quota;
      /** Impressão digital do que foi ENVIADO: se o diagrama mudou em voo, a estimativa já nasce velha. */
      readonly fingerprint: string;
      readonly blocks: number;
      readonly edges: number;
    }
  | { readonly status: 'failed'; readonly failure: EstimateFailure }
  | { readonly status: 'cancelled' };

type Deps = {
  api: Pick<Api, 'estimates'>;
  document: DocumentPort;
  contract: UsageContract;
  now(): string;
  /** `false` depois que a tela saiu: a resposta não toca mais a store. */
  active(): boolean;
};

/**
 * Pede a estimativa do documento de agora e, se a tela ainda existe, aplica a resposta ao
 * documento de DEPOIS da chamada: só o que ainda existe nele recebe valor (o diagrama pode ter
 * mudado em voo) e `overrides` nunca muda. Nada vem do servidor além de números, ids e enums.
 */
export async function runEstimate(deps: Deps): Promise<EstimateOutcome> {
  const sent = deps.document.current();
  try {
    const response = await deps.api.estimates.estimateUsage(toEstimateRequest(sent));
    if (!deps.active()) return { status: 'cancelled' };
    const applied = applyEstimate(deps.document.current(), response, deps.contract, deps.now());
    if (applied.blocks + applied.edges > 0 && !deps.document.commit(applied.document)) {
      return { status: 'failed', failure: { kind: 'unusable' } };
    }
    return {
      status: 'applied',
      quota: response.quota,
      fingerprint: estimateFingerprint(sent),
      blocks: applied.blocks,
      edges: applied.edges,
    };
  } catch (error) {
    if (!deps.active()) return { status: 'cancelled' };
    return {
      status: 'failed',
      failure: isApiError(error) ? failureOf(error.detail) : { kind: 'unusable' },
    };
  }
}
