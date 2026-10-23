// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { serializeDesign } from "@zplab/core/lib/designFile";
import {
  SAVE_ANSWER_TIMEOUT_MS,
  openLabel,
  requireVariables,
  saveLabel,
  setSaveHandler,
  useEmbedSession,
  type EmbedLabel,
} from "./embed";
import { isEditableTarget } from "./dom";
import { useLabelStore } from "../store/labelStore";
import { RightSidebar } from "../components/RightSidebar/RightSidebar";
import { EmbedNotice, EmbedSaveButton } from "../components/EmbedSave";
import { addableGroupsFor } from "../components/Palette/paletteGroups";
import type { LabelCanvasHandle } from "../components/Canvas/LabelCanvas";

// The store reads both as it loads: built as <zplab-editor>, next to a session this origin keeps.
const STANDALONE_SESSION = vi.hoisted(() => {
  vi.stubEnv("MODE", "element");
  const session = JSON.stringify({ state: { label: { widthMm: 33, heightMm: 22, dpmm: 8 } }, version: 19 });
  localStorage.setItem("zpl-designer-session", session);
  return session;
});

const designWithCustomer = serializeDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }], [
  { id: "v1", name: "customer", fnNumber: 3, defaultValue: "ACME" },
]);

const store = () => useLabelStore.getState();

const saveOffered = () => {
  render(<EmbedSaveButton />);
  return !screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled");
};

/** A save the application has not answered yet. */
interface Pending {
  label: EmbedLabel;
  store: () => void;
  fail: (error: unknown) => void;
}

let pending: Pending[];

/** The nth save the application received. */
const received = (n: number) => {
  const save = pending[n];
  if (save === undefined) throw new Error(`no save #${n}`);
  return save;
};

/** Lets the save's result reach the editor. */
const settled = () => act(() => Promise.resolve());

beforeEach(() => {
  pending = [];
  setSaveHandler(
    (label) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ label, store: resolve, fail: reject });
      }),
  );
});

afterEach(() => {
  cleanup();
  setSaveHandler(undefined);
  vi.useRealTimers();
});

