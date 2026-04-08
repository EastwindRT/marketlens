import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AiProvider = 'groq' | 'anthropic' | 'openai';

export interface ProviderMeta {
  label: string;
  badge?: string;
  badgeColor?: string;
  placeholder: string;
  model: string;
  docsUrl: string;
  signupUrl: string;
  signupLabel: string;
}

export const PROVIDER_META: Record<AiProvider, ProviderMeta> = {
  groq: {
    label: 'Groq',
    badge: 'FREE',
    badgeColor: '#05B169',
    placeholder: 'gsk_…',
    model: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com',
    signupUrl: 'https://console.groq.com',
    signupLabel: 'Get free key at console.groq.com',
  },
  anthropic: {
    label: 'Anthropic',
    placeholder: 'sk-ant-api03-…',
    model: 'claude-haiku-4-5',
    docsUrl: 'https://console.anthropic.com',
    signupUrl: 'https://console.anthropic.com',
    signupLabel: 'Get key at console.anthropic.com',
  },
  openai: {
    label: 'OpenAI',
    placeholder: 'sk-…',
    model: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com',
    signupUrl: 'https://platform.openai.com/api-keys',
    signupLabel: 'Get key at platform.openai.com',
  },
};

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
      provider: 'groq',   // default to free provider
      apiKey: '',
      setProvider: (provider) => set({ provider, apiKey: '' }), // clear key on provider switch
      setApiKey: (apiKey) => set({ apiKey }),
      clearKey: () => set({ apiKey: '' }),
    }),
    { name: 'moneytalks-ai-settings' }
  )
);
