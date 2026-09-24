# 【AI Agent × Multimodal Research Report】

**時間：2026-09-24 14:53（Asia/Taipei）**  
**本輪主題：MoE Router → Logical Expert → EPLB/Expert Parallel Mapping → Fused Expert Compute → Residual State Lineage**

## 與歷史研究比較

本輪承接上一輪 `EffectiveModelWeightStateWitness`。上一輪已處理 checkpoint、weight conversion、tensor-parallel shard、quantization、LoRA/adapter 與 embedding lookup；本輪刻意不重複 weight provenance，而是回答：**即使 physical weights 正確，token 是否真的被 router 送到正確 logical experts、映射到正確 physical expert replicas/ranks，並以正確 routing weights 合成回 residual stream？**

核心新命題：

`CorrectExpertWeights --does_not_prove→ CorrectExpertRoute`

以及：

`CorrectLogicalExpertRoute --does_not_prove→ CorrectPhysicalExpertExecution`

---

## 本小時新發現

### 新架構：vLLM Fused MoE routing/execution pipeline

current vLLM 已把 MoE routing 抽成 router hierarchy。`FusedMoERouter.select_experts()` 接收 hidden states/router logits，輸出 `(topk_weights, topk_ids)`；base router 在計算 logical routing 後，若 EPLB 啟用會再做 logical→physical mapping，最後才轉換 index dtype。`fused_experts()` 則消費 hidden states、w1/w2、topk weights/ids、expert map與 quant config，進入 fused expert kernels。

因此 runtime architecture 應拆成：

`HiddenState → Router Projection/Logits → Routing Policy → Logical Top-K Expert IDs + Weights → EPLB Mapping → Physical Expert IDs → Token Dispatch → Expert W1 → Activation/SwiGLU → Expert W2 → Weighted Combine → Residual Add`

### 新機制：logical route 與 physical route 必須分開證明

vLLM base router 明確在 EPLB mapping **之前** capture logical IDs；這表示同一 logical expert identity 可以在 runtime 被映射到不同 physical expert placement。這是 provenance 上非常重要的 separation：模型語意層應證明 logical route，execution 層再證明 physical placement。

### 新機制：routing capture 已成為可觀測 primitive

current vLLM 提供 `routed_experts_capturer`，可依 layer 捕捉 `topk_ids`；而 DP/EP/SP 不同 execution topology 會產生不同 routing tensor layout，需要 slice/all-gather 才能重建特定 DP rank 的 token routes。這提供了建立 `MoERoutingWitness` 的實際工程 hook。

### 新架構：router policy 本身不是單一 Top-K

current vLLM router factory包含 standard fused top-k、grouped top-k、bias-corrected top-k、shared routed experts、custom routing、routing simulation、zero-expert等路徑。故 `top_k=2` 並不足以描述 routing semantics；必須 version routing policy、score function、renormalization、grouping、bias correction與 shared-expert policy。

### 新研究：2026 routing研究顯示「選到相似 experts」不等於冗餘

2026 `Beyond Geometric Complementarity: Coherent Overlap in Sparse Mixture-of-Experts Routing` 在六個 MoE architectures 上分析 expert subspaces；研究指出 expert subspace 可高度 overlap，但 actual selected routes仍比 matched alternatives更能解釋 token representation，且多個 frozen-route比較中增加後續 expert仍能改善 next-token prediction。這提醒我們：provenance不能只記 expert ID，還應保留 expert contribution/route weight與 residual delta。

---

## 本小時最重要 5 個發現

### 1. MoE routing 是獨立的 semantic decision boundary

**是什麼：** router logits把每個 token的 hidden state映射成 expert scores，再由 routing policy選出 top-k experts及權重。

**底層如何運作：** 典型路徑是 `h → W_router h → scores → softmax/sigmoid → routing policy/group constraint → top-k IDs → optional renormalization → routing weights`。

**為什麼重要：** base expert weights完全正確時，只要 router logits、bias、grouping或 top-k policy改變，token就會走不同計算圖。

**限制：** 不同模型有不同 router semantics；不能把所有 MoE都抽象成相同 softmax top-k。

**狀態：** 官方工程實作 + 論文結果。

### 2. Logical expert identity 與 physical expert placement 必須分離

**是什麼：** logical expert是模型架構中的 expert；physical expert是某次 deployment 在特定 rank/device上的實體 replica/shard。

**底層如何運作：** `logical_topk_ids → EPLB/expert_map → physical/local expert IDs → dispatch`。

**為什麼重要：** expert load balancing可在不改變 logical model semantics的前提下移動/複製 experts；若 provenance只記 physical rank，重平衡後會誤判；若只記 logical ID，又無法證明真正執行的是正確 replica。

