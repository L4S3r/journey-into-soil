import { create } from "zustand";
import { api } from "../api/client";
import type { AnalysisRequest, AnalysisResult, DemoSite, Quality, StrategyId } from "../scene/types";

export const DEFAULT_REQUEST: AnalysisRequest = {
  lat: 30.79,
  lon: 31.0,
  texture: "loam",
  drainage: "good",
  organic_input: "some",
  residues: "unknown",
  irrigation: "flood",
  water_ec: 1.0,
  water_availability: "ample",
  pest: "none",
  next_season: "winter",
  history: [
    { crop: "maize", season: "summer" },
    { crop: "wheat", season: "winter" },
    { crop: "maize", season: "summer" },
  ],
  priorities: { water: 1, soil_health: 1, income: 1, risk: 1 },
};

const safeGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage may be blocked */
  }
};

interface State {
  request: AnalysisRequest;
  result: AnalysisResult | null;
  strategyId: StrategyId;
  dayT: number;
  lang: "en" | "ar";
  theme: "light" | "dark";
  quality: Quality | "auto";
  loading: boolean;
  error: string | null;
  usingSample: boolean;
  focusedLayer: number | null;
  setRequest: (patch: Partial<AnalysisRequest>) => void;
  applySite: (site: DemoSite) => void;
  analyze: () => Promise<void>;
  loadSample: () => Promise<void>;
  applyScenario: (dT: number, dP: number) => Promise<void>;
  reset: () => void;
  setFocusedLayer: (idx: number | null) => void;
  setStrategy: (id: StrategyId) => void;
  setDayT: (t: number) => void;
  setLang: (l: "en" | "ar") => void;
  setTheme: (t: "light" | "dark") => void;
  setQuality: (q: Quality | "auto") => void;
}

export const useStore = create<State>((set, get) => ({
  request: DEFAULT_REQUEST,
  result: null,
  strategyId: "primary",
  dayT: 0,
  lang: safeGet("lang") === "ar" ? "ar" : "en",
  theme: safeGet("theme") === "dark" ? "dark" : "light",
  quality: "auto",
  loading: false,
  error: null,
  usingSample: false,
  focusedLayer: null,
  setRequest: (patch) => set((s) => ({ request: { ...s.request, ...patch } })),
  applySite: (site) =>
    set((s) => ({ request: { ...s.request, ...site.preset, lat: site.lat, lon: site.lon, region: site.region } as AnalysisRequest })),
  analyze: async () => {
    set({ loading: true, error: null, usingSample: false });
    try {
      const result = await api.analyze(get().request);
      set({ result, strategyId: "primary", dayT: 0, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  loadSample: async () => {
    set({ loading: true, error: null });
    try {
      const result = await api.sample();
      set({ result, strategyId: "primary", dayT: 0, loading: false, usingSample: true, request: result.input });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  applyScenario: async (dT, dP) => {
    const { result, usingSample } = get();
    if (!result || usingSample) return;
    set({ loading: true, error: null });
    try {
      const next = await api.scenario(result.request_id, dT, dP);
      set({ result: next, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  reset: () => set({ result: null, error: null, usingSample: false, focusedLayer: null }),
  setFocusedLayer: (focusedLayer) => set({ focusedLayer }),
  setStrategy: (strategyId) => set({ strategyId }),
  setDayT: (dayT) => set({ dayT }),
  setLang: (lang) => {
    safeSet("lang", lang);
    set({ lang });
  },
  setTheme: (theme) => {
    safeSet("theme", theme);
    set({ theme });
  },
  setQuality: (quality) => set({ quality }),
}));
