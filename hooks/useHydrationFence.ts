"use client";

import { useCallback, useRef } from "react";

export function useHydrationFence() {
  const counterRef = useRef(0);

  const isHydrating = useCallback(() => counterRef.current > 0, []);

  const withHydration = useCallback(async <T>(fn: () => Promise<T> | T) => {
    counterRef.current++;
    try {
      return await fn();
    } finally {
      counterRef.current--;
    }
  }, []);

  return { isHydrating, withHydration };
}