**限制：** physical mapping會受 EP/DP/TP/SP topology與 runtime balancing策略影響。

**狀態：** vLLM source-derived confirmed engineering fact。

### 3. Token dispatch/collective 是 MoE semantics 的一部分

**是什麼：** expert parallel時 token activations必須被 dispatch到持有 expert的 rank，完成 expert compute後再 combine/reduce回 token order。

**底層如何運作：** `token rows → expert assignment → permutation/dispatch → all-to-all or modular kernel → local expert compute → return/weighted combine → restore token order`。

**為什麼重要：** 正確 router IDs若在 dispatch permutation、padding、DP/SP reconstruction或 expert map中錯綁，仍會讓 token吃到另一 expert的輸出。

**限制：** backend可使用不同 kernels/collectives，需 backend-specific witness。

**狀態：** 官方工程實作 + architecture inference。

### 4. Router policy generation 必須進 model-generation identity

**是什麼：** routing policy包括 top-k、score function、renormalize、grouped top-k、correction bias、shared experts與EPLB mapping policy。

**底層如何運作：** 相同 router logits經不同 policy可產生不同 `(ids, weights)`。

**為什麼重要：** `SameRouterLogits --does_not_prove→ SameRoute`。

**限制：** custom routing function可能包含任意 model-specific semantics。

**狀態：** current vLLM router factory confirmed。

### 5. Residual lineage應記 expert contribution，而非只記 route

**是什麼：** 最終 hidden state不是 expert ID，而是 expert outputs按 routing weights組合後，再與 residual path交互作用的 tensor generation。

**底層如何運作：** `expert_i(h) → y_i; y_moe = Σ α_i y_i; h_next = residual + y_moe`（具體 pre/post norm依模型而異）。

**為什麼重要：** route IDs正確仍可能因 routing weights、activation、quantization、combine順序或 collective reduction出錯而產生錯誤 residual state。

**限制：** floating-point reduction ordering可能使 bitwise replay與semantic replay分離。

**狀態：** architecture inference grounded in MoE execution design。

---

## Architecture Breakdown

### System architecture：MoE inference layer

```text
ResidualState[L]
   ↓
Norm
   ↓
Router Projection
   ↓
Router Logits
   ↓
Routing Policy Generation
   ↓
Logical Top-K IDs + Weights
   ↓
EPLB / Expert Map
   ↓
Physical Expert IDs
   ↓
Dispatch / Permute / All-to-All
   ↓
Expert W1 / Gate-Up
   ↓
Activation (e.g. SiLU/SwiGLU)
   ↓
Expert W2 / Down
   ↓
Weighted Combine
   ↓
Return Collective / Restore Token Order
   ↓
Residual Add
   ↓
ResidualState[L+1]
```

### Proposed witness hierarchy

`RouterInputWitness = H(layer, tokenGeneration, hiddenStateGeneration, routerWeightGeneration)`

`RouterLogitsGeneration = H(RouterInputWitness, logitsTensorGeneration)`

`LogicalExpertRouteWitness = H(routerLogits, routingPolicyGeneration, orderedLogicalExpertIds, orderedRoutingWeights)`

`PhysicalExpertBindingWitness = H(logicalExpertId, EPLBGeneration, expertMapGeneration, physicalRank, localExpertId, expertWeightGeneration)`

`ExpertDispatchWitness = H(tokenRowGeneration, logicalRoute, physicalBindings, permutation, collectiveGeneration)`

`ExpertContributionWitness = H(expertBinding, inputActivationGeneration, expertKernelInvocation, outputActivationGeneration, routingWeight)`

`MoELayerResidualWitness = MerkleRoot(inputResidual, normGeneration, logicalRoute, physicalBindings, expertContributions, combineGeneration, outputResidual)`

---

## Bottom-Level Logic

以 token `t` 在 layer `L` 為例：

1. 取得 `h_t^L`。
2. norm產生 `n_t^L`。
3. router projection計算 expert logits `r = W_r n`。
4. routing policy對 `r` 執行 softmax/sigmoid/group constraints/bias correction。
5. 選出 ordered logical expert IDs `E=[e1,...,ek]`。
6. 取得 routing weights `α=[a1,...,ak]`，必要時 renormalize。
7. EPLB/expert map將 logical `ei`轉為 physical/local expert identity。
8. dispatch layer依 expert重排 token rows，跨 EP ranks傳送 activations。
9. 每個 expert執行自己的 W1/gate-up → activation → W2/down。
10. 將 expert output乘上 routing weight。
11. combine各 expert contribution，還原原 token order。
12. 與 residual path合併，得到 `h_t^{L+1}`。
13. 下一層重複；每層 route都可能不同。

