"use client";
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import {
  appendTranscript,
  createSpeechSession,
  speechRecognitionCtor,
  type SpeechSession,
} from "@/lib/client/speech-input";

export default function ComposerVoiceButton({
  disabled,
  isComposing,
  value,
  onChange,
  onReady,
}: {
  disabled?: boolean;
  isComposing: () => boolean;
  value: string;
  onChange: (next: string) => void;
  onReady?: () => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const session = useRef<SpeechSession | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    setSupported(!!speechRecognitionCtor());
    return () => session.current?.stop();
  }, []);
  if (!supported) return null;
  function toggle() {
    if (disabled) return;
    if (listening) {
      session.current?.stop();
      session.current = null;
      setListening(false);
      return;
    }
    if (isComposing()) return;
    const next = createSpeechSession({
      onFinal: (text) => {
        onChange(appendTranscript(valueRef.current, text));
        onReady?.();
      },
      onEnd: () => {
        session.current = null;
        setListening(false);
      },
    });
    if (!next) return;
    session.current = next;
    next.start();
    setListening(true);
  }
  return (
    <button
      type="button"
      className="icon-button composer-voice"
      aria-label={listening ? "停止語音輸入" : "語音輸入"}
      title={listening ? "說完後按送出" : "語音輸入，說完後按送出"}
      aria-pressed={listening}
      disabled={disabled}
      onClick={toggle}
    >
      <Mic size={20} aria-hidden="true" />
    </button>
  );
}
