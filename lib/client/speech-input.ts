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
  resultIndex?: number;
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

export function studentSpeechError(code?: string): string | null {
  if (code === "not-allowed" || code === "service-not-allowed")
    return "無法使用麥克風。請允許這個頁面使用麥克風。";
  if (code === "audio-capture") return "找不到麥克風。";
  if (code === "network") return "語音辨識暫時無法使用。";
  if (code === "no-speech") return "沒聽到語音。請靠近再試一次。";
  return null;
}

export function createSpeechSession(options: {
  lang?: string;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (code?: string) => void;
  ctor?: new () => SpeechRecognitionLike;
}): SpeechSession | null {
  const Ctor = options.ctor || speechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = options.lang || "zh-TW";
  rec.interimResults = false;
  // Android Chrome / zh-TW ends a non-continuous session at the first pause.
  rec.continuous = true;
  let active = false;
  let heard = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    active = false;
    options.onEnd?.();
  };
  const listen = () => {
    try {
      rec.start();
    } catch (error) {
      const name =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: string }).name)
          : "";
      if (name === "InvalidStateError") return;
      options.onError?.(name === "NotAllowedError" ? "not-allowed" : "audio-capture");
      finish();
    }
  };
  rec.onresult = (event) => {
    const results = event.results;
    const start =
      typeof event.resultIndex === "number"
        ? event.resultIndex
        : Math.max(0, results.length - 1);
    for (let i = start; i < results.length; i++) {
      const item = results[i];
      if (!item?.isFinal) continue;
      const text = item[0]?.transcript || "";
      if (text.trim()) {
        heard = true;
        options.onFinal(text);
      }
    }
  };
  rec.onerror = (event) => {
    if (!active || finished) return;
    const code = event?.error;
    if (code === "aborted") return;
    if (code === "no-speech") {
      if (heard) return;
      options.onError?.(code);
      finish();
      return;
    }
    options.onError?.(code);
    finish();
  };
  rec.onend = () => {
    if (finished || !active) {
      finish();
      return;
    }
    if (!heard) {
      finish();
      return;
    }
    listen();
  };
  return {
    start: () => {
      active = true;
      listen();
    },
    stop: () => {
      active = false;
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
  };
}
