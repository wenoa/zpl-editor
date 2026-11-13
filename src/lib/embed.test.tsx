// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getEntry } from "@zplab/core/registry";
import type { LabelObject } from "@zplab/core/types/Group";
import {
  SAVE_ANSWER_TIMEOUT_MS,
  openLabel,
  requireVariables,
  resizeLabel,
  saveLabel,
  setSaveHandler,
  showsZpl,
  useEmbedSession,
  type EmbedLabel,
  type LabelSize,
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

const SIZE: LabelSize = { widthMm: 60, heightMm: 40 };
const DPI = 203;

/** A label a save handed over: 50 × 30 mm at 203 dpi, its customer as a token. */
const SAVED = "^XA\n^PW400\n^LL240\n^CI28\n^FO10,15^A0N,30,0^FH_^FDCliente: {{customer:FD}}^FS\n^XZ";

const store = () => useLabelStore.getState();

const text = (content: string) =>
  ({
    id: "t1",
    type: "text",
    x: 10,
    y: 60,
    rotation: 0,
    props: { ...(getEntry("text")?.defaultProps as object), content },
  }) as unknown as LabelObject;

const addText = (content: string) =>
  act(() => useLabelStore.setState((s) => ({ pages: [{ ...s.pages[0], objects: [...(s.pages[0]?.objects ?? []), text(content)] }] })));

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
  it("opens the ZPL it gives at the size and density it gives, each token as its variable", () => {
    expect(openLabel(SAVED, [], SIZE, DPI)).toBeUndefined();

    expect(store().label).toMatchObject({ widthMm: 60, heightMm: 40, dpmm: 8 });
    expect(store().pages[0]?.objects).toEqual([expect.objectContaining({ props: expect.objectContaining({ content: "Cliente: «customer»" }) })]);
    expect(store().variables.map(({ name }) => name)).toEqual(["customer"]);
    expect(useEmbedSession.getState().phase).toBe("editing");
  });

  it("starts a new label at the size and density it gives from an empty ZPL", () => {
    openLabel(SAVED, [], SIZE, DPI);

    openLabel("", [], SIZE, 300);

    expect(store().pages.flatMap(({ objects }) => objects)).toEqual([]);
    expect(store().variables).toEqual([]);
    expect(store().label).toMatchObject({ widthMm: 60, heightMm: 40, dpmm: 12 });
  });

  it("gives a token the application's default", () => {
    openLabel(SAVED, [{ name: "customer", defaultValue: "ACME" }, { name: "lot", defaultValue: "«L-1»" }], SIZE, DPI);

    expect(store().variables).toEqual([
      expect.objectContaining({ name: "customer", defaultValue: "ACME" }),
      expect.objectContaining({ name: "lot", defaultValue: "L-1" }),
    ]);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("adds the variables it requires later to the open label", () => {
    openLabel(SAVED, [], SIZE, DPI);

    requireVariables([{ name: "lot" }]);

    expect(store().variables.map(({ name }) => name)).toEqual(["customer", "lot"]);
  });

  it.each([
    ["zpl", undefined, SIZE, DPI, []],
    ["zpl", "no es ZPL", SIZE, DPI, []],
    ["size", SAVED, undefined, DPI, []],
    ["size", SAVED, { widthMm: 0, heightMm: 40 }, DPI, []],
    ["size", SAVED, { widthMm: Number.NaN, heightMm: 40 }, DPI, []],
    ["dpi", SAVED, SIZE, undefined, []],
    ["dpi", SAVED, SIZE, 250, []],
    ["variables", SAVED, SIZE, DPI, [{ name: "a«b" }]],
    ["variables", SAVED, SIZE, DPI, [{ name: "código cliente" }]],
    ["variables", SAVED, SIZE, DPI, [{ name: "a}b" }]],
  ])("refuses to open with an invalid %s, so nothing is saved over the application's label (%#)", (code, zpl, size, dpi, variables) => {
    expect(openLabel(zpl, variables, size, dpi)).toMatchObject({ code });

    expect(useEmbedSession.getState()).toEqual({ phase: "refused" });
  });
});

describe("the application resizes the open label", () => {
  beforeEach(() => {
    openLabel(SAVED, [], SIZE, DPI);
  });

  it("to the size it gives, which the user cannot undo and need not save", () => {
    expect(resizeLabel({ widthMm: 80, heightMm: 30 })).toBeUndefined();

    expect(store().label).toMatchObject({ widthMm: 80, heightMm: 30 });
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
    expect(saveOffered()).toBe(false);
  });

  it("keeps the label as it is when the size is not valid", () => {
    expect(resizeLabel({ widthMm: 0, heightMm: 30 })).toMatchObject({ code: "size" });

    expect(store().label).toMatchObject({ widthMm: 60, heightMm: 40 });
  });
});

describe("the user saves", () => {
  beforeEach(() => {
    openLabel(SAVED, [{ name: "customer", defaultValue: "ACME" }, { name: "lot" }], SIZE, DPI);
  });

  it("only once the label changes", () => {
    expect(saveOffered()).toBe(false);

    addText("«lot»");

    expect(screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled")).toBe(false);
  });

  describe("a changed label", () => {
    beforeEach(() => addText("Lote «lot»"));

    it("hands the application the ZPL at the size and density, each variable as a token", async () => {
      saveLabel();
      await settled();

      expect(pending).toHaveLength(1);
      expect(received(0).label).toEqual({
        zpl: "^XA\n^PW480\n^LL320\n^CI28\n^FO10,15^A0N,30,0^FH_^FDCliente: {{customer:FD}}^FS\n^FO10,65^A0N,30,0^FH_^FDLote {{lot:FD}}^FS\n^XZ",
      });
    });

    it("opens what it handed over as the same label", async () => {
      saveLabel();
      await settled();
      const { zpl } = received(0).label;

      openLabel(zpl, [], SIZE, DPI);

      expect(showsZpl(zpl)).toBe(true);
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
      addText("otro");
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
    openLabel("", [{ name: "customer", defaultValue: "ACME" }], SIZE, DPI);
    act(() => useLabelStore.setState({ selectedIds: [], sidebarTab: "properties" }));
  });

  it("offers the Properties and Variables tabs only", () => {
    sidebar();

    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      store().translations.layers.propertiesTab,
      store().translations.layers.variablesTab,
    ]);
  });

  it("leaves the label's settings to the application, size included", () => {
    sidebar();

    expect(screen.queryByText(store().translations.label.formatSection)).toBeNull();
    expect(screen.queryAllByText(store().translations.label.width, { exact: false })).toHaveLength(0);
  });

  it("keeps the application's variables as they are named, and adds none", () => {
    act(() => useLabelStore.setState({ sidebarTab: "variables" }));

    sidebar();

    expect(screen.getByRole("textbox", { name: store().translations.variables.nameLabel }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: store().translations.variables.add })).toBeNull();
  });

  it("offers Code 128 and QR as its only barcodes", () => {
    const barcodes = addableGroupsFor(store().translations)
      .filter(({ key }) => key !== "text" && key !== "shape")
      .flatMap(({ entries }) => entries.map(({ id }) => id));

    expect(barcodes).toEqual(["code128", "qrcode"]);
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
