/** Registers <zplab-editor> when imported. */

export interface ZplabVariable {
  name: string;
  defaultValue?: string;
}

/** What a save hands the application. */
export interface ZplabLabel {
  zpl: string;
  /** The design file text: give it back as `design` to reopen the label. */
  design: string;
  /** The ^FN slot of each variable, to fill the ZPL by name. */
  variables: { name: string; fnNumber: number }[];
}

export interface ZplabError {
  code: "design" | "variables";
  message: string;
}

export interface ZplabEditorEventMap extends HTMLElementEventMap {
  error: CustomEvent<ZplabError>;
}

export interface ZplabEditorElement extends HTMLElement {
  /** The design file text a save handed over; without it a new label at 300 dpi. */
  design: string | null | undefined;
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
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "zplab-editor": ZplabEditorElement;
  }
}
