import test from "node:test";
import assert from "node:assert/strict";
import { copy } from "../lib/silly-copy";

test("SillyWorld copy is local and greeting is a widening string", () => {
  assert.equal(copy.appTitle, "傻的創作小天地");
  assert.deepEqual(Object.values(copy.orbLabels), ["水", "光", "火", "森"]);
  const greetings: string[] = [
    copy.greeting,
    copy.greetingAck,
    "突然出現一顆會說話的元素球！",
  ];
  assert.equal(greetings.length, 3);
  assert.match(copy.greetingAck, /收到/);
});
