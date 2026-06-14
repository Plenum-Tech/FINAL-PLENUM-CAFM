import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SourceType =
  | "postgres"
  | "mysql"
  | "mssql"
  | "mongodb"
  | "csv"
  | "excel"
  | "json"
  | "xml"
  | "parquet"
  | "rest"
  | "soap"
  | "odata";

export type ScheduleMode = "oneoff" | "cron";
export type ConflictMode = "skip" | "overwrite" | "flag";

export type ConnectionPayload =
  | {
      kind: "db";
      engine: "postgres" | "mysql" | "mssql" | "mongodb";
      host: string;
      port: number | "";
      database?: string;
      user?: string;
      password?: string;
      ssl?: boolean;
    }
  | {
      kind: "file";
      format: "csv" | "excel" | "json" | "xml" | "parquet";
      fileName?: string;
      fileSize?: number;
    }
  | {
      kind: "api";
      protocol: "rest" | "soap" | "odata";
      baseUrl: string;
      authMode: "none" | "basic" | "bearer";
      username?: string;
      password?: string;
      token?: string;
      headers?: string;
    };

export type MappingPair = { source: string; target: string };
export type PreviewColumn = { field: string; type: string };
export type PreviewRow = Record<string, unknown>;
export type ErrorRow = { index: number; message: string };

type WizardState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  sourceType: SourceType | null;
  connection: ConnectionPayload | null;
  connectorId: string | null;
  jobId: string | null;
  file: File | null;
  tableName: string | null;
  mapping: MappingPair[];
  previewColumns: PreviewColumn[];
  previewRows: PreviewRow[];
  schedule: { mode: ScheduleMode; cron?: string };
  conflict: ConflictMode;
  progress: {
    status: "idle" | "running" | "done" | "canceled";
    percent: number;
    processed: number;
    errors: ErrorRow[];
  };
  // actions
  setStep: (s: WizardState["step"]) => void;
  setSourceType: (t: SourceType) => void;
  setConnection: (c: ConnectionPayload) => void;
  setConnectorId: (id: string | null) => void;
  setJobId: (id: string | null) => void;
  setFile: (file: File | null) => void;
  setTableName: (name: string | null) => void;
  setMapping: (m: MappingPair[]) => void;
  setPreview: (cols: PreviewColumn[], rows: PreviewRow[]) => void;
  setConfig: (schedule: WizardState["schedule"], conflict: ConflictMode) => void;
  startProgress: () => void;
  updateProgress: (delta: Partial<WizardState["progress"]>) => void;
  reset: () => void;
};

const initialState: Omit<
  WizardState,
  | "setStep"
  | "setSourceType"
  | "setConnection"
  | "setConnectorId"
  | "setJobId"
  | "setFile"
  | "setTableName"
  | "setMapping"
  | "setPreview"
  | "setConfig"
  | "startProgress"
  | "updateProgress"
  | "reset"
> = {
  step: 1,
  sourceType: null,
  connection: null,
  connectorId: null,
  jobId: null,
  file: null,
  tableName: null,
  mapping: [],
  previewColumns: [],
  previewRows: [],
  schedule: { mode: "oneoff" },
  conflict: "skip",
  progress: { status: "idle", percent: 0, processed: 0, errors: [] },
};

const memoryStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};

function createThrottledStorage(inner: Storage): Storage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<string, string>();

  const flush = () => {
    timer = null;
    for (const [k, v] of pending) {
      try {
        inner.setItem(k, v);
      } catch {
        // ignore write errors
      }
    }
    pending.clear();
  };

  return {
    get length() {
      return inner.length;
    },
    clear() {
      pending.clear();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      inner.clear();
    },
    getItem(key: string) {
      return pending.get(key) ?? inner.getItem(key);
    },
    key(index: number) {
      return inner.key(index);
    },
    removeItem(key: string) {
      pending.delete(key);
      inner.removeItem(key);
    },
    setItem(key: string, value: string) {
      pending.set(key, value);
      if (timer) return;
      timer = setTimeout(flush, 150);
    },
  };
}

export const useImportWizard = create<WizardState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setStep: (s) => set({ step: s }),
      setSourceType: (t) =>
        set({
          sourceType: t,
          connection: null,
          connectorId: null,
          jobId: null,
          file: null,
          tableName: null,
          mapping: [],
          previewColumns: [],
          previewRows: [],
          progress: { status: "idle", percent: 0, processed: 0, errors: [] },
        }),
      setConnection: (c) => set({ connection: c }),
      setConnectorId: (id) => set({ connectorId: id }),
      setJobId: (id) => set({ jobId: id }),
      setFile: (file) => set({ file }),
      setTableName: (name) => set({ tableName: name }),
      setMapping: (m) => set({ mapping: m }),
      setPreview: (cols, rows) => set({ previewColumns: cols, previewRows: rows }),
      setConfig: (schedule, conflict) => set({ schedule, conflict }),
      startProgress: () =>
        set({ progress: { status: "running", percent: 0, processed: 0, errors: [] }, step: 6 }),
      updateProgress: (delta) => set({ progress: { ...get().progress, ...delta } }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: "cafm_import_wizard",
      storage: createJSONStorage(() =>
        globalThis.window ? createThrottledStorage(globalThis.window.localStorage) : memoryStorage,
      ),
      partialize: (s) => ({
        sourceType: s.sourceType,
        connection: s.connection,
        connectorId: s.connectorId,
        tableName: s.tableName,
        mapping: s.mapping,
      }),
    },
  ),
);
