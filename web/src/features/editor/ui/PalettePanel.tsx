import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Button, EmptyState, IconButton, TextField } from '../../../shared/ui';
import { designStore } from '../hooks/designStore';
import {
  BLOCK_DRAG_MIME,
  buildPalette,
  filterPalette,
  newBlockFor,
  nextBlockPosition,
  type PaletteItem,
} from '../model/palette';
import styles from './EditorPage.module.css';
import palette from './PalettePanel.module.css';
import { Icon } from './CategoryIcon';
import { GripIcon, GroupIcon } from './PaletteIcons';

const GROUPS = buildPalette();
const TOTAL = GROUPS.reduce((sum, group) => sum + group.items.length, 0);

function plural(n: number): string {
  return n === 1 ? '1 bloco' : `${n} blocos`;
}

/**
 * Paleta dos blocos do contrato. Cada item é um botão: Enter ou Espaço adiciona o bloco ao canvas
 * e o arrasto (HTML5, `BLOCK_DRAG_MIME`) o solta numa posição. Um só ponto de Tab (tabindex
 * móvel); setas, Home e End percorrem os itens visíveis.
 */
export function PalettePanel({ onCollapse }: { onCollapse?: () => void } = {}) {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const groups = filterPalette(GROUPS, query);
  const visible = groups.flatMap((group) => group.items);
  const tabStop = visible.find((item) => item.type === current)?.type ?? visible[0]?.type;

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') ?? []);

  const onSearch = (value: string) => {
    setQuery(value);
    const count = filterPalette(GROUPS, value).reduce((sum, g) => sum + g.items.length, 0);
    setNotice(count === 0 ? 'Nenhum bloco encontrado.' : `${plural(count)} na paleta.`);
  };

  const add = (item: PaletteItem) => {
    const block = newBlockFor(item.type);
    if (!block) return;
    const state = designStore.getState();
    const result = state.addBlock(block, nextBlockPosition(state.layout));
    setNotice(
      result.ok
        ? `${item.name} adicionado ao canvas.`
        : `Não foi possível adicionar ${item.name}: o design chegou ao limite de blocos.`,
    );
  };

  const onItemKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const list = items();
    const index = list.indexOf(event.currentTarget);
    const target = {
      ArrowDown: list[index + 1],
      ArrowUp: list[index - 1],
      Home: list[0],
      End: list.at(-1),
    }[event.key];
    if (!(event.key in { ArrowDown: 1, ArrowUp: 1, Home: 1, End: 1 })) return;
    event.preventDefault();
    if (target) target.focus();
    else if (event.key === 'ArrowUp') searchRef.current?.querySelector('input')?.focus();
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, item: PaletteItem) => {
    event.dataTransfer.setData(BLOCK_DRAG_MIME, item.type);
    event.dataTransfer.effectAllowed = 'copy';
    setDragging(item.type);
  };

  return (
    <>
      <div className={palette.header}>
        <h2 className={styles.panelTitle}>Paleta</h2>
        {onCollapse && (
          <IconButton
            variant="secondary"
            aria-label="Recolher a paleta"
            aria-expanded={true}
            data-palette-toggle
            onClick={onCollapse}
          >
            <Icon name="panel-collapse" />
          </IconButton>
        )}
      </div>
      <div ref={searchRef} className={palette.search}>
        <TextField
          label="Buscar bloco"
          placeholder="Nome ou tipo"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '') onSearch('');
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              items()[0]?.focus();
            }
          }}
        />
      </div>
      <p role="status" className={styles.hidden}>
        {notice}
      </p>
      <div ref={listRef} className={palette.results}>
        {groups.length === 0 ? (
          <EmptyState
            title="Nenhum bloco encontrado"
            description={`Nada na paleta combina com a busca, entre os ${TOTAL} blocos.`}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  onSearch('');
                  searchRef.current?.querySelector('input')?.focus();
                }}
              >
                Limpar busca
              </Button>
            }
          />
        ) : (
          groups.map((group) => (
            <div key={group.id} className={palette.group}>
              <h3 id={`${hintId}-${group.id}`} className={palette.groupTitle}>
                {group.label}
              </h3>
              <ul className={palette.list} aria-labelledby={`${hintId}-${group.id}`}>
                {group.items.map((item) => (
                  <li key={item.type}>
                    <button
                      type="button"
                      className={palette.item}
                      data-group={group.id}
                      data-dragging={dragging === item.type || undefined}
                      draggable
                      tabIndex={item.type === tabStop ? 0 : -1}
                      title={item.hint}
                      aria-describedby={item.type === tabStop ? `${hintId}-dica` : undefined}
                      onFocus={() => setCurrent(item.type)}
                      onClick={() => add(item)}
                      onKeyDown={onItemKey}
                      onDragStart={(event) => onDragStart(event, item)}
                      onDragEnd={() => setDragging(null)}
                    >
                      <span className={palette.tile}>
                        <GroupIcon group={group.id} />
                      </span>
                      <span className={palette.name}>{item.name}</span>
                      <span className={palette.grip}>
                        <GripIcon />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <p id={`${hintId}-dica`} className={styles.hidden}>
        Enter ou Espaço adiciona ao canvas; também dá para arrastar.
      </p>
    </>
  );
}
