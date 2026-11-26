import { EmptyState } from '../../../shared/ui';
import { blockDefinition } from '../../pricing';
import { useDesignStore } from '../hooks/useDesignStore';
import { BlockInspector } from './BlockInspector';
import styles from './InspectorPanel.module.css';

/** Aba "Bloco" da coluna direita: o formulário do bloco selecionado na store. */
export function InspectorPanel() {
  const selection = useDesignStore((s) => s.selection);
  const block = useDesignStore((s) =>
    s.selection?.kind === 'block'
      ? s.document.blocks.find((b) => b.id === s.selection?.id)
      : undefined,
  );
  const definition = block ? blockDefinition(block.type) : undefined;

  if (block && definition) {
    return <BlockInspector key={block.id} block={block} definition={definition} />;
  }
  if (block) {
    return (
      <EmptyState
        title="Tipo de bloco desconhecido"
        description="Este bloco não está no contrato desta versão, então não há o que editar."
        action={
          <span className={styles.hint}>
            Apague o bloco no canvas ou abra o design em outra versão.
          </span>
        }
      />
    );
  }
  if (selection?.kind === 'edge') {
    return (
      <EmptyState
        title="Aresta selecionada"
        description="A edição de aresta não está disponível aqui. Selecione um bloco para editar seus valores."
        action={<span className={styles.hint}>Clique em um bloco no canvas.</span>}
      />
    );
  }
  return (
    <EmptyState
      title="Nenhum bloco selecionado"
      description="Selecione um bloco no canvas para ver e editar seus atributos e valores de uso."
      action={<span className={styles.hint}>Clique em um bloco no canvas.</span>}
    />
  );
}
