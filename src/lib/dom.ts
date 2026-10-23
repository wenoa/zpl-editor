/** Where ZPLab draws when it runs inside <zplab-editor> (src/element.tsx). */
export interface ShadowMount {
  host: HTMLElement;
  root: ShadowRoot;
  /** Popups open here, where the shadow root's styles reach them. */
  popups: HTMLElement;
}

let shadowMount: ShadowMount | null = null;

export function setShadowMount(mount: ShadowMount | null): void {
  shadowMount = mount;
}

export const popupLayer = (): HTMLElement => shadowMount?.popups ?? document.body;

/** Carries `data-theme`, which the CSS variables in index.css read. */
export const themeHolder = (): HTMLElement => shadowMount?.host ?? document.documentElement;

/** The focused element: the document's own names a shadow host instead of what has focus inside it. */
export function activeElement(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** The selection as seen from `node`: inside a shadow root Chromium answers only
 *  through the root, and Safari only through composed ranges. */
export function selectionAt(node: Node): Pick<Selection, "rangeCount" | "isCollapsed" | "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset"> | null {
  const root = node.getRootNode();
  const selection = window.getSelection();
  if (!(root instanceof ShadowRoot)) return selection;
  const own = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
  if (own) return own;
  const composed = composedRange(selection, root);
  if (!composed) return selection;
  const backward = selection?.direction === "backward";
  return {
    rangeCount: 1,
    isCollapsed: composed.collapsed,
    anchorNode: backward ? composed.endContainer : composed.startContainer,
    anchorOffset: backward ? composed.endOffset : composed.startOffset,
    focusNode: backward ? composed.startContainer : composed.endContainer,
    focusOffset: backward ? composed.startOffset : composed.endOffset,
  };
}

type ComposedRanges = (...args: [{ shadowRoots: ShadowRoot[] }] | ShadowRoot[]) => StaticRange[];

/** Safari before the options form takes the shadow roots as plain arguments, and rejects an options object. */
function composedRange(selection: Selection | null, root: ShadowRoot): StaticRange | undefined {
  const ranges = (selection as Selection & { getComposedRanges?: ComposedRanges } | null)?.getComposedRanges?.bind(selection);
  if (!ranges) return undefined;
  try {
    return ranges({ shadowRoots: [root] })[0];
  } catch {
    return ranges(root)[0];
  }
}

/** Returns `true` when `el` is a text-input surface that should
 *  intercept keyboard events the global shortcuts and canvas
 *  handlers would otherwise act on (Backspace → delete object,
 *  Ctrl+A → select all objects, etc.). `data-text-surface` marks editor
 *  HOSTS whose focus target is not contenteditable itself (the read-only
 *  CodeMirror pane focuses .cm-scroller; gutters sit beside .cm-content). */
export function isEditableTarget(el: HTMLElement | null): boolean {
  // Listeners on window/document pass whatever `e.target` is; only elements
  // can be editable (and only they have `closest`).
  if (!el || !(el instanceof Element)) return false;
  // A key typed inside a shadow root reaches window with the host as its target.
  while (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    el.isContentEditable || el.closest("[data-text-surface]") !== null
  );
}
