import { createRoot, type Root } from "react-dom/client";
import plexSans400 from "@fontsource/ibm-plex-sans/400.css?inline";
import plexSans500 from "@fontsource/ibm-plex-sans/500.css?inline";
import plexSans600 from "@fontsource/ibm-plex-sans/600.css?inline";
import plexMono400 from "@fontsource/ibm-plex-mono/400.css?inline";
import plexMono500 from "@fontsource/ibm-plex-mono/500.css?inline";
import plexMono600 from "@fontsource/ibm-plex-mono/600.css?inline";
import appCss from "./index.css?inline";
import App from "./App";
import { useLabelStore } from "./store/labelStore";
import { initFootprintMeasurer } from "./lib/footprintMeasurer";
import { setShadowMount } from "./lib/dom";
import {
  openLabel,
  requireVariables,
  resizeLabel,
  selectEmbedUnsaved,
  setSaveHandler,
  showsZpl,
  useEmbedSession,
  type EmbedError,
  type LabelSize,
  type RequiredVariable,
  type SaveHandler,
} from "./lib/embed";

/* <zplab-editor> edits one label inside a shadow root:
 *
 *   zpl          property  the label's ZPL as a save handed it over, "" for a new label
 *   size         property  { widthMm, heightMm }, the label's size: required, it can change while the label is open
 *   dpi          property  a whole number above zero: the printer's density the label is designed at, required
 *   variables    property  [{ name, defaultValue? }], the variables the application fills by name
 *   theme        property  "light" (default) or "dark"
 *   saveHandler  property  (label: { zpl }) => Promise: the ZPL prints at the size and the density, each
 *                          variable a {{name}} token for the application to fill; the save
 *                          counts once it resolves; a rejection's message reaches the user, and without a
 *                          result in 30 s the editor says so and lets the user save again
 *   unsaved      property  read only: true while the open label differs from the last stored one
 *   error        event     detail { code: "zpl" | "size" | "dpi" | "variables", message }
 */

/** Cap on how long the first render waits for the active locale chunk. */
const LOCALE_BOOT_WAIT_MS = 250;

const FONTS = [plexSans400, plexSans500, plexSans600, plexMono400, plexMono500, plexMono600];

initFootprintMeasurer();

class ZplabEditor extends HTMLElement {
  /** Undefined until the application gives it, which refuses to open. */
  #zpl: string | undefined;
  #size: LabelSize | undefined;
  #dpi: number | undefined;
  #variables: readonly RequiredVariable[] = [];
  #theme: "light" | "dark" = "light";
  #saveHandler: SaveHandler | undefined;
  #react: Root | undefined;
  /** Set once the label opened, a microtask after connecting: frameworks set properties after inserting the element. */
  #opened = false;

  get zpl() {
    return this.#zpl;
  }

