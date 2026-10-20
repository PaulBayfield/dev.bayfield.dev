// Chart colours.
//
// Projects use a fixed categorical order (validated for colour-vision deficiency on all four themes),
// assigned by all-time rank so a project keeps its colour whatever range or filter is shown.
// Languages and editors use GitHub Linguist's well-known colours. Everything else is neutral.

import linguist from "../../server/src/colors.json";

export const CATEGORICAL_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const CATEGORICAL_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const OTHER_COLOR = "var(--text-faint)";

const languages = linguist.languages as unknown as Record<string, string | null>;
const editors = linguist.editors as unknown as Record<string, string | null>;
const lower = (m: Record<string, string | null>) => new Map(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]));
const languagesLower = lower(languages);
const editorsLower = lower(editors);

export function languageColor(name: string): string {
  return languages[name] ?? languagesLower.get(name.toLowerCase()) ?? "var(--text-faint)";
}

export function editorColor(name: string): string {
  return editors[name] ?? editorsLower.get(name.toLowerCase()) ?? "var(--text-faint)";
}

/** name → colour for the top projects by all-time rank; the rest are "Other". */
export function projectPalette(ranked: string[], dark: boolean): Map<string, string> {
  const palette = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  return new Map(ranked.slice(0, palette.length).map((name, i) => [name, palette[i]]));
}
