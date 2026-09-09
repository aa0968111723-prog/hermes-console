"use client";
import { useEffect, type RefObject } from "react";
export function useInViewMotion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        element.dataset.inView = String(entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}
