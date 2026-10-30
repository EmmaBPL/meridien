import { useCallback, useEffect, useState } from "react";
import { EarthGlobe, type ThemeName } from "@/components/earth-globe";
import type { City } from "@/lib/cities";
import {
  formatClock,
  formatOffset,
  formatWhen,
  homeLabel,
  leadPhrase,
  offsetMinutes,
  resolvePlace,
} from "@/lib/time-place";

type Status = "loading" | "ready" | "error";

export function Meridien() {
  const [theme, setTheme] = useState<ThemeName>("contact");
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [hint, setHint] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; city: City | null } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("meridien-theme");
    if (saved === "contact" || saved === "orbite") setTheme(saved);
    setMounted(true);
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const choose = (next: ThemeName) => {
    setTheme(next);
    window.localStorage.setItem("meridien-theme", next);
  };

  const onFocus = useCallback((next: { lat: number; lon: number; city: City | null }) => {
    setFocus((prev) => {
      if (!prev) return next;
      if (
        prev.city?.name === next.city?.name &&
        prev.lat.toFixed(1) === next.lat.toFixed(1) &&
        prev.lon.toFixed(1) === next.lon.toFixed(1)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const homeTz = mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const place = focus ? resolvePlace(focus.lat, focus.lon, focus.city) : null;
  const clock = now && place ? formatClock(now, place.timeZone) : null;
  const homeClock = now ? formatClock(now, homeTz) : null;
  const when = now && place ? formatWhen(now, place.timeZone, homeTz) : null;
  const lead =
    now && place ? leadPhrase(offsetMinutes(now, place.timeZone) - offsetMinutes(now, homeTz)) : "";
  const offset = now && place ? formatOffset(now, place.timeZone) : "";
  const subtitle =
    place?.kind === "city" && place.countryName ? `${place.countryName} · ${offset}` : offset;

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="app-header">
        <p className="brand">Méridien</p>
        <div className="theme-switch" role="tablist" aria-label="Ambiance">
          <button
            type="button"
            role="tab"
            aria-selected={theme === "orbite"}
            className={theme === "orbite" ? "is-on" : ""}
            onClick={() => choose("orbite")}
          >
            Orbite
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={theme === "contact"}
            className={theme === "contact" ? "is-on" : ""}
            onClick={() => choose("contact")}
          >
            Contact
          </button>
        </div>
      </header>

      {mounted ? (
        <EarthGlobe theme={theme} onFocus={onFocus} onStatus={setStatus} onSpin={() => setHint(false)} />
      ) : (
        <div className="globe-stage" />
      )}

      <section className="place-dock" aria-live="polite">
        <p className={hint && status === "ready" ? "hint" : "hint is-gone"}>
          Glisse pour tourner · pince pour zoomer
        </p>
        <div className="place-card">
          {status === "error" ? (
            <p className="place-title">La Terre n'a pas pu se charger</p>
          ) : !clock || !place || !when || !homeClock ? (
            <p className="place-title">La Terre se place…</p>
          ) : (
            <>
              <p className="clock-time">
                <span className="clock-hm">{clock.hm}</span>
                <span className="clock-s">{clock.s}</span>
              </p>
              <h1 className="place-title">{place.title}</h1>
              <p className="place-meta">{subtitle}</p>
              <p className="place-date">
                <span>{when.date}</span>
                {when.rel ? <span className="place-rel">{when.rel}</span> : null}
              </p>
              <p className="home-row">
                <span>Chez moi · {homeClock.hm} · {homeLabel(homeTz)}</span>
                <span className="home-lead">{lead}</span>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
