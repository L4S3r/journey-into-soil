import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/client";
import { FieldForm } from "./features/inputs/FieldForm";
import { FieldMap } from "./features/map/FieldMap";
import { AgentPanel } from "./features/results/AgentPanel";
import { EvidencePanel } from "./features/results/EvidencePanel";
import { NasaVsModelPanel, NdviTimelinePanel } from "./features/results/NasaEvidence";
import { ClimateSlider, Flags, Glossary, LayerTable, NasaPanel } from "./features/results/Panels";
import { StrategyCards } from "./features/results/StrategyCards";
import { Timeline } from "./features/results/Timeline";
import i18n from "./i18n";
import { msgText } from "./lib/msg";
import { SoilScene } from "./scene/SoilScene";
import { useStore } from "./state/store";
import { useState } from "react";
import type { DemoSite } from "./scene/types";

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
  const { analyze, loadSample, loading, error, applySite, lang } = useStore();
  const [sites, setSites] = useState<DemoSite[]>([]);
  useEffect(() => {
    api.demoSites().then(setSites).catch(() => setSites([]));
  }, []);
  return (
    <main className="landing">
      <section className="panel">
        <h2>{t("ui.step_field")}</h2>
        {sites.length > 0 && (
          <div className="chips" aria-label={t("ui.demo_sites")}>
            {sites.map((s) => <button key={s.id} className="chip" onClick={() => applySite(s)}>{lang === "ar" ? s.name_ar : s.name_en}</button>)}
          </div>
        )}
        <FieldMap />
      </section>
      <section className="panel">
        <h2>{t("ui.step_inputs")}</h2>
        <FieldForm />
        <div className="actions">
          <button className="primary" disabled={loading} onClick={() => void analyze()}>{loading ? t("ui.analyzing") : t("ui.analyze")}</button>
          <button className="ghost" disabled={loading} onClick={() => void loadSample()}>{t("ui.sample")}</button>
        </div>
        {error && <p className="error" role="alert">{t("ui.error")} {error}</p>}
      </section>
    </main>
  );
}

function Results() {
  const { t } = useTranslation();
  const { result, strategyId, reset, loading, error, usingSample } = useStore();
  if (!result) return null;
  const strategy = result.strategies.find((s) => s.id === strategyId) ?? result.strategies[0];
  return (
    <main className="results">
      <div className="bar">
        <button className="ghost" onClick={reset}>{t("ui.edit")}</button>
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
  const { lang, theme, result } = useStore();
  useEffect(() => {
    void i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <>
      <Header />
      <Disclaimer />
      {result ? <Results /> : <Landing />}
    </>
  );
}
