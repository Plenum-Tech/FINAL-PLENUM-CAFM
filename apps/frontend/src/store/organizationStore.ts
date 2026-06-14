import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Organization = { id: string; name: string };

type OrgState = {
  selected: Organization | null;
  hydrated: boolean;
  setSelected: (org: Organization) => void;
  clear: () => void;
  hydrate: (org: Organization | null) => void;
};

const memoryStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};

export const useOrganizationStore = create<OrgState>()(
  persist(
    (set) => ({
      selected: null,
      hydrated: false,
      setSelected: (org) => set({ selected: org }),
      clear: () => set({ selected: null }),
      hydrate: (org) => set({ selected: org, hydrated: true }),
    }),
    {
      name: "cafm_org",
      storage: createJSONStorage(() =>
        globalThis.window === undefined ? memoryStorage : globalThis.window.localStorage,
      ),
      partialize: (state) => ({ selected: state.selected }),
    },
  ),
);

