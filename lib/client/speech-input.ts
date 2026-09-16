export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export type SpeechResultEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function speechRecognitionCtor(
  globalObj: SpeechWindow = globalThis as SpeechWindow,
) {
  return globalObj.SpeechRecognition || globalObj.webkitSpeechRecognition || null;
}

export function appendTranscript(current: string, incoming: string) {
  const next = incoming.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.replace(/\s+$/g, "");
  if (!base) return next;
  if (base.endsWith(next)) return base;
  return `${base} ${next}`;
}

export type SpeechSession = {
  start: () => void;
  stop: () => void;
};

export function createSpeechSession(options: {
  lang?: string;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  ctor?: new () => SpeechRecognitionLike;
}): SpeechSession | null {
  const Ctor = options.ctor || speechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = options.lang || "zh-TW";
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (!last?.isFinal) return;
    const text = last[0]?.transcript || "";
    if (text.trim()) options.onFinal(text);
  };
  rec.onerror = () => options.onEnd?.();
  rec.onend = () => options.onEnd?.();
  return {
    start: () => rec.start(),
    stop: () => rec.stop(),
  };
}
