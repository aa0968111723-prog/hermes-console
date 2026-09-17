# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 18:52（Asia/Taipei）**  
**主題：Unified Typed Invariant IR × AgentRx 原始碼 × Multimodal Provenance × Perception-to-Action Failure Graph**

## 與歷史研究比較

上一輪已建立 `Raw Runtime Event → Canonical Typed Event → Dependency Graph → Invariant → Causal Diagnosis → Recovery`，並指出最淺節點是 `MultimodalProvenance`。本輪不再重複 AgentChaosBench 的 telemetry normalization，而直接讀 Microsoft AgentRx 原始碼，確認其 IR、Invariant、Violation/Evidence 的實際資料結構，再把 hard runtime invariant 與 multimodal evidence provenance 接到同一張 graph。

## 本小時新發現

### 新架構：雙平面 Unified Typed Invariant IR

```text
Execution Plane
User/Input → Model → Tool/MCP → Observation → Memory → Decision → Action

Evidence Plane
Source → Capture → Transform → Feature/Token → Grounding → Claim → Invariant → Evidence

兩平面以 provenance edge / dependency edge / capability edge 連接。
```

關鍵原則：`event happened` 與 `event is trustworthy` 必須分離。

### 新 GitHub 深讀：Microsoft AgentRx

Repository: https://github.com/microsoft/AgentRx

值得看的核心路徑：
- `agentrx/ir/trajectory_ir.py`：多格式 raw logs → canonical trajectory IR。
- `agentrx/invariants/static_invariant_generator.py`：policy/tool/schema-derived static invariants。
- `agentrx/invariants/dynamic_invariant_generator.py`：per-step context-aware invariants。
- `agentrx/invariants/checker.py`：python/natural-language checks、Violation、Evidence、Telemetry。
- `agentrx/invariants/domain_registry.py`：domain/tool/policy abstraction。
- `agentrx/judge/`：critical failure step / taxonomy judge。

AgentRx pipeline 明確是：

```text
Raw logs
→ Trajectory IR
→ Static Invariants
→ Dynamic Invariants
→ Checker
→ Violation Log
→ Judge
→ Failure Report
```

原始碼確認 `Violation` 至少保存 `task_id / step_index / assertion_name / invariant_type / check_type / severity / check_hint / evidence / taxonomy_targets`；`CheckTelemetry` 另外保存 checker timing、token usage、input/output 與 error。這證明「違反了什麼」和「checker 自己如何執行」可以分離。

### 新多模態研究：LEDGERMIND

**Title:** LEDGERMIND: Provenance-Constrained Multimodal Agentic Reasoning with a Structured Evidence Ledger  
**Authors:** Enjun Du, Hange Zhou, Chenxu Du, Siyi Liu, Zirong Chen, Ziyu Zheng, Yongqi Zhang  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.28374  
**Architecture:** multimodal tool outputs → Structured Evidence Ledger → grounded claims → typed repair transitions  
**Contribution:** 將 multimodal trajectory 建模成 provenance-constrained state machine；下游 claim 只能引用 active evidence，並提出 provenance non-amplification 概念。  
**Limitations:** 目前證據來自特定 multimodal reasoning benchmarks；不等於已解決 real-time video/audio/robot sensor provenance。

### 新 benchmark：PRISM

**Title:** PRISM: Planning and Reasoning with Intent in Simulated Embodied Environments  
**Authors:** Yunn Kang Lim et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.11534  
**Dataset:** 300 human-verified tasks，5 個 photorealistic apartments  
**Architecture:** perception-to-action grounding / implicit intent / long-horizon coordination 三層診斷 + optional perception/memory/planning probes  
**Contribution:** 不再只用 final task success，而能隔離 embodied-agent failure module。  
**Limitations:** simulated household environments；真實 camera/sensor latency、calibration drift、actuator uncertainty 更複雜。

### 新機制：AdaTurn 的 budget provenance

**Title:** AdaTurn: Budget-Aware Test-Time Scaling for Active Visual Perception Agents  
**Authors:** Susan Liang et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.14547  
**Contribution:** 指出 active visual agent 在 turn budget 被截斷時會出現 catastrophic truncation；FA-DAPO 將 budget boundary 變成可訓練 final-decision step。  
**Hermes 意義:** reasoning/action provenance 還必須帶 `remaining_budget`，否則「停止搜尋」可能被誤診為 reasoning failure，其實是 runtime budget constraint。

