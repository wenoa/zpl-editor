import { create } from "zustand";
import { newId } from "@zplab/core/lib/ids";
import { labelMetaOf } from "@zplab/core/lib/zplLabelMeta";
import { isValidVariableName, nextFreeFnNumber, stripMarkerDelimiters, type Variable } from "@zplab/core/types/Variable";
import { useLabelStore, type LabelState } from "../store/labelStore";
import { finishZplExport } from "./exportZpl";
import { TOKEN_NAME, labelFromZplWithTokens, zplWithTokens } from "./zplTokens";

/* <zplab-editor> (src/element.tsx) opens one label's ZPL and hands it back, its
 * variables as {{name}} tokens. An empty ZPL starts a new label. The application
 * gives the size and the density, which the user cannot change. The variables are
 * the ones the application fills by name: the editor adds the ones the label lacks
 * and the user can neither add, rename nor remove variables. */

export const SAVE_ANSWER_TIMEOUT_MS = 30_000;

/** A variable the application fills by name when it prints. */
export interface RequiredVariable {
  name: string;
  defaultValue?: string;
}

/** The label's size, which the application keeps. */
export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

/** Zebra names its heads' whole dots per millimetre by a rounded dpi: a 203 dpi head prints 8 dots/mm. */
const DOTS_PER_MM_AT_ZEBRA_DPI: Readonly<Record<number, number>> = { 152: 6, 203: 8, 300: 12, 600: 24 };

/** Dots per millimetre of a head of `dpi`, or undefined when no head has that density. */
function dotsPerMm(dpi: number | undefined) {
  if (dpi === undefined || !Number.isInteger(dpi) || dpi <= 0) return undefined;
  return DOTS_PER_MM_AT_ZEBRA_DPI[dpi] ?? dpi / 25.4;
}

/** What a save hands the application. */
export interface EmbedLabel {
  zpl: string;
}

/** Stores the label: the save counts once its result settles, and fails when it throws or rejects. */
export type SaveHandler = (label: EmbedLabel) => unknown;

export interface EmbedError {
  code: "zpl" | "size" | "dpi" | "variables";
  message: string;
}

/** The parts a design file holds. The store replaces each one it changes, so
 *  their references tell whether the document moved since a delivery. */
const DESIGN_KEYS = ["label", "pages", "variables", "columnMapping", "dataSourceRef"] as const;

type Design = Pick<LabelState, (typeof DESIGN_KEYS)[number]>;

const designOf = ({ label, pages, variables, columnMapping, dataSourceRef }: Design): Design => ({
  label,
  pages,
  variables,
  columnMapping,
  dataSourceRef,
});

/** refused: nothing may be saved over the application's label. `delivered` is
 *  what the application last confirmed, or opened with. A failed save keeps its
 *  id, so a late confirmation of that save still lands. */
export type EmbedSession =
  | { phase: "waiting" | "refused" }
  | { phase: "editing"; delivered: Design }
  | { phase: "saving" | "failed"; delivered: Design; saveId: number; sent: Design; message?: string };

export const useEmbedSession = create<EmbedSession>()(() => ({ phase: "waiting" }));

const setSession = (session: EmbedSession) => useEmbedSession.setState(session, true);

/** True while the application holds something other than the open document. */
export function selectEmbedUnsaved(s: Design) {
  const session = useEmbedSession.getState();
  return "delivered" in session && DESIGN_KEYS.some((key) => session.delivered[key] !== s[key]);
}

export function useEmbedUnsaved() {
  const session = useEmbedSession();
  return useLabelStore((s) => "delivered" in session && DESIGN_KEYS.some((key) => session.delivered[key] !== s[key]));
}

let lastSaveId = 0;
let unanswered: ReturnType<typeof setTimeout> | undefined;
let saveHandler: SaveHandler | undefined;

export function setSaveHandler(handler: SaveHandler | undefined) {
  saveHandler = handler;
}

/** Opens `zpl`, or a new label when it is empty, at `size` and `dpi` with the application's variables. */
export function openLabel(
  zpl: unknown,
  variables: readonly RequiredVariable[],
  size: LabelSize | undefined,
  dpi: number | undefined,
): EmbedError | undefined {
  if (typeof zpl !== "string") return refused({ code: "zpl", message: "El ZPL de la etiqueta tiene que ser un texto." });
  const invalid = invalidVariable(variables);
  if (invalid !== undefined) return refused({ code: "variables", message: `El nombre de variable "${invalid}" no es válido.` });
  if (!isValidSize(size)) return refused(INVALID_SIZE);
  const dpmm = dotsPerMm(dpi);
  if (dpmm === undefined) return refused({ code: "dpi", message: "La densidad tiene que ser un número entero de dpi mayor a cero." });
  const store = useLabelStore.getState();
  const fixed = { ...labelMetaOf(store.label), dpmm, ...sizeOf(size) };
  if (zpl.trim() === "") {
    store.loadDesign(fixed, []);
  } else {
    const opened = labelFromZplWithTokens(zpl, dpmm);
    if (opened === undefined) return refused({ code: "zpl", message: "El ZPL no contiene una etiqueta que se pueda abrir." });
    // The application's defaults come first: a token carries only its name.
    const named = [...variables, ...opened.tokens.map((name) => ({ name }))];
    store.loadDesign({ ...opened.labelConfig, ...fixed }, opened.pages, withRequiredVariables(opened.variables, named));
  }
  useLabelStore.setState((s) => ({ variables: withRequiredVariables(s.variables, variables) }));
  // The opened label is where the session's history starts.
  useLabelStore.temporal.getState().clear();
  clearTimeout(unanswered);
  setSession({ phase: "editing", delivered: designOf(useLabelStore.getState()) });
  return undefined;
}

