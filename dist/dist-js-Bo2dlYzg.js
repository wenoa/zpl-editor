import { a as e } from "./core-dE7yX5mk.js";
// node_modules/.pnpm/@tauri-apps+plugin-opener@2.7.2/node_modules/@tauri-apps/plugin-opener/dist-js/index.js
async function t(t, n) {
	await e("plugin:opener|open_url", {
		url: t,
		with: n
	});
}
export { t as openUrl };
