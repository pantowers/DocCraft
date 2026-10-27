export function collectHangingNumbers(nodes, counters = {}, result = {}) {
  for (const node of nodes ?? []) {
    if (node.hangingList?.listId) {
      const listId = node.hangingList.listId;
      counters[listId] = (counters[listId] ?? 0) + 1;
      result[node.id] = counters[listId];
    }
    collectHangingNumbers(node.children, counters, result);
  }
  return result;
}

export function formatHangingMarker(format, number) {
  if (format === "bullet") return "•";
  if (format === "lower-alpha" || format === "upper-alpha") {
    let value = Math.max(1, Number(number) || 1);
    let label = "";
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(97 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return format === "upper-alpha" ? label.toUpperCase() : label;
  }
  return String(Math.max(1, Number(number) || 1));
}