## 本小時最重要 5 個發現

### 1. Canonical IR 必須先於 invariant engine

**已確認（AgentRx 原始碼）：** `trajectory_ir.py` 支援 JSON、JSONL、markdown conversation 等輸入，先正規化成 `trajectory_id / instruction / steps / substeps(role, content)`，再進後續 invariant pipeline。

**Hermes 建模：**

```text
Provider-specific event
→ Canonical Event
→ Stable Identity
→ Dependency resolution
→ Invariant evaluation
```

不能讓每條 invariant 直接解析 OpenAI/Anthropic/MCP/browser/GPU 各自的 raw payload，否則 invariant 與 provider schema 綁死。

### 2. Hard invariant 與 neural invariant 可以共用 IR，但不能共用證據語義

AgentRx 的 checker 已區分 `python_check` 與 `nl_check`；natural-language rubric 還有 `CLEAR_PASS / CLEAR_FAIL / UNCLEAR`。因此 Hermes 應進一步把證據強度顯式化：

```text
InvariantEvidence {
  invariant_id,
  subject_event_ids,
  verdict: PASS | FAIL | UNKNOWN,
  evidence_kind: DETERMINISTIC | PROTOCOL | STATISTICAL | NEURAL | HUMAN,
  confidence,
  provenance_ids,
  checker_id,
  checker_version
}
```

例如 `RuntimeAppliedRevision >= SnapshotRevision` 可 deterministic check；`action aligned with user intent` 通常只能 neural/semantic check。兩者即使都是 FAIL，也不能宣稱具有相同 certainty。

### 3. Multimodal observation 必須保存「證據血統」，不能只保存文字化 caption

**論文結果：** LEDGERMIND 將 tool evidence 放進 structured ledger，限制 downstream claims 只能引用 active evidence；PRISM 則顯示 perception、intent、long-horizon planning 應分層診斷。

**Hermes Bottom-Level Provenance：**

```text
Camera Frame F1032
→ capture_time=t
→ camera_id=C2
→ calibration=K17
→ crop B4
→ resize/normalize transform T8
→ vision encoder V3
→ visual tokens VT[...]
→ grounding G(object=door, bbox=...)
→ textual claim C("door is open")
→ planner belief B7
→ action A(open/enter)
```

如果最後 action 錯，診斷必須能反查是 frame stale、crop 丟失物件、encoder/grounding 錯、claim hallucination、planner 誤用，還是 actuator failure。

### 4. Provenance non-amplification 可成為 multimodal Agent 的 hard-ish system invariant

Hermes 可定義：

```text
ClaimEvidence(C) ⊆ ReachableActiveEvidence(C)
```

即 agent 不應在 repair/reasoning 中憑空增加 source evidence 沒有提供的 entity、number、spatial relation。語義 entailment 本身仍可能需要 neural checker，但「claim 是否有 provenance edge」可以 deterministic 檢查。

這讓 hallucination 被拆成：

```text
No provenance edge
→ provenance violation

Has provenance edge but source does not support claim
→ grounding/semantic violation
```

### 5. Agent failure diagnosis 必須把 budget/state constraints 也放進 provenance

AdaTurn 顯示 active visual perception 的 rollout budget 會改變合理策略。因此 Event IR 應帶：

```text
turn_index
remaining_turn_budget
latency_budget
cost_budget
tool_budget
context_budget
```

否則系統可能把「budget exhausted 後 forced answer」錯標為 premature termination，或把「繼續搜尋」錯標為合理探索而忽略 cost invariant。

## Architecture Breakdown

### Hermes Unified Typed Event / Evidence IR

```text
TypedEvent {
  event_id
  run_id
  parent_ids[]
  kind
  component
  timestamp
  input_refs[]
  output_refs[]
  capability_refs[]
  provenance_refs[]
  generation/revision?
  budget_state?
}

EvidenceNode {
  evidence_id
  modality: text|image|video|audio|depth|3d|sensor|tool
  source_id
  capture_time
  transform_chain[]
  model/encoder_version?
  spatial_region?
  temporal_range?
  active
}

Invariant {
  invariant_id
  class: semantic|control|tool|security|freshness|distributed|infra|provenance|budget
  checker_type
  scope
  severity
}

InvariantEvidence {
  invariant_id
  event_ids[]
  verdict
  evidence_kind
  confidence
  provenance_ids[]
}
```

### Perception-to-Action Causal Chain

