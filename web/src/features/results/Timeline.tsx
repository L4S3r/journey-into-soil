import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AnalysisResult, Strategy } from "../../scene/types";
import { useStore } from "../../state/store";

const W = 800;
const H = 230;
const PAD_T = 26;
const PAD_B = 22;

/** Season bands, bare-field periods, rain, ET0, simulated moisture and canopy on one scrubbable axis. */
export function Timeline({ result, strategy }: { result: AnalysisResult; strategy: Strategy }) {
  const { t } = useTranslation();
  const { dayT, setDayT } = useStore();
  const ref = useRef<SVGSVGElement>(null);
  const n = result.timeline.days;
  const x = (i: number) => (i / Math.max(n - 1, 1)) * W;
  const idxOf = (iso: string) => Math.round((Date.parse(iso) - Date.parse(result.timeline.start)) / 86400000);
  const plotH = H - PAD_T - PAD_B;
  const y01 = (v: number) => H - PAD_B - Math.max(0, Math.min(1, v)) * plotH;
  const maxRain = Math.max(1, ...result.climate.rain);
  const maxEt = Math.max(1, ...result.climate.et0);
  const line = (arr: number[], scale: number) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y01(v / scale).toFixed(1)}`).join("");
  const canopyPath =
    `M0,${y01(0)}` + strategy.sim.canopy.map((v, i) => `L${x(i).toFixed(1)},${y01(v * 0.5).toFixed(1)}`).join("") + `L${W},${y01(0)}Z`;

  const scrub = (e: React.PointerEvent) => {
    if (!ref.current || (e.type === "pointermove" && e.buttons === 0)) return;
    const r = ref.current.getBoundingClientRect();
    setDayT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (n <= 1) return;
    const step = 1 / (n - 1);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setDayT(Math.min(1, dayT + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setDayT(Math.max(0, dayT - step));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setDayT(Math.min(1, dayT + step * 10));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setDayT(Math.max(0, dayT - step * 10));
    } else if (e.key === "Home") {
      e.preventDefault();
      setDayT(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setDayT(1);
    }
  };

  const day = Math.round(dayT * (n - 1));
  const currentDate = result.climate.dates[day] || "";
  const currentTmax = result.climate.tmax[day] ?? 0;
  const currentRain = result.climate.rain[day] ?? 0;

  return (
    <div className="timeline" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={t("ui.timeline_label")}
        aria-valuenow={day + 1}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuetext={`${currentDate}: ${t("ui.tmax")} ${currentTmax}°C, ${t("ui.rain")} ${currentRain} mm`}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e);
        }}
        onPointerMove={scrub}
      >
        <defs>
          <pattern id="bare" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--bare-bg)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bare-line)" strokeWidth="2" />
          </pattern>
        </defs>
        {strategy.bare_periods.map((b) => (
          <rect key={b.start} x={x(idxOf(b.start))} width={Math.max(2, x(idxOf(b.end)) - x(idxOf(b.start)))} y={PAD_T} height={plotH} fill="url(#bare)" />
        ))}
        {strategy.seasons.filter((s) => s.crop && s.sow_date && s.harvest_date).map((s) => {
          const a = x(idxOf(s.sow_date as string));
          const b = x(idxOf(s.harvest_date as string));
          return (
            <g key={s.sow_date}>
              <rect x={a} width={b - a} y={PAD_T} height={plotH} fill="var(--band)" opacity="0.55" />
              <text x={(a + b) / 2} y={16} textAnchor="middle" className="tl-label">{t(`crop.${s.crop}`)}</text>
            </g>
          );
        })}
        <path d={canopyPath} fill="var(--canopy)" opacity="0.35" />
        {result.climate.rain.map((v, i) => v > 0 && (
          <line key={i} x1={x(i)} x2={x(i)} y1={y01(0)} y2={y01((v / maxRain) * 0.4)} stroke="var(--rain)" strokeWidth="2" />
        ))}
        <path d={line(result.climate.et0, maxEt)} fill="none" stroke="var(--et0)" strokeWidth="1.4" />
        <path d={line(strategy.sim.moisture[0], 1.3)} fill="none" stroke="var(--m0)" strokeWidth="1.8" />
        <path d={line(strategy.sim.moisture[1], 1.3)} fill="none" stroke="var(--m1)" strokeWidth="1.8" strokeDasharray="4 3" />
        <line x1={x(day)} x2={x(day)} y1={PAD_T - 4} y2={H - PAD_B} stroke="var(--accent)" strokeWidth="2" />
        <circle cx={x(day)} cy={PAD_T - 4} r="5" fill="var(--accent)" />
        <text x="2" y={H - 6} className="tl-axis">{result.timeline.start}</text>
        <text x={W - 2} y={H - 6} textAnchor="end" className="tl-axis">{result.timeline.end}</text>
      </svg>
      <ul className="legend">
        <li><i style={{ background: "var(--m0)" }} />{t("ui.leg_moist0")}</li>
        <li><i style={{ background: "var(--m1)" }} />{t("ui.leg_moist1")}</li>
        <li><i style={{ background: "var(--et0)" }} />{t("ui.leg_et0")}</li>
        <li><i style={{ background: "var(--rain)" }} />{t("ui.leg_rain")}</li>
        <li><i className="hatch" />{t("ui.leg_bare")}</li>
      </ul>
      <p className="day-readout">
        {currentDate} · {t("ui.tmax")} {currentTmax}°C · {t("ui.rain")} {currentRain} mm
        {strategy.sim.irrigation_mm[day] > 0 && <> · {t("ui.irrigated")} {strategy.sim.irrigation_mm[day]} mm</>}
      </p>
    </div>
  );
}
