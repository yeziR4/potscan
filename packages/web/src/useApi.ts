import { useEffect, useState } from "react";
import { getJson, NotFound } from "./api.ts";

export type Loaded<T> = { data?: T; error?: string; notFound?: boolean; loading: boolean };

/** Fetches a path, refetching when it changes and, if given, every interval; keeps the last good data on a failed refresh. */
export function useApi<T>(path: string | undefined, refreshMs?: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ loading: true });

  useEffect(() => {
    if (!path) return;
    let active = true;
    setState({ loading: true });
    const load = () =>
      getJson<T>(path).then(
        data => active && setState({ data, loading: false }),
        (e: Error) => active && setState(s => ({ data: s.data, error: e.message, notFound: e instanceof NotFound, loading: false })),
      );
    void load();
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, refreshMs]);

  return state;
}
