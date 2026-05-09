import { create } from 'zustand';

interface SettingsUIState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsUIStore = create<SettingsUIState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
