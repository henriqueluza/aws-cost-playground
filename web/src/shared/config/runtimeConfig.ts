import { z } from 'zod';

/** Credenciais, query ou fragmento não fazem parte de uma URL de serviço e não são aceitos. */
function isBareUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** https em qualquer host; http só em localhost (desenvolvimento). Sem credenciais, query nem fragmento. */
const webUrl = z
  .union([
    z.url({ protocol: /^https$/ }),
    z.url({ protocol: /^http$/, hostname: /^(localhost|127\.0\.0\.1)$/ }),
  ])
  .refine(isBareUrl);

/** Configuração de runtime servida em `/config.json`; é o único arquivo que muda por ambiente. */
export const runtimeConfigSchema = z.object({
  apiBaseUrl: webUrl,
  cognitoAuthority: webUrl,
  cognitoClientId: z.string().regex(/^[\w-]{1,128}$/),
  /** O pool aceita cadastro pelo login gerenciado. Ausente vale fechado: o site não oferece "Criar conta". */
  selfSignupEnabled: z.boolean().default(false),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

let loaded: RuntimeConfig | undefined;

/** Busca `/config.json` sem cache (timeout de 10 s), valida e guarda. Rejeita em qualquer falha. */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchFn('/config.json', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Não foi possível carregar a configuração do aplicativo.');
  const parsed = runtimeConfigSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error('A configuração do aplicativo é inválida.');
  loaded = parsed.data;
  return loaded;
}

/** Configuração já carregada. Lança se chamada antes de `loadRuntimeConfig` resolver. */
export function getRuntimeConfig(): RuntimeConfig {
  if (!loaded) throw new Error('A configuração do aplicativo ainda não foi carregada.');
  return loaded;
}
