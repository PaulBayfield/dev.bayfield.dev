// Parsing wakatime-cli user agents and normalizing language / editor / OS names.
//
// The user-agent rules follow wakapi's (utils/http.go, MIT) so editors and OSes group the same way
// as in imported data. Names are normalized against GitHub Linguist's list, which also fixes
// wakapi's lowercased spellings ("Typescript" → "TypeScript", "Vscode" → "VS Code").

import colors from "./colors.json" with { type: "json" };

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, "");

function lookup(names: string[], extra: Record<string, string> = {}) {
  const map = new Map<string, string>();
  for (const name of names) map.set(compact(name), name);
  for (const [k, v] of Object.entries(extra)) map.set(compact(k), v);
  return map;
}

const languages = lookup(Object.keys(colors.languages), {
  // Wakapi's own extension mappings and a few common short forms.
  cjs: "JavaScript",
  mjs: "JavaScript",
  ipynb: "Python",
  golang: "Go",
  csharp: "C#",
  cpp: "C++",
  "c plus plus": "C++",
  shell: "Shell",
  bash: "Shell",
  sh: "Shell",
  dockerfile: "Dockerfile",
  jsx: "JSX",
  tsx: "TSX",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
});

const editors = lookup(Object.keys(colors.editors), {
  code: "VS Code",
  visualstudiocode: "VS Code",
  intellij: "IntelliJ IDEA",
  idea: "IntelliJ IDEA",
  nvim: "Neovim",
  ktexteditor: "Kate",
  sublime: "Sublime Text",
  "claude-code": "Claude Code",
  claude: "Claude Code",
  "codex-cli": "Codex CLI",
  "github-copilot-cli": "Copilot CLI",
});

const systems = lookup(["Android", "Linux", "iOS", "Windows", "WSL", "Unix", "FreeBSD", "ChromeOS"], {
  win: "Windows",
  darwin: "macOS",
  mac: "macOS",
  macos: "macOS",
  osx: "macOS",
});

/** Known names keep their spelling; unknown all-lowercase ones get a capital, like wakapi. */
function canonical(map: Map<string, string>, value: string): string {
  const v = value.trim();
  if (!v) return "";
  const known = map.get(compact(v));
  if (known) return known;
  return v === v.toLowerCase() ? v[0].toUpperCase() + v.slice(1) : v;
}

export const canonicalLanguage = (v: string) => canonical(languages, v);
export const canonicalEditor = (v: string) => canonical(editors, v);
export const canonicalOs = (v: string) => canonical(systems, v);

// --- User agents ---

const MIDDLEWARES = new Set(["wakatime-ls", "wakatime-cli"]);
const KNOWN_OS = new Set(["linux", "windows", "macos", "darwin", "win", "mac", "wsl"]);
const AI_TOOLS = new Set(
  (
    "claude claude-code chatgpt copilot github-copilot-cli codex codex-cli continue cody roo-code roocode opencode " +
    "opencode-cli cursor cursor-agent cursor-agent-cli windsurf qoder kiro cline cline-cli qwen-code qwen-code-cli pi " +
    "goose amp grok-build codebuff codebuff-cli codewhale codewhale-cli crush crush-cli devin droid droid-cli forge " +
    "forge-cli hermes ibm-bob ibm-bob-cli kilo-code kilo-code-cli kimi-code kimi-code-cli lingtai-tui mistral-vibe " +
    "mistral-vibe-cli mux omp omp-cli openclaw openclaw-cli open-design quickdesk warp zcode zed zerostack"
  ).split(" "),
);

const isAiHarness = (n: string) =>
  n.endsWith("-cli") || n.endsWith("-tui") || n.startsWith("antigravity-") || n.startsWith("codex-") || AI_TOOLS.has(n);

const isRuntime = (n: string) => n === "python" || n === "go" || /^python\d/.test(n) || /^go\d/.test(n);

/** "vscode-wakatime" → "vscode"; "wakatime.nvim" → "neovim". Empty string: a plugin, but no editor in its name. */
function pluginEditor(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith("-wakatime")) {
    const candidate = name.slice(0, -"-wakatime".length);
    return KNOWN_OS.has(candidate.toLowerCase()) ? "" : candidate;
  }
  if (lower === "wakatime.nvim") return "neovim";
  return null;
}

function extractOs(parts: string[]): string {
  let p = parts[1] ?? "";
  if (p.startsWith("(")) {
    p = p.slice(1).split(")")[0].split(" ")[0];
    return p.split("-")[0].split("_")[0];
  }
  if (p.includes("-") || p.includes("_")) {
    const candidate = p.split("-")[0].split("_")[0];
    if (KNOWN_OS.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}

function extractAiModel(parts: string[]): string {
  const candidates: string[] = [];
  for (const p of parts.slice(1)) {
    if (!p.includes("/")) continue;
    const name = p.split("/")[0].toLowerCase();
    if (name === "wakatime" || MIDDLEWARES.has(name) || isRuntime(name) || pluginEditor(name) !== null) continue;
    candidates.push(p);
  }
  if (candidates.length < 2) return "";
  const first = candidates[0].split("/")[0];
  return isAiHarness(first.toLowerCase()) ? "" : first;
}

function extractEditor(parts: string[], aiModel: string): string {
  let primary = "";
  let plugin = "";
  let harness = "";
  for (const p of parts.slice(1)) {
    if (!p.includes("/")) continue;
    const name = p.split("/")[0];
    const lower = name.toLowerCase();
    if (lower === "wakatime" || MIDDLEWARES.has(lower) || isRuntime(lower)) continue;
    const fromPlugin = pluginEditor(name);
    if (fromPlugin !== null) {
      if (fromPlugin) plugin = fromPlugin;
      continue;
    }
    if (aiModel && lower === aiModel.toLowerCase()) continue;
    if (isAiHarness(lower)) {
      harness ||= name;
      continue;
    }
    primary ||= name;
  }
  return harness || primary || plugin;
}

/** Browser user agents (the WakaTime browser extension sends its own, but just in case). */
function parseBrowser(ua: string): { os: string; editor: string } {
  const os = /windows/i.test(ua)
    ? "Windows"
    : /android/i.test(ua)
      ? "Android"
      : /iphone|ipad/i.test(ua)
        ? "iOS"
        : /mac os/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "";
  const editor = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : "";
  return { os, editor };
}

export interface ParsedUserAgent {
  os: string;
  editor: string;
  aiModel: string;
}

export function parseUserAgent(raw: string): ParsedUserAgent {
  const ua = raw.trim();
  if (!ua) return { os: "", editor: "", aiModel: "" };
  const parts = ua.split(/\s+/);
  const first = parts[0].toLowerCase();
  if (parts.length >= 2 && /^(wakatime|chrome|firefox|edge)\//.test(first)) {
    const aiModel = extractAiModel(parts);
    let editor = extractEditor(parts, aiModel);
    if (editor === "KTextEditor") editor = "kate";
    let os = extractOs(parts);
    if (ua.includes("-WSL2-")) os = "wsl";
    return { os: canonicalOs(os), editor: canonicalEditor(editor), aiModel };
  }
  const browser = parseBrowser(ua);
  return { os: browser.os, editor: browser.editor, aiModel: "" };
}
