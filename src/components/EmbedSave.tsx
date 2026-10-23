import { useEffect } from "react";
import { saveLabel, useEmbedSession, useEmbedUnsaved } from "../lib/embed";

/** Hands the label to the application. */
export function EmbedSaveButton() {
  const phase = useEmbedSession((s) => s.phase);
  const unsaved = useEmbedUnsaved();

  // The browser's own prompt guards closing the page and reloading it.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return (
    <button
      onClick={saveLabel}
      disabled={!unsaved || (phase !== "editing" && phase !== "failed")}
      className="px-2.5 py-1 rounded bg-accent text-bg text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
    >
      Guardar
    </button>
  );
}

/** Shown while a save has not reached the application, with its reason when it gave one. */
export function EmbedNotice() {
  const session = useEmbedSession();
  if (session.phase !== "failed") return null;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-red-950/40 border-b border-red-800/50 font-mono text-[10px] text-red-300">
      La aplicación no confirmó el guardado. {session.message}
    </div>
  );
}
