import test from "node:test";
import assert from "node:assert/strict";
import {
  appendTranscript,
  createSpeechSession,
  speechRecognitionCtor,
  studentSpeechError,
  type SpeechRecognitionLike,
  type SpeechResultEvent,
} from "../lib/client/speech-input";

test("speech recognition is opt-in and zh-TW", () => {
  assert.equal(speechRecognitionCtor({}), null);
  assert.equal(appendTranscript("", " 幫我找茶會靈感 "), "幫我找茶會靈感");
  assert.equal(appendTranscript("已有", "方向 A"), "已有 方向 A");
  assert.equal(appendTranscript("方向 A", "方向 A"), "方向 A");
  let started = false;
  let lang = "";
  let finals: string[] = [];
  class Fake implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = true;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      started = true;
      lang = this.lang;
      this.onresult?.({
        results: [{ isFinal: true, 0: { transcript: "找靈感" } }],
      });
      this.onend?.();
    }
    stop() {}
  }
  const session = createSpeechSession({
    ctor: Fake,
    onFinal: (text) => finals.push(text),
  });
  assert.ok(session);
  session!.start();
  assert.equal(started, true);
  assert.equal(lang, "zh-TW");
  assert.deepEqual(finals, ["找靈感"]);
  assert.equal(
    speechRecognitionCtor({ webkitSpeechRecognition: Fake }),
    Fake,
  );
  assert.equal(createSpeechSession({ onFinal() {} }), null);
});

test("speech not-allowed maps to student microphone copy", () => {
  assert.equal(
    studentSpeechError("not-allowed"),
    "無法使用麥克風。請允許這個頁面使用麥克風。",
  );
  assert.equal(studentSpeechError("no-speech"), null);
  class Deny implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = true;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      this.onerror?.({ error: "not-allowed" });
      this.onend?.();
    }
    stop() {}
  }
  let denied = "";
  const session = createSpeechSession({
    ctor: Deny,
    onFinal() {},
    onError: (code) => {
      denied = studentSpeechError(code) || "";
    },
  });
  assert.ok(session);
  session!.start();
  assert.equal(denied, "無法使用麥克風。請允許這個頁面使用麥克風。");
});

test("speech start NotAllowedError maps to not-allowed", () => {
  class Blocked implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = true;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      const error = new Error("denied");
      error.name = "NotAllowedError";
      throw error;
    }
    stop() {}
  }
  let denied = "";
  let ended = false;
  const session = createSpeechSession({
    ctor: Blocked,
    onFinal() {},
    onError: (code) => {
      denied = studentSpeechError(code) || "";
    },
    onEnd: () => {
      ended = true;
    },
  });
  assert.ok(session);
  session!.start();
  assert.equal(denied, "無法使用麥克風。請允許這個頁面使用麥克風。");
  assert.equal(ended, true);
});
