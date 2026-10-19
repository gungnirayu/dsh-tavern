// The top bar, the start page and the settings list share one catalog of
// right-sidebar pages, so a page offered in settings is the one the start page opens.
const TAVERN_HEADER_DEFAULT = Object.freeze({ display: "icon-text", items: Object.freeze(["dsh-tavern:status", "header:export"]) });
const TAVERN_HEADER_NOT_FOLDED = Object.freeze(["dsh-tavern:status", "header:export"]);

const TAVERN_START_GROUPS = Object.freeze([
	["本局", Object.freeze(["dsh-tavern:status", "dsh-tavern:conversation-settings"])],
	["资料库", Object.freeze(["dsh-tavern:cards", "dsh-tavern:worldbooks", "dsh-tavern:regex-library", "dsh-tavern:resources", "dsh-tavern:skills"])],
	["偏好", Object.freeze(["dsh-tavern:presets", "dsh-tavern:guide-library", "dsh-tavern:card-memory"])]
]);

const TAVERN_START_ICON_PATHS = Object.freeze({
	status: 'M4 18a9 9 0 1 1 16 0M12 13l5-5M11 13a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
	'conversation-settings': 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
	cards: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0',
	worldbooks: 'M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0',
	presets: 'M10 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6l-3 8M16 6l3 8M9 19h6',
	resources: 'M3 8V5h7l3 3h8v12H3zM3 11h18',
	skills: 'M13 21H5V3h14v9M8 7h8M8 11h5M18 14l1.5 3.5L23 19l-3.5 1.5L18 24l-1.5-3.5L13 19l3.5-1.5z',
	'regex-library': 'M15 4v9M11 6.2l8 4.6M11 10.8l8-4.6M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
	'guide-library': 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
	'system-prompts': 'M10 3L6 21M18 3l-4 18M3 9h18M2 15h18',
	'user-profile': 'M3 6h10m4 0h4M3 12h4m4 0h10M3 18h10m4 0h4M13 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
	'card-memory': 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
	fallback: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
});

