import { a as e } from "./core-MwjZa94v.js";
//#region node_modules/.pnpm/@tauri-apps+plugin-process@2.4.0/node_modules/@tauri-apps/plugin-process/dist-js/index.js
async function t(t = 0) {
	await e("plugin:process|exit", { code: t });
}
async function n() {
	await e("plugin:process|restart");
}
//#endregion
export { t as exit, n as relaunch };
