import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type AiPlatformState = {
  fiixSchemaJson: string;
  fiixSchemaUpdatedAt: number | null;
  setFiixSchemaJson: (json: string) => void;
  clearFiixSchema: () => void;
  schemaMappingId: string | null;
  schemaConnectorType: "fiix" | "upload";
  schemaOrganizationId: string;
  schemaExternalCmmsName: string;
  schemaContent: string;
  schemaFormat: string;
  schemaSource: string;
  setSchemaMappingId: (id: string | null) => void;
  setSchemaMappingForm: (
    patch: Partial<
      Pick<
        AiPlatformState,
        | "schemaConnectorType"
        | "schemaOrganizationId"
        | "schemaExternalCmmsName"
        | "schemaContent"
        | "schemaFormat"
        | "schemaSource"
      >
    >,
  ) => void;
  clearSchemaMapping: () => void;
};

const memoryStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};

export const useAiPlatformStore = create<AiPlatformState>()(
  persist(
    (set) => ({
      fiixSchemaJson: "",
      fiixSchemaUpdatedAt: null,
      setFiixSchemaJson: (json) => set({ fiixSchemaJson: json, fiixSchemaUpdatedAt: Date.now() }),
      clearFiixSchema: () => set({ fiixSchemaJson: "", fiixSchemaUpdatedAt: null }),
      schemaMappingId: null,
      schemaConnectorType: "upload",
      schemaOrganizationId: "",
      schemaExternalCmmsName: "Maximo",
      schemaContent: "",
      schemaFormat: "yaml",
      schemaSource: "yaml_file",
      setSchemaMappingId: (id) => set({ schemaMappingId: id }),
      setSchemaMappingForm: (patch) => set((s) => ({ ...s, ...patch })),
      clearSchemaMapping: () =>
        set({
          schemaMappingId: null,
          schemaConnectorType: "upload",
          schemaOrganizationId: "",
          schemaExternalCmmsName: "Maximo",
          schemaContent: "",
          schemaFormat: "yaml",
          schemaSource: "yaml_file",
        }),
    }),
    {
      name: "cafm_ai_platform",
      storage: createJSONStorage(() =>
        globalThis.window === undefined ? memoryStorage : globalThis.window.localStorage,
      ),
      partialize: (s) => ({
        fiixSchemaJson: s.fiixSchemaJson,
        fiixSchemaUpdatedAt: s.fiixSchemaUpdatedAt,
        schemaMappingId: s.schemaMappingId,
        schemaConnectorType: s.schemaConnectorType,
        schemaOrganizationId: s.schemaOrganizationId,
        schemaExternalCmmsName: s.schemaExternalCmmsName,
        schemaContent: s.schemaContent,
        schemaFormat: s.schemaFormat,
        schemaSource: s.schemaSource,
      }),
    },
  ),
);
