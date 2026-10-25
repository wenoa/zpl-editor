import { a as e } from "./core-MwjZa94v.js";
//#region node_modules/.pnpm/@tauri-apps+plugin-dialog@2.8.3/node_modules/@tauri-apps/plugin-dialog/dist-js/index.js
async function t(t = {}) {
	return typeof t == "object" && Object.freeze(t), await e("plugin:dialog|open", { options: t });
}
async function n(t = {}) {
	return typeof t == "object" && Object.freeze(t), await e("plugin:dialog|save", { options: t });
}
//#endregion
export { t as open, n as save };