  set zpl(zpl: string | undefined) {
    this.#zpl = zpl;
    if (this.#opened && !showsZpl(zpl)) this.#open();
  }

  get size() {
    return this.#size;
  }

  set size(size: LabelSize | null | undefined) {
    const same = size?.widthMm === this.#size?.widthMm && size?.heightMm === this.#size?.heightMm;
    this.#size = size ?? undefined;
    if (!this.#opened || same) return;
    if (useEmbedSession.getState().phase === "refused") this.#open();
    else this.#fail(resizeLabel(this.#size));
  }

  get dpi() {
    return this.#dpi;
  }

  set dpi(dpi: number | null | undefined) {
    const same = dpi === this.#dpi;
    this.#dpi = dpi ?? undefined;
    if (this.#opened && !same) this.#open();
  }

  get variables() {
    return this.#variables;
  }

  set variables(variables: readonly RequiredVariable[] | null | undefined) {
    this.#variables = variables ?? [];
    if (this.#opened) this.#fail(requireVariables(this.#variables));
  }

  get theme() {
    return this.#theme;
  }

  set theme(theme: "light" | "dark" | null | undefined) {
    this.#theme = theme === "dark" ? "dark" : "light";
    if (this.#react !== undefined) this.#applyTheme();
  }

  get saveHandler() {
    return this.#saveHandler;
  }

  set saveHandler(handler: SaveHandler | null | undefined) {
    this.#saveHandler = handler ?? undefined;
    if (this.#react !== undefined) setSaveHandler(this.#saveHandler);
  }

  get unsaved() {
    return selectEmbedUnsaved(useLabelStore.getState());
  }

  connectedCallback() {
    // Set before the element was defined, a property sits on the instance and hides the setter.
    for (const name of ["zpl", "size", "dpi", "variables", "theme", "saveHandler"] as const) {
      if (!Object.hasOwn(this, name)) continue;
      const value = this[name];
      Reflect.deleteProperty(this, name);
      (this as Record<typeof name, unknown>)[name] = value;
    }
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [shadowStyles()];
    const app = document.createElement("div");
    app.className = "zplab-root";
    const popups = document.createElement("div");
    root.replaceChildren(app, popups);
    setShadowMount({ host: this, root, popups });
    setSaveHandler(this.#saveHandler);
    this.#applyTheme();
    queueMicrotask(() => {
      if (this.#react === undefined) return;
      this.#opened = true;
      this.#open();
    });
    const react = createRoot(app);
    this.#react = react;
    const { locale, applyLocale } = useLabelStore.getState();
    // A brief head start so the label opens in the browser's language, never a stall.
    void Promise.race([applyLocale(locale), new Promise((resolve) => setTimeout(resolve, LOCALE_BOOT_WAIT_MS))]).then(() => {
      if (this.#react !== react) return;
      react.render(<App />);
    });
  }

  disconnectedCallback() {
    this.#react?.unmount();
    this.#react = undefined;
    this.#opened = false;
    setSaveHandler(undefined);
    setShadowMount(null);
  }

  #open() {
    this.#fail(openLabel(this.#zpl, this.#variables, this.#size, this.#dpi));
  }

  #applyTheme() {
    this.setAttribute("data-theme", this.#theme);
    useLabelStore.getState().setTheme(this.#theme);
  }

  #fail(error: EmbedError | undefined) {
    if (error !== undefined) this.dispatchEvent(new CustomEvent("error", { detail: error }));
  }
}

let styles: CSSStyleSheet | undefined;

/** The app's stylesheet for the shadow root. The page keeps what a shadow root
 *  ignores: the fonts are registered there, and Tailwind's registered properties
 *  become plain declarations here. */
function shadowStyles() {
  if (styles !== undefined) return styles;
  styles = new CSSStyleSheet();
  // The page's root font size must not scale the editor.
  styles.replaceSync(appCss.replace(/(?<=[\s(,:*-])(\d*\.?\d+)rem\b/g, (_, rem: string) => `${Number(rem) * 16}px`));
  const fonts = [...FONTS];
  const inherited: string[] = [];
  const reset: string[] = [];
  for (let i = styles.cssRules.length - 1; i >= 0; i--) {
    const rule = styles.cssRules[i];
    if (rule instanceof CSSFontFaceRule) fonts.push(rule.cssText);
    else if (rule instanceof CSSPropertyRule) {
      (rule.inherits ? inherited : reset).push(`${rule.name}: ${rule.initialValue ?? "initial"};`);
    } else continue;
    styles.deleteRule(i);
  }
  // Lowest first: the page's inherited styles stop at the host, and Tailwind's layers override both.
  styles.insertRule(`@layer zplab-reset { :host { all: initial; ${inherited.join(" ")} } *, ::before, ::after, ::backdrop { ${reset.join(" ")} } }`, 0);
  styles.insertRule(`:host { display: block; height: 100%; font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); }`, styles.cssRules.length);
  styles.insertRule(`.zplab-root { height: 100%; }`, styles.cssRules.length);
  if (document.getElementById("zplab-fonts") === null) {
    const page = document.createElement("style");
    page.id = "zplab-fonts";
    page.textContent = fonts.join("\n");
    document.head.append(page);
  }
  return styles;
}

if (!customElements.get("zplab-editor")) customElements.define("zplab-editor", ZplabEditor);

declare global {
  interface HTMLElementTagNameMap {
    "zplab-editor": ZplabEditor;
  }
}