/** Adds the application's variables the open label lacks. */
export function requireVariables(variables: readonly RequiredVariable[]): EmbedError | undefined {
  const invalid = invalidVariable(variables);
  if (invalid !== undefined) return { code: "variables", message: `El nombre de variable "${invalid}" no es válido.` };
  useLabelStore.setState((s) => ({ variables: withRequiredVariables(s.variables, variables) }));
  return undefined;
}

/** Gives the open label `size`. Not the user's edit: neither undone nor waiting to be saved. */
export function resizeLabel(size: LabelSize | undefined): EmbedError | undefined {
  if (!isValidSize(size)) return INVALID_SIZE;
  const previous = useLabelStore.getState().label;
  const { temporal } = useLabelStore;
  temporal.getState().pause();
  useLabelStore.getState().setLabelConfig(sizeOf(size));
  temporal.getState().resume();
  const resized = useLabelStore.getState().label;
  const session = useEmbedSession.getState();
  const followed = (design: Design) => (design.label === previous ? { ...design, label: resized } : design);
  if ("sent" in session) setSession({ ...session, delivered: followed(session.delivered), sent: followed(session.sent) });
  else if ("delivered" in session) setSession({ ...session, delivered: followed(session.delivered) });
  return undefined;
}

/** True when `zpl` is what the editor would hand over now. */
export const showsZpl = (zpl: unknown) => zpl === zplOf(useLabelStore.getState());

export function saveLabel() {
  const session = useEmbedSession.getState();
  if (!("delivered" in session)) return;
  const s = useLabelStore.getState();
  const saveId = ++lastSaveId;
  setSession({ phase: "saving", delivered: session.delivered, saveId, sent: designOf(s) });
  clearTimeout(unanswered);
  unanswered = setTimeout(() => settleSave(saveId, false), SAVE_ANSWER_TIMEOUT_MS);
  const handler = saveHandler;
  const label: EmbedLabel = { zpl: zplOf(s) };
  // Each save keeps its own result, so a late one settles that save alone.
  Promise.resolve()
    .then(() => {
      if (handler === undefined) throw new Error("No hay dónde guardar la etiqueta.");
      return handler(label);
    })
    .then(
      () => settleSave(saveId, true),
      (error: unknown) => settleSave(saveId, false, error instanceof Error ? error.message : typeof error === "string" ? error : undefined),
    );
}

/** Settles that save only: an answer to an earlier one changes nothing. */
function settleSave(saveId: number, ok: boolean, message?: string) {
  const session = useEmbedSession.getState();
  if (!("saveId" in session) || session.saveId !== saveId) return;
  if (saveId === lastSaveId) clearTimeout(unanswered);
  setSession(ok ? { phase: "editing", delivered: session.sent } : { ...session, phase: "failed", message });
}

const INVALID_SIZE: EmbedError = { code: "size", message: "La etiqueta necesita un ancho y un alto mayores a cero." };

function isValidSize(size: LabelSize | undefined): size is LabelSize {
  return size !== undefined && [size.widthMm, size.heightMm].every((mm) => Number.isFinite(mm) && mm > 0);
}

const sizeOf = ({ widthMm, heightMm }: LabelSize) => ({ widthMm, heightMm });

const zplOf = ({ label, pages, variables }: Design) => finishZplExport(zplWithTokens(label, pages, variables));

/** Nothing may be saved over the application's label. */
function refused(error: EmbedError) {
  setSession({ phase: "refused" });
  return error;
}

/** A name travels as a {{name}} token, so it holds only letters, digits and _ . -. */
function invalidVariable(variables: readonly RequiredVariable[]) {
  return variables.find(({ name }) => !isValidVariableName(name) || !TOKEN_NAME.test(name))?.name;
}

/** Adds the missing ones on the lowest free ^FN slots; the same list when none is missing. */
function withRequiredVariables(variables: Variable[], required: readonly RequiredVariable[]) {
  return required.reduce((completed, { name, defaultValue }) => {
    if (completed.some((variable) => variable.name === name)) return completed;
    const fnNumber = nextFreeFnNumber(completed.map((variable) => variable.fnNumber));
    if (fnNumber === null) return completed;
    return [...completed, { id: newId(), name, fnNumber, defaultValue: stripMarkerDelimiters(defaultValue ?? "") }];
  }, variables);
}