最重要的不變式：

`TokenGeneration + LayerGeneration + RouterPolicyGeneration + LogicalRoute + PhysicalBinding + ExpertWeightGeneration + DispatchGeneration + CombineGeneration → ResidualStateGeneration`

任何一項 generation改變，都不應沿用舊 `MoELayerResidualWitness`。

---

## Visual Simulation Idea

### MoE Router → Expert Parallel → Residual Microscope

互動面板：

- 左：tokens與每層 hidden-state generation。
- 中左：router logits bar chart；可切換 softmax/sigmoid、top-k、grouped-top-k。
- 中：logical experts network；edge thickness代表 routing weight。
- 中右：physical GPU/rank map；顯示 EPLB logical→physical mapping。
- 右：expert W1/activation/W2 contribution與 residual合成。
- 下方：每層 `MoELayerResidualWitness` Merkle lineage。

故障注入：

- `ROUTER_BIAS_CHANGED`
- `TOPK_POLICY_CHANGED`
- `LOGICAL_EXPERT_CORRECT_PHYSICAL_REPLICA_WRONG`
- `EPLB_MAPPING_STALE`
- `TOKEN_DISPATCH_PERMUTATION_CORRUPTED`
- `SP_PADDING_ROW_TREATED_AS_REAL_TOKEN`
- `ROUTING_WEIGHT_NOT_RENORMALIZED`
- `EXPERT_QUANT_SCALE_MISMATCH`
- `ALL_TO_ALL_RESULT_REORDERED`
- `RESIDUAL_FROM_WRONG_TOKEN_GENERATION`

---

## Code / GitHub

### vLLM 值得繼續追的核心目錄/檔案

- `vllm/model_executor/layers/fused_moe/router/base_router.py`：logical route、capture、EPLB mapping。
- `vllm/model_executor/layers/fused_moe/router/fused_topk_router.py`：standard top-k routing。
- `vllm/model_executor/layers/fused_moe/router/grouped_topk_router.py`：group-constrained routing。
- `vllm/model_executor/layers/fused_moe/router/router_factory.py`：router policy selection surface。
- `vllm/model_executor/layers/fused_moe/routed_experts_capturer.py`：layer routing observability，含 DP/EP/SP layout reconstruction。
- `vllm/model_executor/layers/fused_moe/fused_moe.py`：`fused_experts` execution boundary。
- `vllm/model_executor/layers/fused_moe/experts/`：modular expert backends、quantization/dispatch。
- 後續應追 `eplb`、all-to-all manager與 expert placement/load-balancing code。

值得特別利用的是 current routing capture：它已能輸出 per-layer top-k IDs，可作為 Hermes `LogicalExpertRouteWitness` 的觀測入口，而不必先修改模型本身。

---

## Papers

### Mixture-of-Experts with Expert Choice Routing
- **Authors:** Yanqi Zhou, Tao Lei, Hanxiao Liu, Nan Du, Yanping Huang, Vincent Zhao, Andrew Dai, Zhifeng Chen, Quoc Le, James Laudon
- **Institution:** Google Research（依作者/論文脈絡；需在後續 bibliographic pass逐作者核驗）
- **Year:** 2022
- **URL:** https://arxiv.org/abs/2202.09368
- **Architecture:** expert-choice routing；experts選tokens而非tokens固定選top-k experts。
- **Contribution:** 固定 expert bucket size，改善load imbalance；論文報告相同資源下 training convergence相對 Switch top-1 / GShard top-2可超過2×。
- **Limitations:** routing semantics與主流token-choice top-k不同，serving runtime需不同 dispatch/provenance模型。

### Beyond Geometric Complementarity: Coherent Overlap in Sparse Mixture-of-Experts Routing
- **Authors:** Huiyuan Tian, Bonan Xu, Shijian Li
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.28308
- **Architecture:** 分析 OLMoE、Mixtral、DeepSeek等 sparse MoE routes。
- **Contribution:** 區分 route coherence、candidate quality、candidate-context interaction；顯示 expert subspace overlap不等於功能冗餘。
- **Limitations:** 是分析研究，不直接定義 production routing correctness protocol。

### S2MoE: Robust Sparse Mixture of Experts via Stochastic Learning
- **Authors:** Giang Do, Hung Le, Truyen Tran
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2503.23007
- **Contribution:** 從 representation collapse與 deterministic top-k相似性問題重新思考 routing/training；報告在其實驗中可降低28% inference cost。
- **Limitations:** 研究重點偏training/robustness，不等同production expert-parallel correctness。

---

## 已確認事實 / 推論 / 假說分界

