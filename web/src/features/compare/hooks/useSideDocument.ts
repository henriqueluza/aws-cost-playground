import type { ApiErrorKind } from '../../../shared/lib/api';
import type { DesignDocument } from '../../../shared/lib/design';
import { useSavedDesign } from '../../designs';
import { useDesignStore } from '../../editor';

/** De onde vem o design de um lado: o do editor, um arquivo já validado ou um salvo na conta. */
export type Source =
  | { readonly kind: 'editor' }
  | { readonly kind: 'file'; readonly file: { name: string; document: DesignDocument } | null }
  | { readonly kind: 'saved'; readonly id: string | null };

/** O documento de um lado, antes de calcular o custo. */
export type SideDocument =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly kind: ApiErrorKind; readonly retry: () => void }
  | { readonly status: 'ready'; readonly document: DesignDocument };

/**
 * Só lê: o do editor vem da store sem alterá-la; o salvo, da API (só quando a origem é "salvo",
 * que só existe com sessão) e validado com zod; o arquivo já foi validado ao ser aberto.
 */
export function useSideDocument(source: Source): SideDocument {
  const editor = useDesignStore((s) => s.document);
  const saved = useSavedDesign(source.kind === 'saved' ? source.id : null);
  if (source.kind === 'editor') return { status: 'ready', document: editor };
  if (source.kind === 'file') {
    return source.file === null
      ? { status: 'empty' }
      : { status: 'ready', document: source.file.document };
  }
  if (saved.status === 'idle') return { status: 'empty' };
  if (saved.status === 'ready') return { status: 'ready', document: saved.data.document };
  return saved;
}
