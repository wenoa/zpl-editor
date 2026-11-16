/** Registers <zplab-editor> when imported. */

export interface ZplabVariable {
  name: string;
  defaultValue?: string;
}

/** The label's size in millimetres. */
export interface ZplabSize {
  widthMm: number;
  heightMm: number;
}

/** What a save hands the application. */
export interface ZplabLabel {
  /** Prints at the label's size and density. Each variable is a {{name}} token inside a field that
   *  escapes its bytes with ^FH_: give it back as `zpl` to reopen the label. */
  zpl: string;
}

export interface ZplabError {
  code: "zpl" | "size" | "dpi" | "variables";
  message: string;
}

/** The editor's own events. Not an extension of HTMLElementEventMap, whose `error` is an ErrorEvent. */
export interface ZplabEditorEventMap {
  error: CustomEvent<ZplabError>;
}

export interface ZplabEditorElement extends HTMLElement {
  /** The label's ZPL as a save handed it over, "" for a new label. */
  zpl: string;
  /** Required: without a valid size the label does not open. It can change while the label is open. */
  size: ZplabSize | null | undefined;
  /** Required: 152, 203, 300 or 600. The label is designed at this density, which the user cannot change. */
  dpi: number | null | undefined;
  /** The variables the application fills by name. */
  variables: readonly ZplabVariable[] | null | undefined;
  theme: "light" | "dark" | null | undefined;
  /** Stores the label. The save counts once the result resolves; a rejection's message
   *  (an Error's or a string) reaches the user, and without a result in 30 s the editor
   *  says so and lets the user save again. */
  saveHandler: ((label: ZplabLabel) => unknown) | null | undefined;
  /** True while the open label differs from the last stored one. */
  readonly unsaved: boolean;
  addEventListener<K extends keyof ZplabEditorEventMap>(type: K, listener: (this: ZplabEditorElement, event: ZplabEditorEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLElement, event: HTMLElementEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "zplab-editor": ZplabEditorElement;
  }
}
