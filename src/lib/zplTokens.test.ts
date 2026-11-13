import { describe, expect, it } from "vitest";
import { getEntry } from "@zplab/core/registry";
import { code128FdToDisplayText } from "@zplab/core/lib/code128Subset";
import type { LabelObject, Page } from "@zplab/core/types/Group";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import { resolveAddable } from "../registry/palettePresets";
import en from "../locales/en";
import { labelFromZplWithTokens, zplWithTokens } from "./zplTokens";

const label = { widthMm: 60, heightMm: 40, dpmm: 8 } as LabelConfig;
const variables = [
  { id: "v1", name: "codigo", fnNumber: 1, defaultValue: "A-1" },
  { id: "v2", name: "fecha_de_alta", fnNumber: 2, defaultValue: "2026" },
];

const leaf = (entryId: string, content: string, y: number) => {
  const entry = resolveAddable(entryId, en);
  if (entry === null) throw new Error(entryId);
  return {
    id: entryId,
    type: entry.type,
    x: 10,
    y,
    rotation: 0,
    props: { ...(getEntry(entry.type)?.defaultProps as object), ...entry.propsOverride, content },
  } as unknown as LabelObject;
};

const reopened = (zpl: string) => {
  const opened = labelFromZplWithTokens(zpl, 8);
  if (opened === undefined) throw new Error("not opened");
  return zplWithTokens(label, opened.pages, opened.tokens.map((name, index) => ({ id: name, name, fnNumber: index + 1, defaultValue: "" })));
};

describe.each([
  ["text", "Código: «codigo» del «fecha_de_alta» {x} a_b", "FD"],
  ["text-fb", "«codigo» \\ fin", "FB"],
  ["text-tb", "«codigo» <<> fin", "TB"],
  ["code128", "«codigo»>X^~_", "BC"],
  ["qrcode", "«codigo»_«fecha_de_alta»", "FD"],
])("%s", (entryId, content, escape) => {
  const pages: Page[] = [{ objects: [leaf(entryId, content, 10)] }];
  const zpl = zplWithTokens(label, pages, variables);

  it(`carries each variable as a token that names the ${escape} escape, in a field that escapes its own bytes`, () => {
    expect(zpl).toMatch(new RegExp(`\\^FH_\\^FD[^^]*\\{\\{codigo:${escape}\\}\\}`));
  });

  it("opens and saves again byte for byte", () => {
    expect(reopened(zpl)).toBe(zpl);
  });
});

it("ships a literal brace escaped, so in the field data {{ only opens a token", () => {
  const zpl = zplWithTokens(label, [{ objects: [leaf("text", "{{no es variable}}", 10)] }], variables);

  expect(zpl).toContain("^FH_^FD_7B_7Bno es variable}}^FS");
});

it("keeps a token whose variable the application does not give", () => {
  expect(labelFromZplWithTokens("^XA^FO10,10^A0N,30,0^FH_^FD{{lote:FD}}^FS^XZ", 8)?.tokens).toEqual(["lote"]);
});

it("opens nothing from a ZPL without a label", () => {
  expect(labelFromZplWithTokens("no es ZPL", 8)).toBeUndefined();
});

/** What the application does when it prints: each value escaped by its token's rules. */
const filled = (zpl: string, value: string) =>
  zpl.replace(/\{\{([^{}:]+):([A-Z]+)\}\}/g, (_, _name: string, escape: string) => {
    const own =
      escape === "BC"
        ? value.replace(/>/g, ">0").replace(/\^/g, "><").replace(/~/g, ">=")
        : escape === "FB"
          ? value.replace(/\\/g, "\\\\").replace(/\n/g, "\\&")
          : escape === "TB"
            ? value.replace(/</g, "<<>").replace(/\n/g, " ")
            : value;
    return own.replace(/[\^~_]/g, (ch) => `_${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  });

it("a value escaped by its token's rules prints as itself in a Code 128", () => {
  const value = "A>1B>X^x~y_z";
  const zpl = zplWithTokens(label, [{ objects: [leaf("code128", "«codigo»", 10)] }], variables);

  const data = /\^FH_\^FD(.*)\^FS/.exec(filled(zpl, value))?.[1] ?? "";
  const printed = code128FdToDisplayText(data.replace(/_([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));

  expect(printed).toBe(value);
});

it.each([
  ["text", "A>1 ^x~y_z \\ <w"],
  ["text-fb", "A>1 ^x~y_z \\& <w"],
  ["text-tb", "A>1 ^x~y_z \\ <w"],
  ["qrcode", "A>1 ^x~y_z \\ <w"],
])("a value escaped by its token's rules opens as itself in a %s", (entryId, value) => {
  const zpl = zplWithTokens(label, [{ objects: [leaf(entryId, "«codigo»", 10)] }], variables);

  const printed = labelFromZplWithTokens(filled(zpl, value), 8)?.pages[0]?.objects[0];

  expect(printed).toMatchObject({ props: { content: value } });
});
