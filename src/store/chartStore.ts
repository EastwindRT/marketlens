import { create } from 'zustand';
import type { TimeRange, ChartType } from '../api/types';

interface ChartStore {
  timeRange: TimeRange;
  chartType: ChartType;
  showSMA20: boolean;
  showSMA50: boolean;
  showVolume: boolean;
  setTimeRange: (range: TimeRange) => void;
  setChartType: (type: ChartType) => void;
  toggleSMA20: () => void;
  toggleSMA50: () => void;
  toggleVolume: () => void;
}

export const useChartStore = create<ChartStore>((set) => ({
  timeRange: '3M',
  chartType: 'area',
  showSMA20: true,
  showSMA50: true,
  showVolume: true,
  setTimeRange: (timeRange) => set({ timeRange }),
  setChartType: (chartType) => set({ chartType }),
  toggleSMA20: () => set((state) => ({ showSMA20: !state.showSMA20 })),
  toggleSMA50: () => set((state) => ({ showSMA50: !state.showSMA50 })),
  toggleVolume: () => set((state) => ({ showVolume: !state.showVolume })),
}));
