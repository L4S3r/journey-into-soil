import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import type { SceneController } from "./SceneController";

export function SoilScene() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<SceneController | null>(null);
  const prevKey = useRef<string>("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const { result, strategyId, dayT, theme, quality } = useStore();

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;

    import("./SceneController")
      .then(({ SceneController }) => {
        if (disposed || !canvasRef.current) return;
        try {
          ctrl.current = new SceneController(canvasRef.current);
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
