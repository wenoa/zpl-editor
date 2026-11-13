import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { importZplText } from "@zplab/core/lib/zplImportService";
import { isGroup, type LabelObject, type Page } from "@zplab/core/types/Group";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import type { Variable } from "@zplab/core/types/Variable";

/* The ZPL <zplab-editor> hands over carries each variable as {{name:escape}} inside
 * the field data, for the application to fill when it prints. Every field holding a
 * token escapes its own bytes with ^FH_, and a literal "{" ships as _7B: in the
 * field data "{{" only ever opens a token. The escape names the command whose
 * rules the value follows, besides the ^FH_ hex escape of ^, ~ and _:
 *
 *   FD  nothing more (text, QR)
 *   FB  \ as \\, a line break as \&
 *   TB  < as <<>, a line break as a space
 *   BC  > as >0, ^ as ><, ~ as >= (Code 128, before the hex escape) */

const TOKEN = /\{\{([^{}:]*)(?::[A-Z]+)?\}\}/g;

/** A name a token can carry: it travels inside ^FD, between braces. */
export const TOKEN_NAME = /^[\p{L}\p{N}_.-]+$/u;

/** Letters only: every field encoder and the import decoders leave them as they are. */
const placeholder = (index: number) =>
  `QZXV${[...index.toString(26)].map((digit) => String.fromCharCode(65 + Number.parseInt(digit, 26))).join("")}VXZQ`;

const PLACEHOLDER = /QZXV([A-Z]+)VXZQ/g;

const placeholderIndex = (letters: string) =>
  Number.parseInt([...letters].map((letter) => (letter.charCodeAt(0) - 65).toString(26)).join(""), 26);

/** The label's ZPL, its variables as tokens. */
export function zplWithTokens(label: LabelConfig, pages: Page[], variables: readonly Variable[]) {
  const names = variables.map(({ name }) => name);
  const marked = pages.map((page) => ({
    ...page,
    objects: mapStrings(page.objects, (text) =>
      names.reduce((replaced, name, index) => replaced.split(`«${name}»`).join(placeholder(index)), text),
    ),
  }));
  return generateMultiPageZPL(label, marked).replace(
    /(\^FH_)?((?:\^F[CE][^^]*)?)\^FD([\s\S]*?)\^FS/g,
    (field, escaped: string | undefined, arm: string, data: string, at: number, zpl: string) => {
      if (data.search(PLACEHOLDER) === -1 && !data.includes("{")) return field;
      const escape = escapeOf(zpl.slice(zpl.lastIndexOf("^FS", at) + 1, at));
      const own = escaped === undefined ? data.replaceAll("_", "_5F") : data;
      const tokens = own
        .replaceAll("{", "_7B")
        .replace(PLACEHOLDER, (_, letters: string) => `{{${names[placeholderIndex(letters)]}:${escape}}}`);
      return `^FH_${arm}^FD${tokens}^FS`;
    },
  );
}

/** The escape a value follows in the field whose commands lead to its ^FD. */
function escapeOf(field: string) {
  if (field.includes("^BC")) return "BC";
  if (field.includes("^FB")) return "FB";
  if (field.includes("^TB")) return "TB";
  return "FD";
}

/** What a ZPL with tokens opens as, each token back as its variable's marker. Undefined when it holds no label. */
export function labelFromZplWithTokens(zpl: string, dpmm: number) {
  const names: string[] = [];
  const marked = zpl.replace(TOKEN, (_, name: string) => {
    if (!names.includes(name)) names.push(name);
    return placeholder(names.indexOf(name));
  });
  const imported = importZplText(marked, dpmm);
  if (imported.pages.length === 0 || imported.unbalanced !== null) return undefined;
  // The application keeps the size and the density, so the source's own ^PW/^LL must not replay.
  const pages = imported.pages.map(({ overlay: _overlay, ...page }) => ({
    ...page,
    objects: mapStrings(page.objects, (text) =>
      text.replace(PLACEHOLDER, (_, letters: string) => `«${names[placeholderIndex(letters)]}»`),
    ),
  }));
  return { labelConfig: imported.labelConfig, pages, variables: imported.variables, tokens: names };
}

function mapStrings(objects: LabelObject[], map: (text: string) => string): LabelObject[] {
  return objects.map((object) => (isGroup(object) ? { ...object, children: mapStrings(object.children, map) } : withPropsMapped(object, map)));
}

function withPropsMapped<T extends { props: object }>(leaf: T, map: (text: string) => string): T {
  const props = Object.entries(leaf.props).map(([key, value]) => [key, typeof value === "string" ? map(value) : value]);
  return { ...leaf, props: Object.fromEntries(props) as T["props"] };
}