```text
Sensor Source
→ Capture
→ Decode
→ Sampling
→ Preprocess
→ Encoder
→ Token/Feature
→ Cross-modal Fusion
→ Grounding
→ Observation Claim
→ Context Injection
→ Reasoning
→ Planning
→ Tool/Embodied Action
→ Environment Change
→ New Observation
```

每一層都產生自己的 event + provenance node，而不是只留下最終 caption。

## Bottom-Level Logic

### Image path

```text
RGB pixels
→ resize/crop/normalize
→ patchification / vision encoder
→ visual embeddings/tokens
→ projector / multimodal adapter
→ language-model token space
→ attention/fusion
→ grounded representation
→ reasoning token trajectory
→ action/tool selection
```

### Video path

```text
Video stream
→ timestamped frames
→ temporal sampling
→ per-frame/spatiotemporal encoder
→ temporal aggregation/tokens
→ fusion
→ event/object grounding
→ reasoning
```

關鍵 failure：sampling miss、temporal aliasing、stale frame、cross-frame identity loss。

### Audio path

```text
waveform
→ chunk/window
→ spectral/learned frontend
→ audio encoder
→ audio tokens/features
→ temporal alignment
→ multimodal fusion
→ semantic observation
→ reasoning/action
```

關鍵 provenance：sample rate、chunk boundaries、speaker/source identity、timestamp、ASR/transcription version。

## Visual Simulation Idea

### Multimodal Provenance & Causal Failure Microscope

Hermes Console 顯示兩張同步 graph：

```text
Execution Graph                  Evidence Graph
Reasoning R7  ←─────────────── Claim C7
   ↓                              ↑
Plan P8                         Grounding G4
   ↓                              ↑
Action A9                       Visual Tokens
                                  ↑
                               Crop B4
                                  ↑
                               Frame F1032
```

互動注入：
- stale frame
- wrong crop
- frame sampling miss
- grounding bbox drift
- ASR substitution
- stale tool result
- provenance edge missing
- unsupported numeric claim
- budget exhaustion

點擊錯誤 action 後，UI 沿 provenance/dependency edge 反向 highlight `Root Cause → First Violation → Decisive Failure → Symptom`。

## Code / GitHub

### Microsoft AgentRx
https://github.com/microsoft/AgentRx

本輪已讀：
- `agentrx/ir/trajectory_ir.py`
- `agentrx/invariants/checker.py`
- `agentrx/invariants/static_invariant_generator.py`
- `agentrx/invariants/` directory structure

值得下一輪追：
- `dynamic_invariant_generator.py`：dynamic invariant schema 與 step context。
- `judge/`：violation log 如何映射 critical failure step / taxonomy。
- `domain_registry.py`：tool schema/policy 如何被抽象。

## Papers

1. **AgentRx: Diagnosing AI Agent Failures from Execution Trajectories** — Barke et al., Microsoft, 2026. https://arxiv.org/abs/2602.02475 — canonical IR + static/dynamic invariants + checker + judge。
2. **LEDGERMIND: Provenance-Constrained Multimodal Agentic Reasoning with a Structured Evidence Ledger** — Du et al., 2026. https://arxiv.org/abs/2607.28374 — structured evidence ledger、provenance-constrained reasoning。
3. **PRISM: Planning and Reasoning with Intent in Simulated Embodied Environments** — Lim et al., 2026. https://arxiv.org/abs/2605.11534 — perception/reasoning/long-horizon diagnostic benchmark。
4. **AdaTurn: Budget-Aware Test-Time Scaling for Active Visual Perception Agents** — Liang et al., 2026. https://arxiv.org/abs/2607.14547 — budget-conditioned active perception、catastrophic truncation。
5. **Advancing MLLM-based UAV Image Understanding and Reasoning** — Zhang et al., 2026. https://arxiv.org/abs/2608.11738 — UAVQA-Bench + UAV-MAS；指出 domain-toolset mismatch、unchecked error propagation、static reasoning。

## 已確認 / 官方 / 論文 / 推論 / 假說

**已確認工程實作：** AgentRx 先建立 canonical Trajectory IR；checker 有結構化 `Violation` 與 `CheckTelemetry`；static/dynamic/check/judge 為分離 stages。

**論文結果：** LEDGERMIND 主張 structured evidence ledger 與 provenance-constrained repair；PRISM 分層診斷 embodied capabilities；AdaTurn 顯示 rollout budget 本身是 active visual agent failure variable。

