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
  let continuous = false;
  class Fake implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = false;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      if (started) return;
      started = true;
      lang = this.lang;
      continuous = this.continuous;
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
  assert.equal(continuous, true);
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
  assert.equal(
    studentSpeechError("no-speech"),
    "沒聽到語音。請靠近再試一次。",
  );
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

test("speech stays continuous across pauses until the session ends", () => {
  let continuous = false;
  let ends = 0;
  const finals: string[] = [];
  class Pause implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = false;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      continuous = this.continuous;
      this.onresult?.({
        results: [{ isFinal: true, 0: { transcript: "我想辦茶會" } }],
      });
      this.onresult?.({
        resultIndex: 1,
        results: [
          { isFinal: true, 0: { transcript: "我想辦茶會" } },
          { isFinal: true, 0: { transcript: "再幫我看場佈" } },
        ],
      });
    }
    stop() {
      this.onend?.();
    }
  }
  const session = createSpeechSession({
    ctor: Pause,
    onFinal: (text) => finals.push(text),
    onEnd: () => {
      ends += 1;
    },
  });
  assert.ok(session);
  session!.start();
  assert.equal(continuous, true);
  assert.deepEqual(finals, ["我想辦茶會", "再幫我看場佈"]);
  assert.equal(ends, 0);
  session!.stop();
  assert.equal(ends, 1);
});

test("speech restarts after a thinking pause instead of ending the goal", () => {
  let starts = 0;
  let ends = 0;
  let denied = "";
  const finals: string[] = [];
  class Hold implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = false;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      starts += 1;
      if (starts === 1) {
        this.onresult?.({
          results: [{ isFinal: true, 0: { transcript: "我想辦茶會" } }],
        });
        this.onerror?.({ error: "no-speech" });
        this.onend?.();
      }
    }
    stop() {
      this.onend?.();
    }
  }
  const session = createSpeechSession({
    ctor: Hold,
    onFinal: (text) => finals.push(text),
    onError: (code) => {
      denied = studentSpeechError(code) || "";
    },
    onEnd: () => {
      ends += 1;
    },
  });
  assert.ok(session);
  session!.start();
  assert.equal(starts, 2);
  assert.deepEqual(finals, ["我想辦茶會"]);
  assert.equal(denied, "");
  assert.equal(ends, 0);
  session!.stop();
  assert.equal(ends, 1);
});

test("speech no-speech maps to student copy", () => {
  class Silent implements SpeechRecognitionLike {
    lang = "";
    interimResults = true;
    continuous = false;
    onresult: ((event: SpeechResultEvent) => void) | null = null;
    onerror: ((event?: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      this.onerror?.({ error: "no-speech" });
    }
    stop() {}
  }
  let denied = "";
  const session = createSpeechSession({
    ctor: Silent,
    onFinal() {},
    onError: (code) => {
      denied = studentSpeechError(code) || "";
    },
  });
  assert.ok(session);
  session!.start();
  assert.equal(denied, "沒聽到語音。請靠近再試一次。");
});
