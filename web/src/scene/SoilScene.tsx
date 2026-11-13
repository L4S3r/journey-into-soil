import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import { SceneController } from "./SceneController";
import { THM, LAYER_NAMES, LAYER_DEPTHS, LAYER_COLORS, ALT } from "./textures";
import type { CameraPreset, DiveStage, LayerInspectData, SceneTelemetry } from "./types";
import "./SoilScene.css";

export function SoilScene() {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const prevKey = useRef<string>("");

  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>("perspective");
  const [diveStage, setDiveStage] = useState<DiveStage>("field");
  const [diveCaptionKey, setDiveCaptionKey] = useState<string | null>("ui.dive_caption_field");
  const [canSkipDive, setCanSkipDive] = useState<boolean>(true);
  const [isExploded, setIsExploded] = useState(false);
  const [inspectedLayer, setInspectedLayer] = useState<LayerInspectData | null>(null);
  const [telemetry, setTelemetry] = useState<SceneTelemetry | null>(null);
  const [telemetryExpanded, setTelemetryExpanded] = useState(false);

  // Drawer & Tab state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"recommendations" | "charts" | null>(null);

  // 3D projected coordinates for SVG connector arrows
  const [projectedCoords, setProjectedCoords] = useState<[number, number][]>([
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]);

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isRtl = i18n.dir() === "rtl";

  const { result, strategyId, dayT, theme, quality, focusedLayer, setFocusedLayer } = useStore();

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;

    try {
      const controller = new SceneController(canvasRef.current);
      controller.setOnInspect((data) => setInspectedLayer(data));
      controller.setOnTelemetry((data) => setTelemetry(data));
      controller.setOnStageChange((stage) => {
        setDiveStage(stage);
        setIsExploded(stage === "layers");
      });
      controller.setOnLayerFocusChange((idx) => {
        setFocusedLayer(idx);
      });
      controller.setOnDiveProgress((key, canSkip) => {
        setDiveCaptionKey(key);
        setCanSkipDive(canSkip);
      });

      ctrl.current = controller;
      setReady(true);
    } catch {
      if (!disposed) setFailed(true);
    }

    return () => {
      disposed = true;
      ctrl.current?.dispose();
      ctrl.current = null;
      prevKey.current = "";
      setReady(false);
    };
  }, [setFocusedLayer]);

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

  useEffect(() => {
    if (!ctrl.current || !ready) return;
    if (ctrl.current.getFocusedLayer() !== focusedLayer) {
      ctrl.current.focusLayer(focusedLayer);
    }
  }, [focusedLayer, ready]);

  // Update SVG arrows tracking projected 3D positions
  useEffect(() => {
    if (!ready || !ctrl.current) return;
    let animId: number;

    const updateArrows = () => {
      if (ctrl.current && diveStage !== "field") {
        setProjectedCoords([
          ctrl.current.project(0),
          ctrl.current.project(1),
          ctrl.current.project(2),
          ctrl.current.project(3),
        ]);
      }
      animId = requestAnimationFrame(updateArrows);
    };

    animId = requestAnimationFrame(updateArrows);
    return () => cancelAnimationFrame(animId);
  }, [ready, diveStage]);

  const handlePreset = (preset: CameraPreset) => {
    ctrl.current?.clearDiveTimeouts();
    setDiveCaptionKey(null);
    setCanSkipDive(false);
    setActivePreset(preset);
    ctrl.current?.setCameraPreset(preset);
    if (preset === "perspective") {
      setDiveStage("layers");
      setIsExploded(true);
    } else if (preset === "cutaway") {
      setDiveStage("underground");
      setIsExploded(false);
    } else if (preset === "canopy") {
      setDiveStage("field");
      setIsExploded(false);
    }
  };

  const handleStageSelect = (stage: DiveStage) => {
    ctrl.current?.clearDiveTimeouts();
    setDiveCaptionKey(null);
    setCanSkipDive(false);
    setDiveStage(stage);
    setIsExploded(stage === "layers");
    ctrl.current?.setDiveStage(stage);
  };

  const handleExplode = () => {
    ctrl.current?.clearDiveTimeouts();
    setDiveCaptionKey(null);
    setCanSkipDive(false);
    const next = !isExploded;
    setIsExploded(next);
    ctrl.current?.setExploded(next);
    setDiveStage(next ? "layers" : "underground");
  };

  const handleSkipDive = () => {
    ctrl.current?.skipDive();
    setDiveCaptionKey(null);
    setCanSkipDive(false);
  };

  const handleReplay = () => {
    setFocusedLayer(null);
    ctrl.current?.clearFocus();
    setActivePreset("perspective");
    ctrl.current?.replay();
  };

  const handleSelectLayer = (idx: number) => {
    if (focusedLayer === idx) {
      setFocusedLayer(null);
      ctrl.current?.clearFocus();
    } else {
      setFocusedLayer(idx);
      ctrl.current?.focusLayer(idx);
    }
  };

  const handleTabToggle = (tab: "recommendations" | "charts") => {
    if (drawerOpen && activeTab === tab) {
      setDrawerOpen(false);
      setActiveTab(null);
    } else {
      setDrawerOpen(true);
      setActiveTab(tab);
    }
  };

  // Extract layer data from result or fallbacks
  const layers = [0, 1, 2, 3].map((i) => {
    const l = result?.layers?.[i];
    return {
      name: LAYER_NAMES[i],
      depth: LAYER_DEPTHS[i],
      color: LAYER_COLORS[i],
      alt: ALT[i],
      sand: l ? Math.round(l.sand) : [40, 30, 20, 80][i],
      silt: l ? Math.round(l.silt) : [40, 35, 25, 12][i],
      clay: l ? Math.round(l.clay) : [20, 35, 55, 8][i],
      om: l ? Number(l.om.toFixed(1)) : [3.0, 1.4, 0.6, 0.2][i],
      moist: l ? Math.round(l.fc * 100) : [24, 28, 32, 14][i],
      ph: l ? Number(l.ph.toFixed(1)) : [7.6, 7.8, 8.0, 8.2][i],
      ec: l ? Number(l.ec.toFixed(1)) : [1.4, 1.8, 2.4, 3.1][i],
    };
  });

  // Calculate ternary points for USDA triangle SVG
  const getTernaryPoint = (sand: number, silt: number, clay: number): [number, number] => {
    return [
      (sand * 286 + silt * 14 + clay * 150) / 100,
      (sand * 250 + silt * 250 + clay * 14) / 100,
    ];
  };

  const activeStrat =
    result?.strategies?.find((s) => s.id === strategyId) || result?.strategies?.[0];

  return (
    <div className="scene-container" data-stage={diveStage} data-theme={theme} dir={isRtl ? "rtl" : "ltr"}>
      {/* Horizon Sun & Sky Atmospheric Backdrop */}
      <div
        className="scene-bg-gradient"
        style={{
          opacity: diveStage === "field" ? 1 : 0,
        }}
        aria-hidden="true"
      />

      <canvas ref={canvasRef} role="img" aria-label={t("ui.scene_label")} />
      {failed && <p className="scene-fallback">{t("ui.no_webgl")}</p>}

      {ready && (
        <div className="scene-overlay">
          {/* Top Bar: Live Telemetry & Control Toolbar */}
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

            {/* Camera and View Controls */}
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

          {/* Act 1 Field Stage Hero Overlay & Dive Invitation */}
          {diveStage === "field" && (
            <div className="scene-field-hero scene-glass" role="region" aria-label={t("ui.stage_field")}>
              <div className="scene-field-hero-info">
                <span className="scene-field-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="scene-icon" aria-hidden="true">
                    <path d="M12 2a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9s-9-4.03-9-9a9 9 0 0 1 9-9z" />
                    <path d="M12 6v14" />
                    <path d="M8 10c2-2 4-2 4 0" />
                    <path d="M12 14c2-2 4-2 4 0" />
                  </svg>
                  <span>{result?.field.region || "Nile Delta"} · {result?.field.area_feddan ?? 5} Feddan</span>
                </span>
                <h2 className="scene-field-title">
                  {telemetry?.cropId ? t(`crop.${telemetry.cropId}`, telemetry.cropId) : t("crop.wheat", "Wheat")}
                </h2>
                <p className="scene-field-sub">
                  {t("ui.dive_caption_field")}
                </p>
              </div>

              <button
                type="button"
                className="scene-dive-cta"
                onClick={() => handleStageSelect("underground")}
                aria-label={t("ui.dive_into_soil")}
              >
                <span>{t("ui.dive_into_soil")}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="scene-dive-cta-arrow" aria-hidden="true">
                  <path d="M12 3v14" />
                  <path d="m7 12 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </button>
            </div>
          )}

          {/* Depth Ruler on Left */}
          {diveStage !== "field" && (
            <div className="scene-ruler-wrap" role="region" aria-label={t("ui.depth_ruler")}>
              <div className="scene-ruler-bar">
                <div
                  className="scene-ruler-marker"
                  style={{
                    top: diveStage === "underground" ? "35%" : "85%",
                  }}
                >
                  <span>{diveStage === "underground" ? "50 cm" : "150 cm"}</span>
                </div>
              </div>
            </div>
          )}

          {/* SVG Connecting Curved Arrows */}
          {diveStage !== "field" && (
            <svg className="scene-svg-arrows" aria-hidden="true">
              <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M0,0 L10,5 L0,10z" fill="#ffd54a" />
                </marker>
              </defs>
              <g>
                {layers.map((_, i) => {
                  const [ax, ay] = projectedCoords[i] || [0, 0];
                  const cardEl = cardRefs.current[i];
                  if (!cardEl || ax <= 0 || ay <= 0) return null;

                  const rect = cardEl.getBoundingClientRect();
                  const containerRect = cardEl.closest(".scene-container")?.getBoundingClientRect() || {
                    left: 0,
                    top: 0,
                  };

                  const cx = isRtl
                    ? rect.right - containerRect.left
                    : rect.left - containerRect.left;
                  const cy = rect.top - containerRect.top + rect.height / 2;

                  const ctrlX1 = isRtl ? cx + 80 : cx - 80;
                  const ctrlX2 = isRtl ? ax - 90 : ax + 90;

                  return (
                    <path
                      key={i}
                      d={`M ${cx} ${cy} C ${ctrlX1} ${cy}, ${ctrlX2} ${ay}, ${ax} ${ay}`}
                      fill="none"
                      stroke="#ffd54a"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      markerEnd="url(#arrowhead)"
                      className="scene-connector-arrow"
                      style={{
                        animationDelay: `${i * 0.2 + 0.3}s`,
                      }}
                    />
                  );
                })}
              </g>
            </svg>
          )}

          {/* Floating Layer Callout Cards */}
          {diveStage !== "field" && (
            <div className="scene-callouts" role="region" aria-label={t("ui.layers_title")}>
              {layers.map((l, i) => {
                const isSelected = focusedLayer === i;
                return (
                  <div
                    key={i}
                    ref={(el) => { cardRefs.current[i] = el; }}
                    className={`scene-layer-card scene-glass ${isSelected ? "selected" : ""}`}
                    style={{
                      borderInlineStartColor: l.color,
                      animationDelay: `${i * 0.2}s`,
                    }}
                    onClick={() => handleSelectLayer(i)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${t("ui.layer_n", { n: i + 1 })}: ${l.name}`}
                  >
                    <div className="scene-card-header">
                      <img className="scene-card-thumb" src={THM[i]} alt={l.alt} title={l.alt} />
                      <div className="scene-card-title">
                        <b>{i + 1}. {t(`ui.layer_${i}`, l.name)}</b>
                        <span className="scene-card-depth"><bdi dir="ltr">{l.depth}</bdi></span>
                      </div>
                      {isSelected && inspectedLayer && (
                        <span className={`scene-status-pill scene-status-${inspectedLayer.moistureStatus}`}>
                          {t(`ui.scene_moisture_${inspectedLayer.moistureStatus}`)}
                        </span>
                      )}
                    </div>

                    <div className="scene-card-body">
                      {/* Sand/Silt/Clay Donut */}
                      <div
                        className="scene-card-donut"
                        style={{
                          background: `conic-gradient(#e3cf9a 0 ${l.sand}%, #a89578 ${l.sand}% ${l.sand + l.silt}%, #9a5a3c ${l.sand + l.silt}% 100%)`,
                        }}
                        aria-hidden="true"
                      />
                      <div className="scene-card-props">
                        <div className="scene-prop-row">
                          <span><i style={{ color: "#e3cf9a" }}>●</i> {t("ui.texture_sand")}</span>
                          <b><bdi dir="ltr">{l.sand}%</bdi></b>
                        </div>
                        <div className="scene-prop-row">
                          <span><i style={{ color: "#a89578" }}>●</i> {t("ui.texture_silt")}</span>
                          <b><bdi dir="ltr">{l.silt}%</bdi></b>
                        </div>
                        <div className="scene-prop-row">
                          <span><i style={{ color: "#9a5a3c" }}>●</i> {t("ui.texture_clay")}</span>
                          <b><bdi dir="ltr">{l.clay}%</bdi></b>
                        </div>
                      </div>
                    </div>

                    <div className="scene-card-footer">
                      <span>OM <bdi dir="ltr">{l.om}%</bdi></span>
                      <span>·</span>
                      <span>{t("ui.scene_available_water")} <bdi dir="ltr">{l.moist}%</bdi></span>
                      <span>·</span>
                      <span>pH <bdi dir="ltr">{l.ph}</bdi></span>
                      <span>·</span>
                      <span>EC <bdi dir="ltr">{l.ec}</bdi></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Dock & Expandable Drawer */}
          <div className={`scene-dock ${diveStage === "layers" ? "visible" : ""}`} role="region">
            <div className={`scene-drawer ${drawerOpen ? "open" : ""}`} role="region" aria-live="polite">
              {activeTab === "recommendations" && (
                <div className="scene-drawer-content">
                  <div className="scene-drawer-header">
                    <h3>{t("ui.tab_recommendations")}</h3>
                    <p className="scene-drawer-sub">
                      {activeStrat?.label_key ? t(activeStrat.label_key) : t("strategy.primary")} · {result?.field.area_feddan ?? 5} feddan
                    </p>
                  </div>
                  <div className="scene-recommendation-grid">
                    {result?.strategies.map((strat, sIdx) => {
                      const score = Math.round(strat.scores.total || 85);
                      return (
                        <div key={strat.id} className="scene-pick-card scene-glass">
                          <div className="scene-pick-head">
                            <span>
                              <b>{sIdx + 1}. {t(strat.label_key, strat.id)}</b>
                            </span>
                            <div className="scene-score-ring">
                              <span>{score}</span>
                            </div>
                          </div>
                          <ul className="scene-pick-reasons">
                            {strat.benefits.slice(0, 2).map((b, bIdx) => (
                              <li key={bIdx}>{t(b.key, b.params)}</li>
                            ))}
                            {strat.risks.slice(0, 1).map((r, rIdx) => (
                              <li key={rIdx} className="scene-risk-item">{t(r.key, r.params)}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "charts" && (
                <div className="scene-drawer-content">
                  <div className="scene-drawer-header">
                    <h3>{t("ui.tab_charts")}</h3>
                  </div>
                  <div className="scene-charts-grid">
                    {/* USDA Soil Texture Triangle */}
                    <div className="scene-chart-card scene-glass">
                      <b>{t("ui.usda_triangle_title")}</b>
                      <p className="scene-chart-sub">{t("ui.usda_triangle_sub")}</p>
                      <svg viewBox="0 0 300 275" width="100%" className="scene-usda-triangle" role="img" aria-label={t("ui.usda_triangle_title")}>
                        <polygon points="150,14 14,250 286,250" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.4)" />
                        {[20, 40, 60, 80].map((k) => (
                          <g key={k} opacity="0.3">
                            <line x1={getTernaryPoint(100 - k, 0, k)[0]} y1={getTernaryPoint(100 - k, 0, k)[1]} x2={getTernaryPoint(0, 100 - k, k)[0]} y2={getTernaryPoint(0, 100 - k, k)[1]} stroke="#fff" />
                            <line x1={getTernaryPoint(k, 100 - k, 0)[0]} y1={getTernaryPoint(k, 100 - k, 0)[1]} x2={getTernaryPoint(k, 0, 100 - k)[0]} y2={getTernaryPoint(k, 0, 100 - k)[1]} stroke="#fff" />
                            <line x1={getTernaryPoint(100 - k, k, 0)[0]} y1={getTernaryPoint(100 - k, k, 0)[1]} x2={getTernaryPoint(0, k, 100 - k)[0]} y2={getTernaryPoint(0, k, 100 - k)[1]} stroke="#fff" />
                          </g>
                        ))}
                        <text x="150" y="10" fill="#fff" fontSize="11" textAnchor="middle">{t("ui.texture_clay")} 100%</text>
                        <text x="10" y="265" fill="#fff" fontSize="11">{t("ui.texture_silt")}</text>
                        <text x="290" y="265" fill="#fff" fontSize="11" textAnchor="end">{t("ui.texture_sand")}</text>

                        {/* Textural progression polyline */}
                        <polyline
                          points={layers.map((l) => getTernaryPoint(l.sand, l.silt, l.clay).join(",")).join(" ")}
                          fill="none"
                          stroke="#ffd54a"
                          strokeWidth="2"
                          strokeDasharray="4 3"
                        />
                        {layers.map((l, i) => {
                          const [px, py] = getTernaryPoint(l.sand, l.silt, l.clay);
                          return (
                            <g key={i}>
                              <circle cx={px} cy={py} r="10" fill={l.color} stroke="#fff" strokeWidth="2" />
                              <text x={px} y={py + 4} fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle">{i + 1}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>

                    {/* Property Heatmap */}
                    <div className="scene-chart-card scene-glass">
                      <b>{t("ui.heatmap_title")}</b>
                      <p className="scene-chart-sub">{t("ui.heatmap_sub")}</p>
                      <div className="scene-heatmap-table">
                        <div className="scene-hm-row scene-hm-head">
                          <span className="scene-hm-label"></span>
                          {layers.map((_, i) => (
                            <span key={i} className="scene-hm-col">{t("ui.layer_n", { n: i + 1 })}</span>
                          ))}
                        </div>

                        <div className="scene-hm-row">
                          <span className="scene-hm-label">{t("ui.om_label")}</span>
                          {layers.map((l, i) => (
                            <span
                              key={i}
                              className="scene-hm-cell"
                              style={{ background: `rgba(166,217,150, ${0.15 + (l.om / 4) * 0.65})` }}
                            >
                              <bdi dir="ltr">{l.om}%</bdi>
                            </span>
                          ))}
                        </div>

                        <div className="scene-hm-row">
                          <span className="scene-hm-label">{t("ui.scene_available_water")}</span>
                          {layers.map((l, i) => (
                            <span
                              key={i}
                              className="scene-hm-cell"
                              style={{ background: `rgba(111,166,212, ${0.15 + (l.moist / 40) * 0.65})` }}
                            >
                              <bdi dir="ltr">{l.moist}%</bdi>
                            </span>
                          ))}
                        </div>

                        <div className="scene-hm-row">
                          <span className="scene-hm-label">pH</span>
                          {layers.map((l, i) => (
                            <span
                              key={i}
                              className="scene-hm-cell"
                              style={{ background: `rgba(235,170,110, ${0.15 + Math.abs(l.ph - 7) * 0.4})` }}
                            >
                              <bdi dir="ltr">{l.ph}</bdi>
                            </span>
                          ))}
                        </div>

                        <div className="scene-hm-row">
                          <span className="scene-hm-label">{t("ui.ece")}</span>
                          {layers.map((l, i) => (
                            <span
                              key={i}
                              className="scene-hm-cell"
                              style={{ background: `rgba(255,178,125, ${0.15 + (l.ec / 6) * 0.65})` }}
                            >
                              <bdi dir="ltr">{l.ec}</bdi>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Dock Control Bar */}
            <div className="scene-dock-bar">
              <button
                type="button"
                className={`scene-dock-tab ${drawerOpen && activeTab === "recommendations" ? "active" : ""}`}
                onClick={() => handleTabToggle("recommendations")}
                aria-expanded={drawerOpen && activeTab === "recommendations"}
              >
                <span>{t("ui.tab_recommendations")}</span>
                <span className="scene-dock-arrow">{drawerOpen && activeTab === "recommendations" ? "▼" : "▲"}</span>
              </button>

              <button
                type="button"
                className={`scene-dock-tab ${drawerOpen && activeTab === "charts" ? "active" : ""}`}
                onClick={() => handleTabToggle("charts")}
                aria-expanded={drawerOpen && activeTab === "charts"}
              >
                <span>{t("ui.tab_charts")}</span>
                <span className="scene-dock-arrow">{drawerOpen && activeTab === "charts" ? "▼" : "▲"}</span>
              </button>

              {activeStrat && (
                <span className="scene-dock-topk">
                  {t("ui.top_pick", {
                    name: t(activeStrat.label_key, activeStrat.id),
                    score: Math.round(activeStrat.scores.total || 85),
                  })}
                </span>
              )}

              <button type="button" className="scene-dock-ghost" onClick={handleReplay}>
                {t("ui.replay")}
              </button>
            </div>
          </div>

          {/* Bottom Bar: Narrative Dive Caption & 3-Stage Excavation Stepper */}
          <div className="scene-bottom-bar">
            {diveCaptionKey && (
              <div className="scene-dive-narrative scene-glass" role="status" aria-live="polite">
                <div className="scene-dive-text">
                  <svg className="scene-dive-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>{t(diveCaptionKey)}</span>
                </div>
                {canSkipDive && (
                  <button
                    type="button"
                    className="scene-dive-skip"
                    onClick={handleSkipDive}
                    title={t("ui.dive_skip")}
                    aria-label={t("ui.dive_skip")}
                  >
                    <span>{t("ui.dive_skip")}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="5 4 15 12 5 20 5 4" />
                      <line x1="19" y1="5" x2="19" y2="19" />
                    </svg>
                  </button>
                )}
              </div>
            )}

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
