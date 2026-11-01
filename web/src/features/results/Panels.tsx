import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fmt, msgText } from "../../lib/msg";
import type { AnalysisResult } from "../../scene/types";
import { useStore } from "../../state/store";

export function NasaPanel({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation();
  const { lang } = useStore();
  return (
    <section className="panel">
      <h3>{t("ui.nasa_title")}</h3>
      <ul className="nasa">
        {result.nasa_data.map((n) => (
          <li key={n.id}>
            <div><b>{t(n.name_key)}</b> <span className={`badge st-${n.status}`}>{t(`ui.status_${n.status}`)}</span></div>
            <small>{t(n.role_key)} · {t("ui.resolution", { km: fmt(lang, n.resolution_km, n.resolution_km < 1 ? 2 : 0) })}</small>
          </li>
        ))}
      </ul>
      <p className="hint">{t("ui.nasa_note")}</p>
    </section>
  );
}

export function LayerTable({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation();
  const { lang } = useStore();
  return (
    <section className="panel">
      <h3>{t("ui.layers_title")}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>{t("ui.depth")}</th><th>{t("ui.layer_texture")}</th><th>{t("ui.om")}</th><th>{t("ui.ece")}</th><th>{t("ui.data")}</th></tr>
          </thead>
          <tbody>
            {result.layers.map((l, i) => (
              <tr key={i}>
                <td>{fmt(lang, l.top_cm)}–{fmt(lang, l.bottom_cm)} cm</td>
                <td>{t(l.name_key)}</td>
                <td>{fmt(lang, l.om, 1)}%</td>
                <td>{fmt(lang, l.ec, 1)}</td>
                <td><span className={`badge conf-${l.confidence}`}>{t(`ui.level_${l.confidence}`)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t("ui.layers_note")}</p>
    </section>
  );
}

export function ClimateSlider({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation();
  const { applyScenario, usingSample, loading, lang } = useStore();
  const [dT, setDT] = useState(result.climate.scenario.dT);
  const [dP, setDP] = useState(result.climate.scenario.dP);
  return (
    <section className="panel">
      <h3>{t("ui.scenario_title")}</h3>
      <label className="field">
        <span>{t("ui.dT")}: <b>{dT > 0 ? "+" : ""}{fmt(lang, dT, 1)} °C</b></span>
        <input type="range" min={-3} max={6} step={0.5} value={dT} onChange={(e) => setDT(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>{t("ui.dP")}: <b>{dP > 0 ? "+" : ""}{fmt(lang, dP)}%</b></span>
        <input type="range" min={-60} max={60} step={5} value={dP} onChange={(e) => setDP(Number(e.target.value))} />
      </label>
      <button className="primary" disabled={loading || usingSample} onClick={() => void applyScenario(dT, dP)}>{t("ui.apply")}</button>
      <p className="hint">{usingSample ? t("ui.scenario_sample") : t("ui.scenario_note")}</p>
    </section>
  );
}

export function Flags({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation();
  const { lang } = useStore();
  if (!result.flags.length) return null;
  return (
    <ul className="flags">
      {result.flags.map((f, i) => <li key={i} className={f.severity}>{msgText(t, lang, f)}</li>)}
    </ul>
  );
}

export function Glossary() {
  const { t } = useTranslation();
  const terms = ["et0", "ndvi", "sma", "wb", "sat"];
  return (
    <section className="panel">
      <h3>{t("ui.glossary")}</h3>
      {terms.map((k) => (
        <details key={k}>
          <summary>{t(`ui.gl_${k}`)}</summary>
          <p>{t(`ui.gl_${k}_def`)}</p>
        </details>
      ))}
    </section>
  );
}
