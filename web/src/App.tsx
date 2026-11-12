import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/client";
import { FieldForm } from "./features/inputs/FieldForm";
import { FieldMap } from "./features/map/FieldMap";
import { EvidencePanel } from "./features/results/EvidencePanel";
import { ClimateSlider, Flags, Glossary, LayerTable, NasaPanel } from "./features/results/Panels";
import { StrategyCards } from "./features/results/StrategyCards";
import { Timeline } from "./features/results/Timeline";
import i18n from "./i18n";
import { msgText } from "./lib/msg";
import { SoilScene } from "./scene/SoilScene";
import type { DemoSite } from "./scene/types";
import { useStore } from "./state/store";

function parseAnalysisId(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  const match = path.match(/^\/a\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  const hash = window.location.hash;
  const hashMatch = hash.match(/^#\/a\/([^/?#]+)/);
  if (hashMatch) return decodeURIComponent(hashMatch[1]);
  return null;
}

function Header() {
  const { t } = useTranslation();
  const { lang, setLang, theme, setTheme, quality, setQuality, result } = useStore();
  return (
    <header className="top">
      <div>
        <h1>{t("app.title")}</h1>
        <p>{t("app.tagline")}</p>
      </div>
      <div className="tools">
        {result && (
          <select aria-label={t("ui.quality")} value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            {["auto", "high", "medium", "low"].map((q) => <option key={q} value={q}>{t(`ui.q_${q}`)}</option>)}
          </select>
        )}
        <button className="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? t("ui.light") : t("ui.dark")}</button>
        <button className="ghost" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{lang === "ar" ? "English" : "العربية"}</button>
      </div>
    </header>
  );
}

function Disclaimer() {
  const { t } = useTranslation();
  const { result, lang } = useStore();
  const keys = result?.disclaimers ?? ["disclaimer.main"];
  return (
    <aside className="disclaimer" role="note">
      {keys.map((k) => <p key={k}>{msgText(t, lang, { key: k })}</p>)}
    </aside>
  );
}

function Landing() {
  const { t } = useTranslation();
  const { analyze, loadSample, openDemoSite, applySite, loading, error, lang } = useStore();
  const [sites, setSites] = useState<DemoSite[]>([]);
  const [pickerMode, setPickerMode] = useState<"demo" | "custom">("demo");

  useEffect(() => {
    api.demoSites().then(setSites).catch(() => setSites([]));
  }, []);

  return (
    <main className="landing">
      <section className="panel">
        <h2>{t("ui.step_field")}</h2>
        
        <div className="picker-tabs" role="tablist" aria-label={t("ui.step_field")}>
          <button
            type="button"
            role="tab"
            aria-selected={pickerMode === "demo"}
            className={`chip ${pickerMode === "demo" ? "primary" : ""}`}
            onClick={() => setPickerMode("demo")}
          >
            {t("ui.demo_sites")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pickerMode === "custom"}
            className={`chip ${pickerMode === "custom" ? "primary" : ""}`}
            onClick={() => setPickerMode("custom")}
          >
            {t("ui.click_own_field")}
          </button>
        </div>

        {pickerMode === "demo" && sites.length > 0 && (
          <div className="demo-picker">
            <p className="hint">{t("ui.demo_sites_intro")}</p>
            <div className="demo-cards" aria-label={t("ui.demo_sites")}>
              {sites.map((s) => (
                <div key={s.id} className="demo-card">
                  <div>
                    <h4>{lang === "ar" ? s.name_ar : s.name_en}</h4>
                    <span className="badge">{t(`ui.region.${s.region}`)}</span>
                  </div>
                  <div className="demo-card-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={loading}
                      onClick={() => void openDemoSite(s)}
                    >
                      {t("ui.open_demo_result")}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={loading}
                      onClick={() => {
                        applySite(s);
                        setPickerMode("custom");
                      }}
                    >
                      {t("ui.edit")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(pickerMode === "custom" || sites.length === 0) && (
          <div className="custom-field">
            <p className="hint">{t("ui.or_custom_field")}</p>
            <FieldMap />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>{t("ui.step_inputs")}</h2>
        <FieldForm />
        <div className="actions">
          <button className="primary" disabled={loading} onClick={() => void analyze()}>
            {loading ? t("ui.analyzing") : t("ui.analyze")}
          </button>
          <button className="ghost" disabled={loading} onClick={() => void loadSample()}>
            {t("ui.sample")}
          </button>
        </div>
        {error && <p className="error" role="alert">{t("ui.error")} {error}</p>}
      </section>
    </main>
  );
}

function Results() {
  const { t } = useTranslation();
  const { result, strategyId, reset, loading, error, usingSample } = useStore();
  const [copied, setCopied] = useState(false);

  if (!result) return null;
  const strategy = result.strategies.find((s) => s.id === strategyId) ?? result.strategies[0];

  const copyLink = async () => {
    const id = result.request_id || "sample";
    const url = `${window.location.origin}/a/${id}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("ui.copy_link_prompt"), url);
    }
  };

  return (
    <main className="results">
      <div className="bar">
        <button className="ghost" onClick={reset}>{t("ui.edit")}</button>
        <button className="ghost" onClick={() => void copyLink()}>
          {copied ? t("ui.link_copied") : t("ui.copy_link")}
        </button>
        {usingSample && <span className="badge warn">{t("ui.sample_badge")}</span>}
        {loading && <span className="badge">{t("ui.analyzing")}</span>}
      </div>
      {error && <p className="error" role="alert">{t("ui.error")} {error}</p>}
      <Flags result={result} />
      <StrategyCards result={result} />
      <SoilScene />
      <Timeline result={result} strategy={strategy} />
      <div className="grid">
        <EvidencePanel result={result} strategy={strategy} />
        <div className="side">
          <ClimateSlider result={result} />
          <NasaPanel result={result} />
          <LayerTable result={result} />
          <Glossary />
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const { lang, theme, result, loadAnalysis, reset } = useStore();

  useEffect(() => {
    void i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const id = parseAnalysisId();
    if (id) {
      void loadAnalysis(id);
    }
    const onPopState = () => {
      const currentId = parseAnalysisId();
      if (currentId) {
        void loadAnalysis(currentId);
      } else {
        reset();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadAnalysis, reset]);

  return (
    <>
      <Header />
      <Disclaimer />
      {result ? <Results /> : <Landing />}
    </>
  );
}
