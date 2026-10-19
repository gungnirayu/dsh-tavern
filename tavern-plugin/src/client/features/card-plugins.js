		// Plugins a DSH card carries (docs/design/dsh-card-format.md): listed with the card, turned on
		// by the player, and confined to that card's games, here in the page as on the host.
		const tavernCardPluginScopes = (function () {
			let scopes = {}, loaded = false, loading = null;
			const listeners = new Set();
			function load() {
				if (loading) return loading;
				loading = rpc("cardPluginScopes").then(function (reply) { scopes = reply && reply.scopes || {}; }, function () {}).finally(function () {
					loading = null; loaded = true; Array.from(listeners).forEach(function (listener) { listener(); });
				});
				return loading;
			}
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-card-plugins-changed", function () { void load(); });
			return {
				load: load,
				subscribe: function (listener) { listeners.add(listener); if (!loaded) void load(); return function () { listeners.delete(listener); }; },
				get: function () { return scopes; }
			};
		})();

		/** Whether a plugin may show itself in this game: everything does, except another card's own plugins. */
		function tavernPluginAllowed(owner, sessionId) {
			const cards = tavernCardPluginScopes.get()[owner];
			if (!Array.isArray(cards) || !cards.length) return true;
			if (!sessionId) return false;
			const view = liveTavernView.getSnapshot(sessionId).view;
			return Boolean(view && view.card && cards.indexOf(view.card.path) >= 0);
		}
		function useTavernCardPluginScopes() {
			return React.useSyncExternalStore(tavernCardPluginScopes.subscribe, tavernCardPluginScopes.get);
		}

		/** The card's own plugins in the card library, with a switch to turn them on or off. */
		function TavernCardPluginsBox(props) {
			const h = React.createElement;
			const [plugins, setPlugins] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [message, setMessage] = React.useState("");
			React.useEffect(function () {
				let active = true;
				setPlugins(null); setMessage("");
				rpc("cardPlugins", { path: props.path }).then(function (reply) { if (active) setPlugins(reply.plugins || []); }, function () { if (active) setPlugins([]); });
				return function () { active = false; };
			}, [props.path]);
			if (!plugins || !plugins.length) return null;
			const enabled = plugins.every(function (plugin) { return plugin.enabled; });
			async function toggle() {
				setBusy(true); setMessage("");
				try {
					const reply = await rpc("setCardPlugins", { path: props.path, enabled: !enabled });
					setPlugins(reply.plugins || []);
					window.dispatchEvent(new CustomEvent("dsh-tavern-card-plugins-changed"));
					setMessage(enabled ? "已停用" : "已启用，刷新页面后界面部分生效");
				} catch (error) { setMessage("失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			return h("section", { className: "dsh-tavern-card-plugins", "aria-label": "卡内插件" },
				h("div", { className: "dsh-tavern-card-plugins-head" }, h("strong", null, "卡内插件"),
					h("button", { type: "button", className: "dsh-tavern-btn" + (enabled ? "" : " primary"), disabled: busy, onClick: toggle }, enabled ? "停用" : "启用")),
				h("ul", null, plugins.map(function (plugin) {
					return h("li", { key: plugin.folder }, h("span", null, plugin.name), plugin.purpose ? h("small", null, plugin.purpose) : null, h("small", null, plugin.enabled ? "已启用" : "未启用"));
				})),
				h("p", { className: "dsh-tavern-settings-desc" }, "只在这张卡的游戏里生效。"),
				message ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, message) : null);
		}

		/** The card's stage switch in the card library: off for ordinary cards, so their games show no stage. */
		function TavernCardStageBox(props) {
			const h = React.createElement;
			const [enabled, setEnabled] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			React.useEffect(function () {
				let active = true;
				setEnabled(null);
				rpc("cardStage", { path: props.path }).then(function (reply) { if (active) setEnabled(reply.enabled === true); }, function () { if (active) setEnabled(false); });
				return function () { active = false; };
			}, [props.path]);
			if (enabled === null) return null;
			async function toggle(next) {
				setBusy(true);
				try {
					const reply = await rpc("setCardStage", { path: props.path, enabled: next });
					setEnabled(reply.enabled === true);
					window.dispatchEvent(new CustomEvent("dsh-tavern-card-stage-changed", { detail: { path: props.path } }));
				} catch (error) { tavernErrorHub.report("人物卡舞台", error); }
				finally { setBusy(false); }
			}
			return h("label", { className: "dsh-tavern-card-plugins dsh-tavern-card-stage" },
				h("span", { className: "dsh-tavern-settings-copy" }, h("strong", null, "舞台"),
					h("span", { className: "dsh-tavern-settings-desc" }, enabled ? "这张卡的游戏在酒馆状态顶部显示舞台：立绘、背景和逐句演出。" : "开启后，这张卡的游戏在酒馆状态顶部显示舞台。普通人物卡不需要。")),
				h("input", { type: "checkbox", role: "switch", "aria-label": "舞台", checked: enabled, disabled: busy, onChange: function (event) { void toggle(event.target.checked); } }));
		}