**已確認官方工程事實：** vLLM router輸出 top-k weights/ids；base router在EPLB mapping前可capture logical IDs；EPLB可把logical IDs映射到physical IDs；fused experts接收 topk weights/ids、expert map與quant config；routing capturer需處理DP/EP/SP不同layout。

**論文結果：** Expert Choice與2026 coherent-overlap研究對routing策略/representation提供實驗證據，但不能直接當作Hermes runtime correctness證明。

**合理工程推論：** logical route witness與physical binding witness應分離；dispatch/collective/permutation必須進 residual lineage。

**尚未驗證假說：** Merkle-based `MoELayerResidualWitness` 能以足夠低overhead在線記錄production inference；需要下一步prototype/benchmark。

---

## Unknown / Open Questions

1. EPLB在expert replica移動/新增/移除時，如何定義不中斷request的 `ExpertPlacementGeneration`，並處理in-flight token？
2. all-to-all / modular MoE kernel中的token permutation如何以低overhead產生可驗證的 dispatch receipt，而不複製完整activation？
3. semantic replay應容許多少floating-point reduction差異？何時route/weight相同但output drift應被視為不同 residual generation？

---

## 下一輪研究

下一輪鎖定：

`MoELayerResidualWitness → Multi-layer Residual Stream → Final RMSNorm → LM Head/Tied Embedding → Logits lineage`，並特別深入 `NCCL/collective ordering + expert-parallel all-to-all + tensor-parallel all-reduce`。

研究問題：**即使每層 logical expert route、physical expert與expert weights全部正確，跨GPU collective的rank membership、token permutation、reduction ordering或partial failure是否仍能讓 residual stream在不明顯報錯下偏離？Hermes如何把 distributed execution topology納入 model semantic witness？**

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RouterWeightGeneration`
- `RouterInputWitness`
- `RouterLogitsGeneration`
- `RoutingPolicyGeneration`
- `LogicalExpertIdentity`
- `LogicalExpertRouteGeneration`
- `LogicalExpertRouteWitness`
- `RoutingWeightGeneration`
- `EPLBGeneration`
- `ExpertPlacementGeneration`
- `PhysicalExpertReplicaGeneration`
- `PhysicalExpertBindingWitness`
- `TokenDispatchGeneration`
- `ExpertParallelCollectiveGeneration`
- `ExpertDispatchWitness`
- `ExpertContributionGeneration`
- `ExpertContributionWitness`
- `MoECombineGeneration`
- `MoELayerResidualGeneration`
- `MoELayerResidualWitness`

### Edges
- `HiddenStateGeneration --produces→ RouterLogitsGeneration`
- `RouterLogitsGeneration --evaluated_by→ RoutingPolicyGeneration`
- `RoutingPolicyGeneration --selects→ LogicalExpertIdentity`
- `LogicalExpertRouteWitness --maps_via→ EPLBGeneration`
- `EPLBGeneration --binds→ PhysicalExpertReplicaGeneration`
- `PhysicalExpertBindingWitness --dispatches_via→ ExpertParallelCollectiveGeneration`
- `ExpertDispatchWitness --executes→ ExpertContributionWitness`
- `RoutingWeightGeneration --weights→ ExpertContributionGeneration`
- `ExpertContributionWitness --combined_by→ MoECombineGeneration`
- `MoECombineGeneration --updates→ MoELayerResidualGeneration`
- `EffectiveModelWeightStateWitness --constrains→ PhysicalExpertBindingWitness`
- `MoELayerResidualWitness --feeds→ NextTransformerLayer`

---

## 本輪結束檢查

- **缺哪一層：** distributed collective execution lineage（NCCL/all-to-all/all-reduce）。
- **哪個節點最淺：** `ExpertParallelCollectiveGeneration`。
- **哪個概念仍只是名詞：** portable low-overhead `ExpertDispatchWitness`。
- **哪個系統值得讀原始碼：** vLLM EPLB + fused MoE modular experts + all-to-all manager；再對照 DeepSpeed/Megatron-Core expert parallel。
- **哪篇論文需追引用：** Expert Choice Routing；2026 coherent-overlap paper則值得追其六個MoE architecture的後續route intervention研究。
- **哪個概念最適合視覺模擬：** `MoE Router → Expert Parallel → Residual Microscope`。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + ModelInvocationWitness + EffectiveModelWeightStateWitness + per-layer MoERoutingWitness + DistributedExecutionWitness + ResidualState lineage`。

最終端到端鏈因此再往下補一層：

`User → UI → Agent → Context → Prompt Compiler → Tokens/Embeddings → Physical Model Weights → Transformer Layer → Router → Logical Experts → Physical Experts/GPUs → Expert Compute → Residual Stream → ... → Logits → Token → Output → Agent Action`
