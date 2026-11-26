export { EditorPage } from './ui/EditorPage';
export { useDesignStore } from './hooks/useDesignStore';
export type { DesignActions, DesignStoreState } from './hooks/designStore';
export type {
  ActionErrorCode,
  BlockPatch,
  ElementRef,
  NewBlock,
  NewEdge,
  Position,
  Result,
  Selection,
} from './model/editorState';
export {
  BLOCK_DRAG_MIME,
  dropBlock,
  isBlockDrag,
  newBlockFor,
  readDraggedBlockType,
} from './model/palette';
