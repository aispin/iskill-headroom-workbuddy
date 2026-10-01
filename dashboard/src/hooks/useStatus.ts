import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StatusPayload } from "../types";

export interface StatusState {
  data: StatusPayload | null;
  error: string | null;
  auto: boolean;
  setAuto: (v: boolean) => void;
  refresh: () => Promise<void>;
  updatedAt: number;
  loading: boolean;
}

export function useStatus(intervalMs = 5000): StatusState {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.status();
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [auto, intervalMs, refresh]);

  return { data, error, auto, setAuto, refresh, updatedAt, loading };
}
