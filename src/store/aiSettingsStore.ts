import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AiProvider = 'anthropic' | 'openai';

interface AiSettingsStore {
  provider: AiProvider;
  apiKey: string;
  setProvider: (p: AiProvider) => void;
  setApiKey: (k: string) => void;
  clearKey: () => void;
}

export const useAiSettingsStore = create<AiSettingsStore>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      apiKey: '',
      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      clearKey: () => set({ apiKey: '' }),
    }),
    { name: 'moneytalks-ai-settings' }
  )
);
