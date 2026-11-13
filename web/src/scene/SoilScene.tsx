import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import type { SceneController } from "./SceneController";
import type { CameraPreset, DiveStage, LayerInspectData, SceneTelemetry } from "./types";
import "./SoilScene.css";

export function SoilScene() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const prevKey = useRef<string>("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>("perspective");
  const [diveStage, setDiveStage] = useState<DiveStage>("layers");
  const [isExploded, setIsExploded] = useState(false);
  const [inspectedLayer, setInspectedLayer] = useState<LayerInspectData | null>(null);
  const [telemetry, setTelemetry] = useState<SceneTelemetry | null>(null);
  const [telemetryExpanded, setTelemetryExpanded] = useState(false);

  const inspectorRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const { result, strategyId, dayT, theme, quality } = useStore();

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;

    import("./SceneController")
      .then(({ SceneController }) => {
        if (disposed || !canvasRef.current) return;
        try {
          const controller = new SceneController(canvasRef.current);
          controller.setOnInspect((data) => {
            setInspectedLayer(data);
          });
          controller.setOnTelemetry((data) => setTelemetry(data));
          controller.setOnStageChange((stage) => {
            setDiveStage(stage);
            setIsExploded(stage === "layers");
          });
          ctrl.current = controller;
          setReady(true);
        } catch {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      ctrl.current?.dispose();
      ctrl.current = null;
      prevKey.current = "";
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!result || !ctrl.current || !ready) return;
    const key = `${result.field.lat},${result.field.lon},${JSON.stringify(result.input.history)}`;
    ctrl.current.loadResult(result, key !== prevKey.current);
    prevKey.current = key;
  }, [result, ready]);

  useEffect(() => ctrl.current?.setStrategy(strategyId), [strategyId, result, ready]);
  useEffect(() => ctrl.current?.setSeasonTime(dayT), [dayT, result, strategyId, ready]);
  useEffect(() => ctrl.current?.setTheme(theme), [theme, ready]);
  useEffect(() => ctrl.current?.setQuality(quality), [quality, ready]);

  // Focus management for inspector dialog & Esc key handling
  useEffect(() => {
    if (inspectedLayer) {
      if (document.activeElement instanceof HTMLElement && !inspectorRef.current?.contains(document.activeElement)) {
        openerRef.current = document.activeElement;
      }
      inspectorRef.current?.focus();
    }
  }, [inspectedLayer?.layerIndex]);

  useEffect(() => {
    if (!inspectedLayer) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ctrl.current?.clearInspection();
        setInspectedLayer(null);
        openerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectedLayer]);

  const handlePreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    ctrl.current?.setCameraPreset(preset);
    if (preset === "perspective") {
      setDiveStage("layers");
      setIsExploded(true);
    } else if (preset === "cutaway") {
      setDiveStage("underground");
      setIsExploded(false);
    }
  };

  const handleStageSelect = (stage: DiveStage) => {
    setDiveStage(stage);
    setIsExploded(stage === "layers");
    ctrl.current?.setDiveStage(stage);
  };

  const handleExplode = () => {
    const next = !isExploded;
    setIsExploded(next);
    ctrl.current?.setExploded(next);
    setDiveStage(next ? "layers" : "underground");
  };

  const handleReplay = () => {
    setActivePreset("perspective");
    ctrl.current?.replay();
  };

  const handleSelectDepth = (layerIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
    openerRef.current = e.currentTarget;
    ctrl.current?.inspectLayer(layerIndex);
  };

  const handleCloseInspector = () => {
    ctrl.current?.clearInspection();
    setInspectedLayer(null);
    openerRef.current?.focus();
  };

  return (
    <div className="scene-container">
      <canvas ref={canvasRef} role="img" aria-label={t("ui.scene_label")} />
      {failed && <p className="scene-fallback">{t("ui.no_webgl")}</p>}

      {ready && (
        <div className="scene-overlay">
          {/* Top Bar: Live Telemetry & Control Buttons */}
          <div className="scene-top-bar">
            {telemetry && (
              <div
                className={`scene-telemetry scene-glass ${telemetryExpanded ? "expanded" : "collapsed"}`}
                onClick={() => setTelemetryExpanded((prev) => !prev)}
                role="region"
                aria-label={t("ui.data")}
              >
                <span className="scene-telemetry-item">
                  <span className="scene-telemetry-badge">
                    <svg className="scene-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M7 20h10" />
                      <path d="M10 20c0-3.3 2.7-6 6-6a6 6 0 0 0 2-4.5" />
                      <path d="M12 20v-8" />
                      <path d="M12 12c-2.5 0-5-2-5-5 3.5 0 5 2 5 5z" />
                    </svg>
                    <span>{telemetry.cropId ? t(`crop.${telemetry.cropId}`, telemetry.cropId) : t("ui.scene_telemetry_fallow")}</span>
                  </span>
                </span>

                <span className="scene-telemetry-item">
                  {t("ui.scene_telemetry_root")}: <b><bdi dir="ltr">{t("ui.unit_cm", { val: telemetry.rootCm })}</bdi></b>
                </span>

                {/* Additional telemetry items: visible always on desktop, toggleable on mobile */}
                <div className="scene-telemetry-details">
                  <span className="scene-telemetry-item">
                    {t("ui.scene_telemetry_canopy")}: <b><bdi dir="ltr">{telemetry.canopyPct}%</bdi></b>
                  </span>

                  <span className="scene-telemetry-item">
                    <svg className="scene-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
                    </svg>
                    <span><bdi dir="ltr">{telemetry.tempC}°C</bdi></span>
                  </span>

                  <span className="scene-telemetry-item">
                    {telemetry.rainMm > 0 ? (
                      <>
                        <svg className="scene-icon scene-icon-rain" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
                          <line x1="8" y1="19" x2="8" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                          <line x1="16" y1="19" x2="16" y2="21" />
                        </svg>
                        <span><bdi dir="ltr">{telemetry.rainMm} mm</bdi></span>
                      </>
                    ) : (
                      <>
                        <svg className="scene-icon scene-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle cx="12" cy="12" r="5" />
                          <line x1="12" y1="1" x2="12" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="23" />
                          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                          <line x1="1" y1="12" x2="3" y2="12" />
                          <line x1="21" y1="12" x2="23" y2="12" />
                          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                        <span><bdi dir="ltr">{t("ui.et0_val", { val: telemetry.et0Mm })}</bdi></span>
                      </>
                    )}
                  </span>

                  {telemetry.date && (
                    <span className="scene-telemetry-item scene-telemetry-date">
                      <bdi dir="ltr">{telemetry.date}</bdi>
                    </span>
                  )}

                  {telemetry.isSynthetic && (
                    <span className="badge warn scene-synthetic-badge">
                      {t("ui.placeholder_climate")}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="scene-telemetry-toggle"
                  aria-label={t(telemetryExpanded ? "ui.collapse" : "ui.expand")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`scene-toggle-arrow ${telemetryExpanded ? "rotated" : ""}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            )}

            <div className="scene-toolbar" role="toolbar" aria-label={t("ui.scene_label")}>
              <button
                type="button"
                className={`scene-btn ${activePreset === "perspective" ? "active" : ""}`}
                onClick={() => handlePreset("perspective")}
                aria-pressed={activePreset === "perspective"}
                title={t("ui.scene_view_3d")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <span>{t("ui.scene_view_3d")}</span>
              </button>

              <button
                type="button"
                className={`scene-btn ${activePreset === "cutaway" ? "active" : ""}`}
                onClick={() => handlePreset("cutaway")}
                aria-pressed={activePreset === "cutaway"}
                title={t("ui.scene_view_cutaway")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="3" y1="15" x2="21" y2="15" />
                </svg>
                <span>{t("ui.scene_view_cutaway")}</span>
              </button>

              <button
                type="button"
                className={`scene-btn ${activePreset === "canopy" ? "active" : ""}`}
                onClick={() => handlePreset("canopy")}
                aria-pressed={activePreset === "canopy"}
                title={t("ui.scene_view_canopy")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 2a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9s-9-4.03-9-9a9 9 0 0 1 9-9z" />
                  <path d="M12 6v14" />
                  <path d="M8 10c2-2 4-2 4 0" />
                  <path d="M12 14c2-2 4-2 4 0" />
                </svg>
                <span>{t("ui.scene_view_canopy")}</span>
              </button>

              <button
                type="button"
                className={`scene-btn ${isExploded ? "active" : ""}`}
                onClick={handleExplode}
                aria-pressed={isExploded}
                title={isExploded ? t("ui.scene_compact") : t("ui.scene_explode")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
                <span>{isExploded ? t("ui.scene_compact") : t("ui.scene_explode")}</span>
              </button>

              <button
                type="button"
                className="scene-btn"
                onClick={handleReplay}
                title={t("ui.replay")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <span>{t("ui.replay")}</span>
              </button>
            </div>
          </div>

          {/* Left Depth Ruler */}
          {diveStage !== "field" && (
            <div className="scene-depth-ruler scene-glass">
              <button type="button" className="scene-depth-tick" onClick={(e) => handleSelectDepth(0, e)}>
                <i></i> <bdi dir="ltr">{t("ui.unit_cm", { val: 0 })}</bdi>
              </button>
              <button type="button" className="scene-depth-tick" onClick={(e) => handleSelectDepth(0, e)}>
                <i></i> <bdi dir="ltr">{t("ui.unit_cm", { val: 20 })}</bdi>
              </button>
              <button type="button" className="scene-depth-tick" onClick={(e) => handleSelectDepth(1, e)}>
                <i></i> <bdi dir="ltr">{t("ui.unit_cm", { val: 50 })}</bdi>
              </button>
              <button type="button" className="scene-depth-tick" onClick={(e) => handleSelectDepth(2, e)}>
                <i></i> <bdi dir="ltr">{t("ui.unit_cm", { val: 90 })}</bdi>
              </button>
              <button type="button" className="scene-depth-tick" onClick={(e) => handleSelectDepth(3, e)}>
                <i></i> <bdi dir="ltr">{t("ui.unit_cm", { val: 150 })}</bdi>
              </button>
            </div>
          )}

          {/* Layer Inspector Card / Bottom Sheet */}
          {inspectedLayer && (
            <div
              ref={inspectorRef}
              tabIndex={-1}
              className="scene-inspector scene-glass"
              role="dialog"
              aria-labelledby="inspector-title"
              aria-modal="false"
            >
              <div className="scene-inspector-header">
                <span id="inspector-title" className="scene-inspector-title">
                  {t(inspectedLayer.nameKey, t("ui.layer_fallback", { n: inspectedLayer.layerIndex + 1 }))} (
                  <bdi dir="ltr">{t("ui.unit_cm", { val: `${inspectedLayer.topCm}–${inspectedLayer.bottomCm}` })}</bdi>)
                </span>
                <button
                  type="button"
                  className="scene-inspector-close"
                  onClick={handleCloseInspector}
                  aria-label={t("ui.scene_inspect_close")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.scene_available_water")}:</span>
                <span className={`scene-status-pill scene-status-${inspectedLayer.moistureStatus}`}>
                  <bdi dir="ltr">{inspectedLayer.availableWaterPct}%</bdi> ({t(`ui.scene_moisture_${inspectedLayer.moistureStatus}`)})
                </span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.ece")}:</span>
                <span className={`scene-status-pill scene-status-${inspectedLayer.salinityStatus}`}>
                  <bdi dir="ltr">{inspectedLayer.salinityDsm} dS/m</bdi> ({t(`ui.scene_salinity_${inspectedLayer.salinityStatus}`)})
                </span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.layer_texture")}:</span>
                <span>
                  {t("ui.texture_proportions", {
                    sand: inspectedLayer.sand,
                    silt: inspectedLayer.silt,
                    clay: inspectedLayer.clay,
                  })}
                </span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.om_label")}:</span>
                <span><bdi dir="ltr">{inspectedLayer.organicMatter}%</bdi></span>
              </div>
            </div>
          )}

          {/* Bottom Bar: 3-Stage Excavation Stepper */}
          <div className="scene-bottom-bar">
            <nav className="scene-stages scene-glass" aria-label={t("ui.dive_into_soil")}>
              <button
                type="button"
                className={`scene-stage-btn ${diveStage === "field" ? "active" : ""}`}
                onClick={() => handleStageSelect("field")}
                aria-current={diveStage === "field" ? "step" : undefined}
                title={t("ui.stage_field")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5" />
                  <path d="M5 19h14" />
                  <path d="M12 11c3 0 6-3 6-6-3 0-6 3-6 6z" />
                  <path d="M12 14c-3 0-6-3-6-6 3 0 6 3 6 6z" />
                </svg>
                <span>{t("ui.stage_field")}</span>
              </button>

              <svg className="scene-stage-sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>

              <button
                type="button"
                className={`scene-stage-btn ${diveStage === "underground" ? "active" : ""}`}
                onClick={() => handleStageSelect("underground")}
                aria-current={diveStage === "underground" ? "step" : undefined}
                title={t("ui.stage_underground")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v14" />
                  <path d="m7 12 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                <span>{t("ui.stage_underground")}</span>
              </button>

              <svg className="scene-stage-sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>

              <button
                type="button"
                className={`scene-stage-btn ${diveStage === "layers" ? "active" : ""}`}
                onClick={() => handleStageSelect("layers")}
                aria-current={diveStage === "layers" ? "step" : undefined}
                title={t("ui.stage_layers")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 17l10 5 10-5M2 12l10 5 10-5M12 2L2 7l10 5 10-5L12 2z" />
                </svg>
                <span>{t("ui.stage_layers")}</span>
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
