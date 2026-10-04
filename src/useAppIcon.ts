import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./storage";

export function useAppIcon(dark: boolean) {
  const nativeQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const url = dark ? "/scribly-icon-dark.png" : "/scribly-icon.png";
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = url;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    }
    if (!desktop) return;

    let cancelled = false;
    // Serialize native updates so rapid theme changes cannot restore an older icon.
    nativeQueue.current = nativeQueue.current.then(async () => {
      if (cancelled) return;
      // The native command updates both Windows icon slots using cached ICOs.
      await invoke("set_app_theme_icon", { dark });
    }).catch((error: unknown) => {
      console.warn("Could not update the window icon; keeping its existing icon.", error);
    });
    return () => { cancelled = true; };
  }, [dark]);
}
