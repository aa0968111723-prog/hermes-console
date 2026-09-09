import { loadGraph } from "./catalog";
import type { KnowledgeEntity } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function taipeiDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function claimDates(entity: KnowledgeEntity) {
  const dates = new Set<string>();
  for (const claim of entity.claims) {
    if (!claim.value) continue;
    if (claim.field === "date" && ISO_DATE.test(claim.value)) {
      dates.add(claim.value);
      continue;
    }
    if (claim.field === "dates") {
      for (const part of claim.value.split(/[,，\s]+/)) {
        if (ISO_DATE.test(part)) dates.add(part);
      }
    }
  }
  return [...dates].sort();
}

export function happeningOn(day: string, entities = loadGraph().entities) {
  return entities.filter((entity) => claimDates(entity).includes(day));
}

export function happeningInRange(
  start: string,
  end: string,
  entities = loadGraph().entities,
) {
  return entities.filter((entity) =>
    claimDates(entity).some((day) => day >= start && day <= end),
  );
}

export type RelativeWindow = "today" | "tomorrow" | "week" | null;

export function relativeWindow(query: string): RelativeWindow {
  if (/今天|今日|today/i.test(query)) return "today";
  if (/明天|明日|tomorrow/i.test(query)) return "tomorrow";
  if (/本週|這週|接下來|upcoming/i.test(query)) return "week";
  return null;
}

export function entitiesForWindow(window: RelativeWindow, now = new Date()) {
  const today = taipeiDay(now);
  if (window === "today") return happeningOn(today);
  if (window === "tomorrow") return happeningOn(addDays(today, 1));
  if (window === "week") return happeningInRange(today, addDays(today, 6));
  return [];
}
