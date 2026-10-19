/**
 * dsh-tavern-launcher — 浏览器半侧（client half）。
 *
 * 这是 DSH 客户端模块系统消费的 bundle：宿主的 web 服务器把本文件按
 * `/plugins/...` 提供给浏览器，浏览器内核执行 `window.__ModuleLoader__.load({id, factory})`
 * 只注册 factory，模块副作用在物化时才运行；factory 的 `require` 按「平台种子表
 * （React / Cordis / 静态 UI 库）→ 已物化记录 → 启动图 row → 已注册 factory」解析。
 *
 * 因此这里手写 CJS 形态即可：`require("react")` 拿到的就是宿主 React（同一份实例，
 * hooks 正常）。
 *
 * 注册方式沿用 DSH 生态的「软依赖」约定（与 dsh-mnemon 相同）：
 *   - 不把 better-sidebar 写进 dsh.client.inject（否则没装 better-sidebar 的 profile
 *     会在组合阶段直接失败）；
 *   - 启动时 `ctx.get("betterSidebar")`，并监听 `internal/service` 事件在其后到达时重试。
 */
window.__ModuleLoader__.load({
	id: "dsh-tavern-launcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const e = React.createElement;

		/** 本插件独占的 API 前缀（宿主半侧注册）。 */
		const API = "/tavern-launcher/api";
		/** Better Sidebar 里的类型 id。 */
		const TAB_ID = "dsh-tavern:launcher";
		/** 状态轮询间隔（毫秒）。 */
		const POLL_MS = 5000;

		/** 调用宿主半侧。 */
		async function callTavern(method) {
			const response = await fetch(API, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method }),
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (payload === null || payload.ok !== true) {
				const detail = payload !== null && payload.error !== undefined ? payload.error.message : `HTTP ${response.status}`;
				throw new Error(String(detail));
			}
			return payload.value;
		}

		// ── 样式（内联，跟随主题的 currentColor，不引入 CSS 注入）────────────────

		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				gap: "10px",
				padding: "12px",
				boxSizing: "border-box",
				fontSize: "12px",
				color: "inherit",
			},
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "10px 12px",
				border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
				borderRadius: "8px",
			},
			row: { display: "flex", alignItems: "center", gap: "8px", justifyContent: "space-between" },
			label: { opacity: 0.6 },
			pill: (tone) => ({
				padding: "1px 8px",
				borderRadius: "999px",
				border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
				background: tone === "on" ? "color-mix(in srgb, #22c55e 22%, transparent)" : "transparent",
				fontVariantNumeric: "tabular-nums",
			}),
			buttons: { display: "flex", flexWrap: "wrap", gap: "6px" },
			button: (primary, disabled) => ({
				appearance: "none",
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? 0.5 : 1,
				padding: "5px 12px",
				borderRadius: "6px",
				border: "1px solid color-mix(in srgb, currentColor 28%, transparent)",
				background: primary ? "color-mix(in srgb, currentColor 14%, transparent)" : "transparent",
				color: "inherit",
				font: "inherit",
			}),
			meta: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", opacity: 0.7, wordBreak: "break-all" },
			error: { color: "#f87171", wordBreak: "break-word" },
			hint: { opacity: 0.6, lineHeight: 1.5 },
		};

		// ── 视图 ────────────────────────────────────────────────────────────────

		function TavernLauncherTab(props) {
			const visible = props.visible !== false;
			const [state, setState] = React.useState(null);
			const [busy, setBusy] = React.useState("");
			const [error, setError] = React.useState("");

			const refresh = React.useCallback(async () => {
				try {
					setState(await callTavern("status"));
					setError("");
				} catch (failure) {
					setError(failure.message !== undefined ? String(failure.message) : String(failure));
				}
			}, []);

			React.useEffect(() => {
				if (!visible) return undefined;
				void refresh();
				const timer = setInterval(() => { void refresh(); }, POLL_MS);
				return () => clearInterval(timer);
			}, [visible, refresh]);

			const run = React.useCallback(async (method) => {
				setBusy(method);
				setError("");
				try {
					const next = await callTavern(method);
					setState(next);
				} catch (failure) {
					setError(failure.message !== undefined ? String(failure.message) : String(failure));
				} finally {
					setBusy("");
				}
			}, []);

			const running = state !== null && state.running === true;
			const ready = state !== null && state.ready === true;
			const url = state !== null && typeof state.url === "string" ? state.url : "";
			const status = ready ? "运行中" : running ? "启动中" : "未运行";

			const header = e("div", { style: styles.row, key: "head" },
				e("strong", { key: "title", style: { fontSize: "13px" } }, "Tavern"),
				e("span", { key: "pill", style: styles.pill(ready ? "on" : "off") }, status),
			);

			const details = e("div", { style: { display: "flex", flexDirection: "column", gap: "4px" }, key: "details" },
				state === null ? null : e("div", { style: styles.row },
					e("span", { style: styles.label }, "端口"),
					e("span", { style: styles.meta }, String(state.port)),
				),
				state === null || state.pid === null ? null : e("div", { style: styles.row },
					e("span", { style: styles.label }, "PID"),
					e("span", { style: styles.meta }, String(state.pid)),
				),
				state === null ? null : e("div", { style: styles.row },
					e("span", { style: styles.label }, "源码"),
					e("span", { style: styles.meta, title: state.source }, String(state.source)),
				),
			);

			const buttons = e("div", { style: styles.buttons, key: "buttons" },
				e("button", {
					key: "start",
					type: "button",
					style: styles.button(true, busy !== "" || ready),
					disabled: busy !== "" || ready,
					onClick: () => void run("start"),
				}, busy === "start" ? "启动中…" : "启动 Tavern"),
				e("button", {
					key: "stop",
					type: "button",
					style: styles.button(false, busy !== "" || !running),
					disabled: busy !== "" || !running,
					onClick: () => void run("stop"),
				}, busy === "stop" ? "停止中…" : "停止"),
				e("button", {
					key: "open",
					type: "button",
					style: styles.button(false, url === ""),
					disabled: url === "",
					title: "在新的浏览器窗口打开酒馆界面（带 token 的完整地址）",
					onClick: () => { if (url !== "") window.open(url, "_blank", "noopener"); },
				}, "打开 Web"),
			);

			return e("div", { style: styles.root },
				header,
				e("div", { style: styles.card }, details, buttons),
				error === "" ? null : e("div", { style: styles.error }, error),
				e("div", { style: styles.hint, key: "hint" },
					ready
						? "服务已就绪：点「打开 Web」在新窗口进入酒馆界面。"
						: "点「启动 Tavern」拉起 tavern profile，首次启动较慢。",
				),
			);
		}

		// ── 注册 ────────────────────────────────────────────────────────────────

		/** tavern 的酒杯图标。 */
		function TavernIcon(size) {
			const dimension = typeof size === "number" ? size : 16;
			return e("svg", {
				width: dimension,
				height: dimension,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
			},
				e("path", { key: "mug", d: "M3.5 4.5h6v7a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" }),
				e("path", { key: "handle", d: "M9.5 6h1.7a1.3 1.3 0 0 1 0 4H9.5" }),
				e("path", { key: "foam", d: "M4.4 4.5c0-.9.7-1.6 1.6-1.6.5 0 .9.2 1.2.5.3-.3.7-.5 1.2-.5.9 0 1.6.7 1.6 1.6" }),
			);
		}

		/**
		 * 把 tab 注册进 Better Sidebar。
		 *
		 * 服务是软依赖：启动时取一次，并监听 `internal/service`，以便 better-sidebar
		 * 在更晚的安装顺序 / 热更后才出现时补注册。
		 */
		function mountBetterSidebarTab(ctx) {
			let current;
			const reconcile = () => {
				const service = ctx.get("betterSidebar");
				if (current !== undefined && current.service === service) return;
				if (current !== undefined) current.dispose();
				current = undefined;
				if (service === undefined) return;
				current = {
					service,
					dispose: service.registerTab({
						id: TAB_ID,
						title: () => "Tavern",
						description: () => "启动 / 停止 DSH Tavern 服务，并在新窗口打开酒馆界面",
						icon: (size) => TavernIcon(size),
						order: 30,
						single: true,
						component: (props) => e(TavernLauncherTab, props),
					}),
				};
			};
			reconcile();
			const unsubscribe = ctx.on("internal/service", (serviceName) => {
				if (serviceName === "betterSidebar") reconcile();
			});
			return () => {
				unsubscribe();
				if (current !== undefined) current.dispose();
				current = undefined;
			};
		}

		const inject = [];

		function apply(ctx) {
			ctx.effect(() => mountBetterSidebarTab(ctx), "dsh-tavern-launcher: better-sidebar tab");
		}

		exports.TavernLauncherTab = TavernLauncherTab;
		exports.TAVERN_LAUNCHER_TAB_ID = TAB_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
