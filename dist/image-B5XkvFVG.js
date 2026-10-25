import { i as e } from "./react-dom-rVndRhfb.js";
import { a as t, n } from "./core-MwjZa94v.js";
//#region node_modules/.pnpm/@tauri-apps+api@2.12.4/node_modules/@tauri-apps/api/image.js
var r = /* @__PURE__ */ e({
	Image: () => i,
	transformImage: () => a
}), i = class e extends n {
	constructor(e) {
		super(e);
	}
	static async new(n, r, i) {
		return t("plugin:image|new", {
			rgba: n,
			width: r,
			height: i
		}).then((t) => new e(t));
	}
	static async fromBytes(n) {
		return t("plugin:image|from_bytes", { bytes: n }).then((t) => new e(t));
	}
	static async fromPath(n) {
		return t("plugin:image|from_path", { path: n }).then((t) => new e(t));
	}
	async rgba() {
		return t("plugin:image|rgba", { rid: this.rid }).then((e) => new Uint8Array(e));
	}
	async size() {
		return t("plugin:image|size", { rid: this.rid });
	}
};
function a(e) {
	return e == null ? null : typeof e == "string" ? e : e instanceof i ? e.rid : e;
}
//#endregion
export { a as n, r as t };