**合理工程推論：** Hermes 可用同一 Event IR 容納 model/tool/MCP/runtime/multimodal events，但 invariant evidence 必須保留 deterministic/protocol/neural 等不同證據型態。

**尚未驗證假說：** `ClaimEvidence ⊆ ReachableActiveEvidence` 能否在複雜自然語言 claim 上有效降低 hallucination；graph edge 可 deterministic，但 semantic support 仍需 benchmark。

## Unknown / Open Questions

1. Vision encoder 內部 token/patch attribution 到自然語言 claim 的 provenance，應保存 attention/gradient attribution、grounding box，還是只保存 external detector evidence？
2. Video/audio streaming 中 evidence generation 如何處理 late/out-of-order chunk、clock drift 與跨 modality timestamp alignment？
3. 如何讓 hard invariant checker 不需 LLM、neural invariant checker 可異步執行，又不阻塞 Agent critical path？

## 下一輪研究

鎖定：**Dynamic Invariant × Judge Causal Attribution × Multimodal Timestamp/Alignment × Streaming Provenance**。

```text
AgentRx dynamic_invariant_generator.py
→ per-step invariant generation
→ context window / tool-state dependency
→ checker evidence
→ judge failure attribution

Multimodal
Camera clock / Audio clock / Video PTS
→ timestamp normalization
→ alignment window
→ fusion token
→ grounded claim
→ action
```

並研究 streaming multimodal system 在 `late frame / dropped audio chunk / asynchronous tool observation` 下，如何建立 `TemporalCoverageProof`。

## Knowledge Graph 新增 Node / Edge

**Nodes:** `CanonicalTrajectoryIR`, `TypedEvent`, `EvidenceNode`, `InvariantEvidence`, `EvidenceKind`, `ProvenanceEdge`, `ActiveEvidence`, `TransformChain`, `MultimodalProvenance`, `PerceptionClaim`, `GroundingEvidence`, `TemporalRange`, `BudgetState`, `ProvenanceNonAmplification`, `TemporalCoverageProof`, `CheckerVersion`。

**Edges:**
- `RawProviderEvent → normalized_into → TypedEvent`
- `EvidenceNode → transformed_by → TransformChain`
- `PerceptionClaim → supported_by → EvidenceNode`
- `Invariant → evaluated_as → InvariantEvidence`
- `InvariantEvidence → cites → ProvenanceEdge`
- `BudgetState → constrains → AgentAction`
- `MultimodalProvenance → enables → CausalFailureLocalization`
- `MissingProvenance → weakens → ClaimTrust`
- `TemporalCoverageProof → required_by → StreamingObservationFreshness`

## 本輪結束判斷

- **缺哪一層：** streaming multimodal timestamp/alignment → fusion → claim 的 Temporal Coverage。
- **哪個節點最淺：** `TemporalCoverageProof`。
- **哪個概念仍只是名詞：** vision-token-to-claim 的 fine-grained `ProvenanceEdge`，尚無足夠可靠 attribution mechanism。
- **哪個系統值得讀原始碼：** Microsoft AgentRx 的 `dynamic_invariant_generator.py` 與 `judge/`。
- **哪篇論文需追引用：** LEDGERMIND，因其 provenance non-amplification 最接近 Hermes Evidence Graph。
- **哪個概念最適合視覺模擬：** Multimodal Provenance & Causal Failure Microscope。
- **哪個 Agent 架構最值得實作：** `Typed Event IR + dual Evidence Graph + deterministic hard invariants + asynchronous neural invariants + causal recovery`。

## 還原「AI 到底怎麼運作」新增段落

```text
Camera / Image / Voice / Video
→ Capture + Timestamp + Source Identity
→ Preprocess / Sampling
→ Encoder
→ Multimodal Tokens / Features
→ Fusion
→ Grounding
→ Evidence-backed Observation Claim
→ Context
→ Model Reasoning
→ Planner
→ Agent Action
→ Tool / MCP / Environment

parallel:
每一步
→ Typed Event
→ Provenance
→ Invariant
→ Evidence
→ Trust / Freshness / Causal Diagnosis
```

本輪核心結論：**多模態 Agent 的 observation 不能只是一段「模型看到了什麼」的文字。真正可診斷的 AI Runtime 必須保存 observation 從哪個 sensor/frame/chunk 而來、經過哪些 transform/encoder/grounding、最後支撐了哪個 claim 與 action；否則 perception error 一進入文字 context，就會被誤認成 reasoning error。**