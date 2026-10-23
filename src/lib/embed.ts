import { create } from "zustand";
import { newId } from "@zplab/core/lib/ids";
import { labelMetaOf } from "@zplab/core/lib/zplLabelMeta";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { isValidVariableName, nextFreeFnNumber, stripMarkerDelimiters, type Variable } from "@zplab/core/types/Variable";
import { useLabelStore, type LabelState } from "../store/labelStore";
import { selectDesignText } from "../store/labelStore.selectors";
import { finishZplExport } from "./exportZpl";

/* <zplab-editor> (src/element.tsx) opens one label and hands it back. Without a
 * design it starts a new label at 300 dpi. The variables are the ones the
 * application fills by name: the editor adds the ones the design lacks and the
 * user can neither add, rename nor remove variables. */

export const SAVE_ANSWER_TIMEOUT_MS = 30_000;

/** A variable the application fills by name when it prints. */
export interface RequiredVariable {
  name: string;
  defaultValue?: string;
}

/** What a save hands the application. */
export interface EmbedLabel {
  zpl: string;
  design: string;
  variables: { name: string; fnNumber: number }[];
}

/** Stores the label: the save counts once its result settles, and fails when it throws or rejects. */
export type SaveHandler = (label: EmbedLabel) => unknown;

export interface EmbedError {
  code: "design" | "variables";
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

/** Opens `design`, or a new label without it, with the application's variables. */
export function openLabel(design: string | undefined, variables: readonly RequiredVariable[]): EmbedError | undefined {
  const invalid = invalidVariable(variables);
  if (invalid !== undefined) {
    setSession({ phase: "refused" });
    return { code: "variables", message: `El nombre de variable "${invalid}" no es válido.` };
  }
  const store = useLabelStore.getState();
  if (design === undefined) {
    store.loadDesign({ ...labelMetaOf(store.label), dpmm: 12 }, []);
  } else if (!store.loadDesignText(design)) {
    setSession({ phase: "refused" });
    return { code: "design", message: "El archivo de diseño no se puede abrir." };
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

/** True when `design` is what the editor already shows. */
export const showsDesign = (design: string) => selectDesignText(useLabelStore.getState()) === design;

export function saveLabel() {
  const session = useEmbedSession.getState();
  if (!("delivered" in session)) return;
  const s = useLabelStore.getState();
  const saveId = ++lastSaveId;
  setSession({ phase: "saving", delivered: session.delivered, saveId, sent: designOf(s) });
  clearTimeout(unanswered);
  unanswered = setTimeout(() => settleSave(saveId, false), SAVE_ANSWER_TIMEOUT_MS);
  const handler = saveHandler;
  const label: EmbedLabel = {
    zpl: finishZplExport(generateMultiPageZPL(s.label, s.pages, s.variables)),
    design: selectDesignText(s),
    variables: s.variables.map(({ name, fnNumber }) => ({ name, fnNumber })),
  };
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

function invalidVariable(variables: readonly RequiredVariable[]) {
  return variables.find(({ name }) => name !== name.trim() || !isValidVariableName(name))?.name;
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
