import { useEffect, useState } from "react";

/** Loads data now and again every interval; keeps the last good value while a refresh fails. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, key: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const run = () =>
      load().then(
        value => active && (setData(value), setError(undefined)),
        (e: Error) => active && setError(e.message),
      );
    void run();
    const timer = setInterval(run, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // load is recreated each render; key decides when to restart.
  }, [key, intervalMs]);

  return { data, error };
}

/** The current time, updated every second, for "x seconds ago" labels. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
