"use client";

import { useCallback, useEffect, useRef } from "react";

export function useEvent<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  return useCallback((...args: TArgs) => ref.current(...args), []);
}