describe("the application opens a label", () => {
  it("opens the design file it gives", () => {
    expect(openLabel(designWithCustomer, [])).toBeUndefined();

    expect(store().label.widthMm).toBe(50);
    expect(useEmbedSession.getState().phase).toBe("editing");
  });

  it("starts a new label at 300 dpi without a design", () => {
    store().loadDesignText(designWithCustomer);

    openLabel(undefined, []);

    expect(store().variables).toEqual([]);
    expect(store().label.dpmm).toBe(12);
  });

  it("adds the variables the design lacks on free slots and keeps the ones it has", () => {
    openLabel(designWithCustomer, [{ name: "customer" }, { name: "lot", defaultValue: "«L-1»" }]);

    expect(store().variables).toEqual([
      expect.objectContaining({ name: "customer", fnNumber: 3, defaultValue: "ACME" }),
      expect.objectContaining({ name: "lot", fnNumber: 1, defaultValue: "L-1" }),
    ]);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("adds the variables it requires later to the open label", () => {
    openLabel(designWithCustomer, []);

    requireVariables([{ name: "lot" }]);

    expect(store().variables.map(({ name }) => name)).toEqual(["customer", "lot"]);
  });

  it("refuses an unreadable design, so nothing is saved over the application's label", () => {
    expect(openLabel("{ not a design", [])).toMatchObject({ code: "design" });

    expect(useEmbedSession.getState()).toEqual({ phase: "refused" });
  });

  it("refuses a variable name the editor cannot hold", () => {
    expect(openLabel(undefined, [{ name: "a«b" }])).toMatchObject({ code: "variables" });

    expect(useEmbedSession.getState()).toEqual({ phase: "refused" });
  });
});

describe("the user saves", () => {
  beforeEach(() => {
    openLabel(designWithCustomer, [{ name: "customer" }]);
  });

  it("only once the label changes", () => {
    expect(saveOffered()).toBe(false);

    act(() => store().setLabelConfig({ widthMm: 60 }));

    expect(screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled")).toBe(false);
  });

  describe("a changed label", () => {
    beforeEach(() => store().setLabelConfig({ widthMm: 60 }));

    it("hands the application the ZPL, the design file and each variable's slot", async () => {
      saveLabel();
      await settled();

      expect(pending).toHaveLength(1);
      expect(received(0).label).toMatchObject({ variables: [{ name: "customer", fnNumber: 3 }] });
      expect(received(0).label.zpl).toContain("^XA");
      expect(JSON.parse(received(0).label.design)).toMatchObject({ label: { widthMm: 60 } });
    });

    it("counts the label as delivered once the application stored it", async () => {
      saveLabel();
      await settled();
      received(0).store();
      await settled();

      expect(useEmbedSession.getState().phase).toBe("editing");
      expect(saveOffered()).toBe(false);
    });

    it("keeps the changes pending and says why when the application could not store it", async () => {
      saveLabel();
      await settled();
      received(0).fail(new Error("backend down"));
      await settled();

      render(<EmbedNotice />);
      expect(screen.getByText("La aplicación no confirmó el guardado. backend down")).toBeTruthy();
      expect(saveOffered()).toBe(true);
    });

    it("lets a late result of an earlier save change nothing", async () => {
      saveLabel();
      store().setLabelConfig({ widthMm: 70 });
      saveLabel();
      await settled();

      received(0).store();
      await settled();

      expect(useEmbedSession.getState().phase).toBe("saving");
      expect(saveOffered()).toBe(false);
    });

    it("stops waiting after a while, and still takes that save's late result", async () => {
      vi.useFakeTimers();
      saveLabel();
      await settled();

      await act(() => vi.advanceTimersByTimeAsync(SAVE_ANSWER_TIMEOUT_MS));
      expect(useEmbedSession.getState().phase).toBe("failed");

      received(0).store();
      await settled();
      expect(saveOffered()).toBe(false);
    });
  });
});

describe("an embedded editor", () => {
  const sidebar = () => render(<RightSidebar canvasRef={createRef<LabelCanvasHandle>()} />);

  beforeEach(() => {
    openLabel(undefined, [{ name: "customer", defaultValue: "ACME" }]);
    act(() => useLabelStore.setState({ selectedIds: [], sidebarTab: "properties" }));
  });

  it("offers the Properties and Variables tabs only", () => {
    sidebar();

    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      store().translations.layers.propertiesTab,
      store().translations.layers.variablesTab,
    ]);
  });

  it("sizes the label by width and height only", () => {
    sidebar();

    expect(screen.queryAllByText(store().translations.label.width, { exact: false })).not.toHaveLength(0);
    expect(screen.queryByText(store().translations.label.dpmm)).toBeNull();
    expect(screen.queryByText(store().translations.label.safeArea)).toBeNull();
  });

  it("keeps the application's variables as they are named, and adds none", () => {
    act(() => useLabelStore.setState({ sidebarTab: "variables" }));

    sidebar();

    expect(screen.getByRole("textbox", { name: store().translations.variables.nameLabel }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: store().translations.variables.add })).toBeNull();
  });

  it("offers Code 128 as its only barcode", () => {
    const barcodes = addableGroupsFor(store().translations)
      .filter(({ key }) => key !== "text" && key !== "shape")
      .flatMap(({ entries }) => entries.map(({ id }) => id));

    expect(barcodes).toEqual(["code128"]);
  });

  it("neither restores nor overwrites the session this origin keeps", () => {
    expect(store().label.widthMm).not.toBe(33);

    store().setLabelConfig({ widthMm: 70 });

    expect(localStorage.getItem("zpl-designer-session")).toBe(STANDALONE_SESSION);
  });

  it("knows a key typed in a field inside a shadow root is typing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const field = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(field);
    field.focus();

    expect(isEditableTarget(host)).toBe(true);
    host.remove();
  });
});
