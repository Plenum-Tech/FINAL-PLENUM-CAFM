"use client";

import { useEffect, useRef, useState } from "react";
import { Check, GripVertical, Pencil, Pin, PinOff, Sparkles, X } from "lucide-react";

import { cn } from "@/utils/cn";

import {
  addCustomPin,
  editCustomPin,
  loadCustomPins,
  MAX_CUSTOM_PINS,
  reorderCustomPins,
  saveCustomPins,
  selectVisiblePins,
  type PinnedRun,
  type PinSelectionContext,
} from "./deep-agent-pinned-runs";
import type { SavedSpaceId } from "./deep-agent-spaces";
import type { UdrRunPinOptions } from "./deep-agent-udr-panel";

type Props = {
  activeSpace: SavedSpaceId;
  pinContext: PinSelectionContext;
  composerText: string;
  disabled?: boolean;
  onRunPin: (prompt: string, space: SavedSpaceId, opts?: UdrRunPinOptions) => void;
};

export function DeepAgentPinnedRunsBar({
  activeSpace,
  pinContext,
  composerText,
  disabled,
  onRunPin,
}: Props) {
  const [customPins, setCustomPins] = useState<PinnedRun[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setCustomPins(loadCustomPins());
  }, []);

  const pins = selectVisiblePins(pinContext, customPins);
  const customCount = customPins.length;
  const canPinComposer = composerText.trim().length >= 12 && customCount < MAX_CUSTOM_PINS;

  function handlePinComposer() {
    const text = composerText.trim();
    if (!text) return;
    addCustomPin(text, activeSpace);
    setCustomPins(loadCustomPins());
  }

  function handleUnpin(id: string) {
    const next = loadCustomPins().filter((p) => p.id !== id);
    saveCustomPins(next);
    setCustomPins(next);
    if (editingId === id) setEditingId(null);
  }

  function startEdit(pin: PinnedRun) {
    setEditingId(pin.id);
    setEditLabel(pin.label);
    setEditPrompt(pin.prompt);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditLabel("");
    setEditPrompt("");
  }

  function commitEdit() {
    if (!editingId) return;
    const next = editCustomPin(editingId, { label: editLabel, prompt: editPrompt });
    setCustomPins(next);
    cancelEdit();
  }

  function handleDragStart(id: string) {
    dragId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    if (!dragId.current || dragId.current === id) return;
    e.preventDefault();
    setDragOverId(id);
  }

  function handleDrop(targetId: string) {
    const sourceId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = customPins.map((p) => p.id);
    const fromIdx = order.indexOf(sourceId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...order];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, sourceId);
    setCustomPins(reorderCustomPins(next));
  }

  function handleDragEnd() {
    dragId.current = null;
    setDragOverId(null);
  }

  if (!pins.length) return null;

  const editing = editingId
    ? customPins.find((p) => p.id === editingId) ?? null
    : null;

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          <Sparkles size={10} />
          Pinned
          {customCount > 0 ? (
            <span className="text-slate-300 normal-case tracking-normal">
              · {customCount}/{MAX_CUSTOM_PINS} custom
            </span>
          ) : null}
        </div>
        {canPinComposer ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handlePinComposer}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 transition-colors"
            title="Pin current prompt"
          >
            <Pin size={10} />
            Pin prompt
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pins.map((pin) => (
          <div
            key={pin.id}
            className={cn(
              "inline-flex items-center gap-0.5 max-w-full rounded-full transition-shadow",
              pin.isCustom && dragOverId === pin.id && "ring-2 ring-indigo-300",
            )}
            draggable={pin.isCustom && !editingId}
            onDragStart={pin.isCustom ? () => handleDragStart(pin.id) : undefined}
            onDragOver={pin.isCustom ? (e) => handleDragOver(e, pin.id) : undefined}
            onDrop={pin.isCustom ? () => handleDrop(pin.id) : undefined}
            onDragEnd={pin.isCustom ? handleDragEnd : undefined}
          >
            {pin.isCustom ? (
              <span
                aria-hidden
                className="hidden sm:inline-flex cursor-grab active:cursor-grabbing px-0.5 text-slate-300"
                title="Drag to reorder"
              >
                <GripVertical size={10} />
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled || !!editingId}
              onClick={() =>
                onRunPin(pin.prompt, pin.space, pin.forcedRoute ? { forcedRoute: pin.forcedRoute } : undefined)
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition-colors max-w-[12rem] truncate",
                "bg-slate-100/80 text-slate-700 hover:bg-slate-200/80",
                (disabled || !!editingId) && "opacity-50 cursor-not-allowed",
              )}
              title={pin.prompt}
            >
              <span className="truncate">{pin.label}</span>
            </button>
            {pin.isCustom ? (
              <>
                <button
                  type="button"
                  aria-label="Edit pin"
                  className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  onClick={() => startEdit(pin)}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  aria-label="Remove pin"
                  className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  onClick={() => handleUnpin(pin.id)}
                >
                  <PinOff size={11} />
                </button>
              </>
            ) : null}
          </div>
        ))}
      </div>
      {editing ? (
        <div className="rounded-xl ring-1 ring-slate-200 bg-white px-3 py-2.5 space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Edit pin
          </div>
          <input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            placeholder="Label"
            maxLength={64}
            className="w-full rounded-lg ring-1 ring-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-indigo-300"
          />
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="Prompt"
            rows={2}
            className="w-full rounded-lg ring-1 ring-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-indigo-300 resize-none"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <X size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={commitEdit}
              disabled={!editPrompt.trim()}
              className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <Check size={11} />
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
