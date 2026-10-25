import { a as e } from "./core-MwjZa94v.js";
//#region node_modules/.pnpm/@tauri-apps+plugin-opener@2.7.2/node_modules/@tauri-apps/plugin-opener/dist-js/index.js
async function t(t, n) {
	await e("plugin:opener|open_url", {
		url: t,
		with: n
	});
}
//#endregion
export { t as openUrl };
