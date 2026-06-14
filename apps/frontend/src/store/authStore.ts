import { create } from "zustand";

export type User = {
  email: string;
};

type AuthState = {
  user: User | null;
  hydrated: boolean;
  setUser: (user: User) => void;
  clearUser: () => void;
  hydrate: (user: User | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  hydrate: (user) => set({ user, hydrated: true }),
}));
