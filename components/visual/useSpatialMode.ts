"use client";
import { useEffect, useState } from "react";
import { spatialMode, type SpatialMode } from "@/lib/client/spatial";
export function useSpatialMode(animation: boolean) {
  const [state, setState] = useState<{
    mode: SpatialMode;
    mobile: boolean;
    visible: boolean;
  }>({ mode: "static", mobile: false, visible: true });
  useEffect(() => {
    const mobile = matchMedia("(max-width: 760px)"),
      reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const device = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const update = () =>
      setState({
        mobile: mobile.matches,
        visible: !document.hidden,
        mode: spatialMode({
          animation,
          reduceMotion: reduced.matches,
          mobile: mobile.matches,
          cores: device.hardwareConcurrency,
          memory: device.deviceMemory,
          saveData: device.connection?.saveData,
        }),
      });
    update();
    mobile.addEventListener("change", update);
    reduced.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mobile.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [animation]);
  return state;
}
