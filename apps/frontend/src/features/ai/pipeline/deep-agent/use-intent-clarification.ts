/**
 * Intent clarification state (WP-2).
 *
 * Decides whether a user's send should be intercepted with a clarification menu
 * (Scenarios A–D) and holds the pending intent + held message/files until resolved.
 * pendingIntent is persisted to localStorage per session so a chosen route survives
 * a refresh until the user follows up.
 */
import { useCallback, useEffect, useState } from "react";

import type { UdrForcedRoute } from "./udr-route-context";
import type { SavedSpaceId } from "./deep-agent-spaces";
import {
  detectUploadMix,
  isMigrationIntent,
  routeForIntent,
  spaceForIntent,
  type IntentKind,
} from "./intent-menu";

export type IntentMenuPhase =
  | { kind: "none" }
  | { kind: "menu" } // full 5-chip menu (Scenario A)
  | { kind: "confirm"; intent: IntentKind } // structured-only / docs-only confirm (Scenario B)
  | { kind: "split" } // mixed structured + docs (Scenario C)
  | { kind: "prompt"; intent: IntentKind }; // next-step text after a pick

export type SendDecision =
  | { proceed: true; forcedRoute?: UdrForcedRoute; intentSpace?: SavedSpaceId }
  | { proceed: false };

const PENDING_KEY = "plenum_pending_intent_v1";

function loadPending(sessionId: string): IntentKind | null {
  try {
    const raw = window.localStorage.getItem(`${PENDING_KEY}:${sessionId}`);
    return raw ? (JSON.parse(raw) as IntentKind) : null;
  } catch {
    return null;
  }
}

function savePending(sessionId: string, value: IntentKind | null) {
  try {
    const key = `${PENDING_KEY}:${sessionId}`;
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore quota / SSR */
  }
}

/**
 * The not-yet-run track from a mixed upload, surfaced after the first track is sent.
 *
 * `files` is `File[]` for in-memory dispatch; `fileNames` is the persistable
 * mirror used to render the Next Recommended Task card after a page reload
 * (when File blobs are gone). When `files.length === 0` but `fileNames.length`
 * has values, the card is in "needs re-attachment" mode.
 */
export type QueuedTrack = {
  intent: IntentKind;
  files: File[];
  fileNames: string[];
  text: string;
};

const QUEUED_KEY = "plenum_queued_next_v1";

function loadQueued(sessionId: string): QueuedTrack | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const raw = window.localStorage.getItem(`${QUEUED_KEY}:${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.intent !== "string") return null;
    const fileNames = Array.isArray(obj.fileNames)
      ? obj.fileNames.filter((s): s is string => typeof s === "string")
      : [];
    if (!fileNames.length) return null;
    return {
      intent: obj.intent as IntentKind,
      files: [], // File blobs cannot be persisted; user re-attaches before run
      fileNames,
      text: typeof obj.text === "string" ? obj.text : "",
    };
  } catch {
    return null;
  }
}

function saveQueued(sessionId: string, value: QueuedTrack | null) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const key = `${QUEUED_KEY}:${sessionId}`;
    if (!value || !value.fileNames.length) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        intent: value.intent,
        fileNames: value.fileNames,
        text: value.text,
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function useIntentClarification(sessionId: string) {
  const [phase, setPhase] = useState<IntentMenuPhase>({ kind: "none" });
  const [pendingIntent, setPendingIntentState] = useState<IntentKind | null>(null);
  const [heldFiles, setHeldFiles] = useState<File[]>([]);
  const [heldText, setHeldText] = useState("");
  const [queuedNext, setQueuedNextState] = useState<QueuedTrack | null>(null);

  // Reset / rehydrate when the session changes — queuedNext is rebuilt from
  // localStorage so the Next Recommended Task card survives refresh / opening
  // the chat from Saved Spaces / re-login.
  useEffect(() => {
    setPendingIntentState(loadPending(sessionId));
    setPhase({ kind: "none" });
    setHeldFiles([]);
    setHeldText("");
    setQueuedNextState(loadQueued(sessionId));
  }, [sessionId]);

  const setQueuedNext = useCallback(
    (next: QueuedTrack | null) => {
      setQueuedNextState(next);
      saveQueued(sessionId, next);
    },
    [sessionId],
  );

  const setPendingIntent = useCallback(
    (value: IntentKind | null) => {
      setPendingIntentState(value);
      savePending(sessionId, value);
    },
    [sessionId],
  );

  const dismiss = useCallback(() => {
    setPhase({ kind: "none" });
    setHeldFiles([]);
    setHeldText("");
  }, []);

  /**
   * Called from the composer's send handler BEFORE any network call.
   * Returns whether to proceed (optionally with a forced route) or hold for a menu.
   */
  const evaluateSend = useCallback(
    (text: string, files: File[]): SendDecision => {
      const mix = detectUploadMix(files);
      const migIntent = isMigrationIntent(text);

      // A fresh migration/data request with NO files always shows the menu so the user
      // picks the pipeline (CSV/Excel, Word/PDF, Fiix, …). This wins over any stale
      // pendingIntent (e.g. a previous "Live Fiix" pick lingering in localStorage),
      // which would otherwise hijack the message and route straight to that pipeline.
      if (files.length === 0 && migIntent) {
        setPendingIntent(null);
        setHeldText(text);
        setHeldFiles([]);
        setPhase({ kind: "menu" });
        return { proceed: false };
      }

      // A previously-picked intent (chip → attach files / reply) → proceed once.
      if (pendingIntent) {
        const forcedRoute = routeForIntent(pendingIntent);
        const intentSpace = spaceForIntent(pendingIntent);
        setPendingIntent(null);
        setPhase({ kind: "none" });
        setHeldFiles([]);
        setHeldText("");
        return { proceed: true, forcedRoute, intentSpace };
      }

      if (files.length > 0) {
        if (mix.mixed) {
          // Mixed structured + documents → ask which track to run first (Scenario C).
          setHeldText(text);
          setHeldFiles(files);
          setPhase({ kind: "split" });
          return { proceed: false };
        }
        // Single-track upload (CSV/Excel only, or documents only): the file type makes
        // the intent unambiguous — proceed straight to ingestion.
        return { proceed: true };
      }

      // No files, no migration intent → proceed normally.
      return { proceed: true };
    },
    [pendingIntent, setPendingIntent],
  );

  return {
    phase,
    pendingIntent,
    heldText,
    heldFiles,
    queuedNext,
    evaluateSend,
    setPendingIntent,
    setPhase,
    setHeldFiles,
    setHeldText,
    setQueuedNext,
    dismiss,
  };
}
