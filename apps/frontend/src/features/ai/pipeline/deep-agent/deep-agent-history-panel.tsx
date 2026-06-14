"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Plus } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

import type { DeepAgentSessionMeta } from "./deep-agent-sessions";

function formatChatTimestamp(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ClientTimestamp({
  children,
  className,
}: {
  children: () => string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <span className={className}>{mounted ? children() : "\u00a0"}</span>;
}

export function DeepAgentHistoryPanel({
  sessions,
  activeId,
  onSelect,
  onNew,
}: {
  sessions: DeepAgentSessionMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MessageSquare size={16} className="text-indigo-600" />
            Chat history
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={onNew}>
            <Plus size={14} />
            New
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {sorted.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">No past chats yet.</p>
        ) : (
          sorted.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                s.id === activeId
                  ? "bg-indigo-50 border border-indigo-200"
                  : "hover:bg-slate-50 border border-transparent",
              )}
            >
              <div className="text-xs font-medium text-slate-800 truncate">{s.title}</div>
              <ClientTimestamp className="mt-0.5 text-[10px] text-muted-foreground block">
                {() => formatChatTimestamp(s.updatedAt)}
              </ClientTimestamp>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
