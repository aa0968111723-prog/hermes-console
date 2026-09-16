import test from "node:test";
import assert from "node:assert/strict";
import {
  continueArtifactPrompt,
  continueDirectionPrompt,
} from "../lib/client/continue-prompts";

test("continue prompts never expose workflow ids or Canva schema", () => {
  const artifact = continueArtifactPrompt();
  const direction = continueDirectionPrompt(1);
  for (const text of [artifact, direction]) {
    assert.doesNotMatch(text, /創作流程/);
    assert.doesNotMatch(text, /wf[_-]/i);
    assert.doesNotMatch(text, /Canva 範本/);
    assert.doesNotMatch(text, /阻塞點/);
    assert.doesNotMatch(text, /workspace_/);
  }
  assert.match(direction, /第 2 個方向/);
});
