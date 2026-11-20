import { z } from 'zod';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** https em qualquer host; http só em localhost (desenvolvimento). */
const webUrl = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => value.startsWith('https:') || LOCAL_HOSTS.has(new URL(value).hostname),
    'Use https fora de localhost',
  );

/** Configuração de runtime servida em `/config.json`; é o único arquivo que muda por ambiente. */
export const runtimeConfigSchema = z.object({
  apiBaseUrl: webUrl,
  cognitoAuthority: webUrl,
  cognitoClientId: z.string().regex(/^[\w-]{1,128}$/),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

/**
 * Busca `/config.json` (sem cache, timeout de 10 s), valida e guarda o resultado.
 * Rejeita em resposta não-OK, JSON inválido, timeout ou schema inválido.
 */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  void fetchFn;
  throw new Error('TODO: pacote B');
}

/** Configuração já carregada. Lança se chamada antes de `loadRuntimeConfig` resolver. */
export function getRuntimeConfig(): RuntimeConfig {
  throw new Error('TODO: pacote B');
}
