export { EditorPage } from './ui/EditorPage';
export { keepDesignForLogin } from './hooks/designDraftSync';
export { designFileMessage, readDesignFile, type DesignFileError } from './model/designFile';
export { discardDesignDraft } from './model/designDraft';
export { useDesignStore } from './hooks/useDesignStore';
export { designStore } from './hooks/designStore';
export { hasUnsavedChanges } from './model/unsaved';
export { EMPTY_STATE } from './model/editorState';
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
