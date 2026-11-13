import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import type { SceneController } from "./SceneController";
import type { CameraPreset, LayerInspectData, SceneTelemetry } from "./types";
import "./SoilScene.css";

export function SoilScene() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const prevKey = useRef<string>("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>("perspective");
  const [isExploded, setIsExploded] = useState(false);
  const [inspectedLayer, setInspectedLayer] = useState<LayerInspectData | null>(null);
  const [telemetry, setTelemetry] = useState<SceneTelemetry | null>(null);

  const { result, strategyId, dayT, theme, quality } = useStore();

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;

    import("./SceneController")
      .then(({ SceneController }) => {
        if (disposed || !canvasRef.current) return;
        try {
          const controller = new SceneController(canvasRef.current);
          controller.setOnInspect((data) => setInspectedLayer(data));
          controller.setOnTelemetry((data) => setTelemetry(data));
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

  const handlePreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    ctrl.current?.setCameraPreset(preset);
  };

  const handleExplode = () => {
    const next = !isExploded;
    setIsExploded(next);
    ctrl.current?.setExploded(next);
  };

  const handleReplay = () => {
    setActivePreset("perspective");
    ctrl.current?.replay();
  };

  const handleSelectDepth = (layerIndex: number) => {
    ctrl.current?.inspectLayer(layerIndex);
  };

  return (
    <div className="scene-container" role="img" aria-label={t("ui.scene_label")}>
      <canvas ref={canvasRef} />
      {failed && <p className="scene-fallback">{t("ui.no_webgl")}</p>}

      {ready && (
        <div className="scene-overlay">
          {/* Top Bar: Live Telemetry & Control Buttons */}
          <div className="scene-top-bar">
            {telemetry && (
              <div className="scene-telemetry scene-glass">
                <span className="scene-telemetry-item">
                  <span className="scene-telemetry-badge">
                    {telemetry.cropId ? t(`crop.${telemetry.cropId}`, telemetry.cropId) : t("ui.scene_telemetry_fallow")}
                  </span>
                </span>
                <span className="scene-telemetry-item">
                  {t("ui.scene_telemetry_root")}: <b>{telemetry.rootCm} cm</b>
                </span>
                <span className="scene-telemetry-item">
                  {t("ui.scene_telemetry_canopy")}: <b>{telemetry.canopyPct}%</b>
                </span>
                <span className="scene-telemetry-item">
                  {telemetry.tempC}°C · {telemetry.rainMm > 0 ? `🌧️ ${telemetry.rainMm} mm` : `☀️ ${telemetry.et0Mm} mm ET₀`}
                </span>
              </div>
            )}

            <div className="scene-toolbar">
              <button
                type="button"
                className={`scene-btn ${activePreset === "perspective" ? "active" : ""}`}
                onClick={() => handlePreset("perspective")}
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
          <div className="scene-depth-ruler scene-glass">
            <button type="button" className="scene-depth-tick" onClick={() => handleSelectDepth(0)}>
              <i></i> 0 cm
            </button>
            <button type="button" className="scene-depth-tick" onClick={() => handleSelectDepth(0)}>
              <i></i> 20 cm
            </button>
            <button type="button" className="scene-depth-tick" onClick={() => handleSelectDepth(1)}>
              <i></i> 50 cm
            </button>
            <button type="button" className="scene-depth-tick" onClick={() => handleSelectDepth(2)}>
              <i></i> 90 cm
            </button>
            <button type="button" className="scene-depth-tick" onClick={() => handleSelectDepth(3)}>
              <i></i> 150 cm
            </button>
          </div>

          {/* Layer Inspector Card */}
          {inspectedLayer && (
            <div className="scene-inspector scene-glass" role="dialog" aria-labelledby="inspector-title">
              <div className="scene-inspector-header">
                <span id="inspector-title" className="scene-inspector-title">
                  {t(inspectedLayer.nameKey, `Layer ${inspectedLayer.layerIndex + 1}`)} ({inspectedLayer.topCm}–{inspectedLayer.bottomCm} cm)
                </span>
                <button
                  type="button"
                  className="scene-inspector-close"
                  onClick={() => {
                    ctrl.current?.clearInspection();
                    setInspectedLayer(null);
                  }}
                  aria-label={t("ui.scene_inspect_close")}
                >
                  ✕
                </button>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.gl_wb")}:</span>
                <span className={`scene-status-pill scene-status-${inspectedLayer.moistureStatus}`}>
                  {inspectedLayer.moisturePercent}% ({t(`ui.scene_moisture_${inspectedLayer.moistureStatus}`)})
                </span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.ece")}:</span>
                <span className={`scene-status-pill scene-status-${inspectedLayer.salinityStatus}`}>
                  {inspectedLayer.salinityDsm} dS/m ({t(`ui.scene_salinity_${inspectedLayer.salinityStatus}`)})
                </span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">{t("ui.layer_texture")}:</span>
                <span>{inspectedLayer.texture}</span>
              </div>

              <div className="scene-inspector-row">
                <span className="scene-inspector-label">OM:</span>
                <span>{inspectedLayer.organicMatter}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
