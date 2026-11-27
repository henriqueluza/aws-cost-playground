/**
 * Quotas diárias de estimativa, iguais aos padrões da API (`DEFAULT_QUOTA_*` em
 * `api/app/config.py`, ADR-0001). É o ponto de verdade do `web/`: o fake de desenvolvimento e o
 * backend simulado do e2e leem daqui. Em produção o número exibido vem sempre da API.
 *
 * O teto de custo é dado pela global. Se 5 por usuário for pouco, o autor previu subir só a do
 * usuário para 10 (decisão de 26/11/2026): troque aqui e na API.
 */
export const QUOTA_LIMITS = { userDailyLimit: 5, globalDailyLimit: 30 } as const;
