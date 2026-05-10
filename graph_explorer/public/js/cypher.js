import { state } from "./state.js";
import { el } from "./dom.js";

export const cypherKeywords = [
  "MATCH", "OPTIONAL MATCH", "WHERE", "RETURN", "WITH", "ORDER BY", "LIMIT",
  "SKIP", "DISTINCT", "COUNT", "COLLECT", "UNWIND", "CALL", "YIELD",
  "AS", "AND", "OR", "NOT", "STARTS WITH", "ENDS WITH", "CONTAINS",
  "type", "labels", "properties", "shortestPath"
];

function currentToken() {
  const input = el("cypherInput");
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/[A-Za-z0-9_.$:`]+$/);
  return match ? match[0].replace(/^[:`$]+/, "") : "";
}

function insertSuggestion(value) {
  const input = el("cypherInput");
  const token = currentToken();
  const start = input.selectionStart - token.length;
  input.setRangeText(value, start, input.selectionStart, "end");
  el("suggestions").classList.add("hidden");
  input.focus();
}

export function updateSuggestions() {
  const token = currentToken().toLowerCase();
  const suggestions = el("suggestions");
  if (!token) { suggestions.classList.add("hidden"); return; }
  const candidates = [
    ...cypherKeywords,
    ...state.schema.labels.map((l) => `:${l}`),
    ...state.schema.relationshipTypes.map((t) => `:${t}`),
    ...state.schema.propertyKeys
  ];
  const matches = [...new Set(candidates)].filter((i) => i.toLowerCase().includes(token)).slice(0, 12);
  if (!matches.length) { suggestions.classList.add("hidden"); return; }
  suggestions.innerHTML = "";
  for (const item of matches) {
    const row = document.createElement("div");
    row.className = "suggestion";
    row.textContent = item;
    row.addEventListener("mousedown", (e) => { e.preventDefault(); insertSuggestion(item); });
    suggestions.appendChild(row);
  }
  suggestions.classList.remove("hidden");
}
