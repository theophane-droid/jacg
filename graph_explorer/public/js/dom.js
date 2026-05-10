export const el = (id) => document.getElementById(id);

export function log(message, kind = "info") {
  const stamp = new Date().toLocaleTimeString();
  const output = el("messageLog");
  if (!output) return;
  output.textContent = `[${stamp}] ${kind}: ${message}\n` + output.textContent;
}
