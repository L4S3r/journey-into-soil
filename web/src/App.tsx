import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/client";
import { FieldForm } from "./features/inputs/FieldForm";
import { FieldMap } from "./features/map/FieldMap";
import { AuthModal } from "./features/landing/AuthModal";
import { LandingPage } from "./features/landing/LandingPage";
import { NasaTelemetryModal } from "./features/landing/NasaTelemetryModal";
import { PdfReportModal } from "./features/landing/PdfReportModal";
import { AgentPanel } from "./features/results/AgentPanel";
import { EvidencePanel } from "./features/results/EvidencePanel";
import { NasaVsModelPanel, NdviTimelinePanel } from "./features/results/NasaEvidence";
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

function Header({ onBackToLanding }: { onBackToLanding?: () => void }) {
  const { t } = useTranslation();
  const { lang, setLang, theme, setTheme, quality, setQuality, result, userEmail, setAuthModalOpen, setUserEmail } = useStore();

  return (
    <header className="top">
      <div className="brand">
        <img
          src="/the_shifters_logo_transparent.png"
          alt="The Shifters"
          className="logo"
        />
        <div>
          <h1>{t("app.title")}</h1>
          <p>{t("app.tagline")}</p>
        </div>
      </div>

      {onBackToLanding && (
        <button
          type="button"
          onClick={onBackToLanding}
          className="ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}
        >
          <span style={{ fontSize: "14px" }}>←</span>
          <span>{lang === "ar" ? "العودة للرئيسية" : "Back to Overview"}</span>
        </button>
      )}

      <div className="tools">
        {result && (
          <select aria-label={t("ui.quality")} value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            {["auto", "high", "medium", "low"].map((q) => <option key={q} value={q}>{t(`ui.q_${q}`)}</option>)}
          </select>
        )}

        {userEmail ? (
          <div className="astryx-user-badge">
            <span className="astryx-user-dot" />
            <span className="astryx-user-email">{userEmail.split("@")[0]}</span>
            <button
              type="button"
              onClick={() => setUserEmail(null)}
              className="astryx-btn-signout"
              title={t("landing.btn_sign_out", "Sign Out")}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="ghost"
          >
            {t("landing.sign_in", "Sign In")}
          </button>
        )}

        <button
          className="ghost"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("ui.light") : t("ui.dark")}
        >
          {theme === "dark" ? t("ui.light") : t("ui.dark")}
        </button>

        <button
          className="ghost"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        >
          {lang === "ar" ? "English" : "العربية"}
        </button>
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

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="astryx-footer">
      <div className="astryx-footer-content">
        <div className="astryx-footer-brand">
          <img
            src="/the_shifters_logo_transparent.png"
            alt="The Shifters"
            className="astryx-footer-logo"
          />
          <span className="astryx-footer-title">The Shifters</span>
          <span className="astryx-footer-dot">·</span>
          <span className="astryx-footer-sub">Journey into the Soil</span>
          <span className="astryx-footer-dot">·</span>
          <span className="astryx-badge astryx-badge--matcha">NASA Space Apps 2026</span>
        </div>
        <p className="astryx-footer-disclaimer">
          {t(
            "disclaimer.footer",
            "NASA Space Apps Challenge 2026 'Field Shift: Adapting Farms with NASA Data'. Advisory decision-support system only. Does not replace local agronomic judgment or soil laboratory tests."
          )}
        </p>
      </div>
    </footer>
  );
}

function SimulatorView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { analyze, loadSample, openDemoSite, applySite, loading, error, lang } = useStore();
  const [sites, setSites] = useState<DemoSite[]>([]);
  const [pickerMode, setPickerMode] = useState<"demo" | "custom">("demo");

  useEffect(() => {
    api.demoSites().then(setSites).catch(() => setSites([]));
  }, []);

  return (
    <main className="landing" id="field-simulator">
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <button
          type="button"
          onClick={onBack}
          className="ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}
        >
          <span style={{ fontSize: "14px" }}>←</span>
          <span>{lang === "ar" ? "العودة للرئيسية" : "Back to Overview"}</span>
        </button>
      </div>

      <section className="panel" id="field-inputs">
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ inlineSize: 18, blockSize: 18, marginInlineEnd: 8, verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span>{loading ? t("ui.analyzing") : t("ui.analyze_soil_core")}</span>
          </button>
          <button className="ghost" disabled={loading} onClick={() => void loadSample()}>{t("ui.sample")}</button>
        </div>
        {error && <p className="error" role="alert">{t("ui.error")} {error}</p>}
      </section>
    </main>
  );
}

function Results() {
  const { t } = useTranslation();
  const { result, strategyId, reset, loading, error, usingSample, setPdfModalOpen } = useStore();
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
        <button className="ghost" onClick={() => setPdfModalOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginInlineEnd: 6, verticalAlign: "middle" }}>
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          {t("landing.btn_print_pdf", "Export PDF Report")}
        </button>
        {usingSample && <span className="badge warn">{t("ui.sample_badge")}</span>}
        {loading && <span className="badge">{t("ui.analyzing")}</span>}
      </div>
      {error && <p className="error" role="alert">{t("ui.error")} {error}</p>}
      <Flags result={result} />
      <StrategyCards result={result} />
      <SoilScene />
      <Timeline result={result} strategy={strategy} />
      <NasaVsModelPanel result={result} strategy={strategy} />
      <NdviTimelinePanel result={result} />
      <div className="grid">
        <EvidencePanel result={result} strategy={strategy} />
        <div className="side">
          <ClimateSlider result={result} />
          <AgentPanel result={result} />
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
  const [showSimulator, setShowSimulator] = useState(false);

  useEffect(() => {
    void i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme === "dark" ? "#0b0e0c" : "#fbf9f5");
    }
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

  if (result) {
    return (
      <>
        <Header onBackToLanding={() => { reset(); setShowSimulator(false); }} />
        <Disclaimer />
        <Results />
        <Footer />
        <AuthModal />
        <PdfReportModal />
        <NasaTelemetryModal />
      </>
    );
  }

  if (showSimulator) {
    return (
      <>
        <Header onBackToLanding={() => setShowSimulator(false)} />
        <Disclaimer />
        <SimulatorView onBack={() => setShowSimulator(false)} />
        <Footer />
        <AuthModal />
      </>
    );
  }

  return <LandingPage onStartSimulation={() => setShowSimulator(true)} />;
}
