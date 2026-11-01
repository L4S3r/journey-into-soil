import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import { SceneController } from "./SceneController";

export function SoilScene() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const prevKey = useRef<string>("");
  const [failed, setFailed] = useState(false);
  const { result, strategyId, dayT, theme, quality } = useStore();

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      ctrl.current = new SceneController(canvasRef.current);
    } catch {
      setFailed(true); // WebGL unavailable: the text and charts still carry the whole result
    }
    return () => {
      ctrl.current?.dispose();
      ctrl.current = null;
      prevKey.current = "";
    };
  }, []);

  useEffect(() => {
    if (!result || !ctrl.current) return;
    const key = `${result.field.lat},${result.field.lon},${JSON.stringify(result.input.history)}`;
    ctrl.current.loadResult(result, key !== prevKey.current);
    prevKey.current = key;
  }, [result]);

  useEffect(() => ctrl.current?.setStrategy(strategyId), [strategyId, result]);
  useEffect(() => ctrl.current?.setSeasonTime(dayT), [dayT, result, strategyId]);
  useEffect(() => ctrl.current?.setTheme(theme), [theme]);
  useEffect(() => ctrl.current?.setQuality(quality), [quality]);

  return (
    <div className="scene" role="img" aria-label={t("ui.scene_label")}>
      <canvas ref={canvasRef} />
      {failed && <p className="scene-fallback">{t("ui.no_webgl")}</p>}
      <button className="ghost scene-replay" onClick={() => ctrl.current?.replay()}>
        {t("ui.replay")}
      </button>
    </div>
  );
}