// One icon for a page, wherever it is drawn: the start page card, the top bar
// button, or the settings list. Tavern tabs keep their path; a plugin tab hands
// over its own component; everything else gets the neutral square.
function tavernStartIcon(id, option, size) {
	const key = String(id || "").replace(/^dsh-tavern:/, "");
	const dimension = size ? { width: size, height: size } : {};
	const path = TAVERN_START_ICON_PATHS[key] || TAVERN_START_ICON_PATHS.fallback;
	if (!TAVERN_START_ICON_PATHS[key] && option && option.icon) return React.createElement(option.icon, { size: size || 24 });
	return React.createElement("svg", Object.assign({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, dimension), React.createElement("path", { d: path }));
}

// Group the flat catalog the same way the start page does: Tavern's own groups
// first, then groups plugins registered, then plugin tabs, then the rest.
function tavernStartGroups(options, pluginGroups) {
	const list = Array.isArray(options) ? options.filter(Boolean) : [];
	const claimed = new Set();
	for (const group of TAVERN_START_GROUPS) for (const id of group[1]) claimed.add(id);
	const groups = [];
	for (const [title, ids] of TAVERN_START_GROUPS) {
		const found = ids.map(id => list.find(option => option.id === id)).filter(Boolean);
		if (found.length) groups.push([title, found]);
	}
	for (const group of pluginGroups || []) {
		const tabs = (group && group.tabs || []).filter(id => !claimed.has(id) && (claimed.add(id), true));
		const found = tabs.map(id => list.find(option => option.id === id)).filter(Boolean);
		if (found.length) groups.push([group.title, found]);
	}
	const plugins = list.filter(option => String(option.id).startsWith("tavern-plugin:") && !claimed.has(option.id));
	if (plugins.length) groups.push(["插件", plugins]);
	const others = list.filter(option => !claimed.has(option.id) && !String(option.id).startsWith("tavern-plugin:"));
	if (others.length) groups.push(["其他", others]);
	return groups;
}

// How many trailing pinned pages no longer fit. Fixed buttons (酒馆状态, 导出)
// stay: 导出 opens its own menu, and 酒馆状态 is the way back into the panel.
function tavernHeaderFold(ids, widthOf, available, options) {
	const list = Array.isArray(ids) ? ids : [];
	const gap = Number(options && options.gap) || 0;
	const fixed = new Set(options && options.fixed || []);
	const moreWidth = Number(options && options.moreWidth) || 0;
	const width = id => Number(widthOf(id)) || 0;
	let total = 0;
	for (const id of list) total += width(id);
	total += gap * Math.max(0, list.length - 1);
	if (total <= available) return [];
	let budget = available - moreWidth;
	for (const id of list) if (fixed.has(id)) budget -= width(id) + gap;
	const folded = [];
	let folding = false;
	for (const id of list) {
		if (fixed.has(id)) continue;
		const itemWidth = width(id);
		if (!folding && itemWidth + gap <= budget) budget -= itemWidth + gap;
		else { folding = true; folded.push(id); }
	}
	return folded;
}

// The catalog follows `sidebarRightTabs`: every guide entry becomes a page the
// top bar can show. Entries are rebuilt only when the registry changes, so the
// snapshot stays reference-stable for useSyncExternalStore.
function createTavernHeaderCatalog() {
	let registry = null, entries = [], attached = false;
	const listeners = new Set();
	function publish() {
		const source = registry && typeof registry.guide === "function" ? registry.guide() : [];
		entries = source.map(function (entry) {
			let label = "";
			try { label = String(entry.title() || ""); } catch (_) {}
			return { id: String(entry.kind || ""), label: label || String(entry.kind || ""), icon: entry.icon || null };
		}).filter(entry => entry.id);
		listeners.forEach(listener => listener());
	}
	function attach(next) {
		if (registry === next && attached) return function () {};
		registry = next;
		attached = true;
		const unsubscribe = next && typeof next.subscribe === "function" ? next.subscribe(publish) : null;
		publish();
		return function () {
			if (typeof unsubscribe === "function") unsubscribe();
			if (registry === next) { registry = null; attached = false; entries = []; listeners.forEach(listener => listener()); }
		};
	}
	return {
		attach: attach,
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		snapshot() { return entries; }
	};
}
const tavernHeaderCatalog = createTavernHeaderCatalog();

function useTavernHeaderCatalog() {
	return React.useSyncExternalStore(tavernHeaderCatalog.subscribe, tavernHeaderCatalog.snapshot, tavernHeaderCatalog.snapshot);
}

function useTavernHeaderItems() {
	const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
	const value = preferences && preferences.headerItems;
	return value && Array.isArray(value.items) ? value : TAVERN_HEADER_DEFAULT;
}

function TavernStartCards(props) {
	const { newTabOptions, onNewTab } = props;
	const h = React.createElement;
	const groups = tavernStartGroups(newTabOptions, props.pluginGroups);
	const css = `.dsh-tavern-start{box-sizing:border-box;padding:18px 16px 24px;overflow:auto;min-height:0;width:100%;color:var(--dsw-alias-label-primary);container-type:inline-size}.dsh-tavern-start section+section{margin-top:22px}.dsh-tavern-start h3{font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary);margin:0 2px 8px}.dsh-tavern-start-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,104px),1fr));gap:8px}.dsh-tavern-start-card{appearance:none;font:inherit;font-size:13px;color:inherit;background:var(--dsw-specific-input-major,#fff);border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;min-width:0;min-height:88px;padding:14px 8px 12px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;cursor:pointer;transition:border-color 140ms ease,transform 140ms ease,box-shadow 140ms ease}.dsh-tavern-start-card:hover:not(:disabled){border-color:var(--dsh-tavern-accent-border);box-shadow:0 4px 14px rgba(0,0,0,.06);transform:translateY(-1px)}.dsh-tavern-start-card:active:not(:disabled){transform:none}.dsh-tavern-start-card:focus-visible{outline:2px solid var(--dsh-tavern-accent);outline-offset:2px}.dsh-tavern-start-card:disabled{opacity:.45;cursor:default}.dsh-tavern-start-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--dsh-tavern-accent-soft);color:var(--dsh-tavern-accent)}.dsh-tavern-start-icon svg{width:20px;height:20px}.dsh-tavern-start-label{text-align:center;line-height:1.4;overflow-wrap:anywhere}@media (prefers-reduced-motion:reduce){.dsh-tavern-start-card{transition:none}.dsh-tavern-start-card:hover:not(:disabled){transform:none}}@container(max-width:260px){.dsh-tavern-start-grid{gap:6px}.dsh-tavern-start-card{font-size:12px;padding:10px 6px;min-height:76px}}`;
	return h('div', { className: 'dsh-tavern-start' }, h('style', null, css), groups.map(([title, options], index) => {
		if (!options.length) return null;
		return h('section', { key: index + ':' + title, 'aria-label': title }, h('h3', null, title), h('div', { className: 'dsh-tavern-start-grid' }, options.map(option => h('button', { key: option.id, type: 'button', className: 'dsh-tavern-start-card', disabled: option.disabled === true, title: option.label, onClick: () => onNewTab(option.id) },
			h('span', { className: 'dsh-tavern-start-icon', 'aria-hidden': true }, tavernStartIcon(option.id, option)),
			h('span', { className: 'dsh-tavern-start-label' }, option.label)))));
	}));
}

function registerTavernStartPage(ctx, slots) {
 ctx.inject(["sidebarRightTabs"], injected => {
  const registry = injected.get("sidebarRightTabs");
  injected.effect(() => tavernHeaderCatalog.attach(registry), "dsh-tavern: header item catalog");
  injected.effect(() => slots.inject("sidebar.right.tab.guide", () => slots.register({name:"sidebar.right.tab.guide",id:"dsh-tavern:start",priority:-1,select:()=>true}, function TavernStartPage(props) {
   const entries = useTavernHeaderCatalog();
   const {tab} = props.useTabInfo();
   useTavernUiExtensions();
   return React.createElement(TavernStartCards,{pluginGroups:tavernUiExtensions.startGroups(),newTabOptions:entries,onNewTab:id=>tab.actions.openTab(id,{replaceTab:true})});
  })), "dsh-tavern: native start page");
 });
}
