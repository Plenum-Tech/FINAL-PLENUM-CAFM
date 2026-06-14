import type { NodeInfo } from "../chat-api";

function statusLower(n: NodeInfo) {
  return String(n.status ?? "").toLowerCase();
}

export function isNodeRunning(n: NodeInfo) {
  const s = statusLower(n);
  return s.includes("running") || s.includes("processing") || s.includes("in_progress");
}

export function isNodeComplete(n: NodeInfo) {
  const s = statusLower(n);
  return s === "completed" || s === "complete" || s === "done" || s.includes("complete");
}

/**
 * Pipeline order: earliest step at top, active step at bottom.
 * Scroll up in the Activity panel to read earlier step logs.
 */
export function sortActivityNodesForDisplay(
  nodes: NodeInfo[],
  _currentNodeId?: number | null,
): NodeInfo[] {
  return [...nodes].sort((a, b) => a.node_id - b.node_id);
}

export function pickFocalActivityNodeId(
  nodes: NodeInfo[],
  currentNodeId?: number | null,
): number | null {
  const running = nodes.find(isNodeRunning);
  if (running) return running.node_id;
  if (currentNodeId != null && nodes.some((n) => n.node_id === currentNodeId)) {
    return currentNodeId;
  }
  const ordered = [...nodes].sort((a, b) => a.node_id - b.node_id);
  const withLogs = [...ordered].reverse().find((n) => n.logs.length > 0);
  return withLogs?.node_id ?? ordered[ordered.length - 1]?.node_id ?? null;
}
