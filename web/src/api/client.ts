import type { AgentAnswer, AnalysisRequest, AnalysisResult, CropInfo, DemoSite } from "../scene/types";

const BASE = "/api/v1";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  analyze: (req: AnalysisRequest) =>
    fetch(`${BASE}/analyses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }).then(
      (r) => json<AnalysisResult>(r),
    ),
  scenario: (id: string, dT: number, dP: number) =>
    fetch(`${BASE}/analyses/${id}/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dT, dP }),
    }).then((r) => json<AnalysisResult>(r)),
  get: (id: string) => fetch(`${BASE}/analyses/${id}`).then((r) => json<AnalysisResult>(r)),
  crops: () => fetch(`${BASE}/crops`).then((r) => json<CropInfo[]>(r)),
  demoSites: () => fetch(`${BASE}/demo-sites`).then((r) => json<DemoSite[]>(r)),
  lookup: (lat: number, lon: number) =>
    fetch(`${BASE}/geo/lookup?lat=${lat}&lon=${lon}`).then((r) =>
      json<{
        region: string;
        in_delta_area: boolean;
        climate: { source: string; resolution_km: number | null; mean_tmax: number; mean_tmin: number; annual_rain_mm: number; annual_et0_mm: number };
      }>(r),
    ),
  sample: () => fetch("/mock_result.json").then((r) => json<AnalysisResult>(r)),
  ask: (question: string, farmer: AnalysisRequest, analysisId: string) =>
    fetch(`${BASE}/agent/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, farmer, analysis_id: analysisId }),
    }).then((r) => json<AgentAnswer>(r)),
};
