# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 12:53（Asia/Taipei）**  
**本輪主題：Structured Agent Action Propensity × Semantic Action Abstraction × Hierarchical Off-Policy Evaluation × Tool-Call Trajectory Support**

---

## 0. 與歷史研究的差異

上一輪已建立：用舊 policy 的 logged data 評估未部署的新 policy，不能只做普通 covariate reweighting；必須處理 behavior propensity、target policy、selective labels、action support、label support 與 hidden confounding。

本輪不再重複「off-policy calibration 怎麼做」，而是往下一層追：

> **對 LLM Agent 而言，action 到底是什麼？Exact tool call、JSON arguments、token sequence、browser sub-actions、retry 與多步 trajectory 都可能不同；在這種巨大甚至近乎無限的 action space 中，propensity 應該在哪一層定義，才既有 support，又不會把因果上不同的行為錯誤合併？**

核心問題：

```text
User / Environment State x
↓
LLM policy
↓
Intent
↓
Tool family
↓
Tool name / schema
↓
Arguments / natural-language tokens
↓
Execution strategy
↓
Retry / fallback / browser sub-actions
↓
Trajectory τ
↓
Outcome Y
```

若把整條 `τ` 當 exact action，behavior propensity 往往極小、target/behavior ratio 易爆炸；若過度壓縮成「都是搜尋」或「都是驗證」，又可能把 reward-relevant 差異消掉。

因此本輪聚焦在 **Action Abstraction Contract**：在哪一層合併 action、何時可 marginalize propensity、何時只能保留 exact / hierarchical correction。

---

# 一、本小時新發現

## 新論文 / 新架構 / 新 GitHub

### 1. Rethinking Importance Sampling in LLM Policy Optimization: A Cumulative Token Perspective
- **Authors:** Yuheng Zhang, Chenlu Ye, Shuowei Jin, Changlong Yu, Wei Xiong, Saurabh Sahu, Nan Jiang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.07331
- **Code:** https://github.com/horizon-llm/CTPO （論文頁標示）
- **Architecture:** autoregressive token policy → per-token target/behavior ratio → cumulative-prefix importance ratio → position-adaptive clipping
- **Contribution:** 明確拆開 token-level ratio、full-sequence ratio 與 cumulative-prefix ratio；指出 token-level correction忽略 prefix state-distribution mismatch，full-sequence correction雖精確但乘法累積造成高變異，cumulative token ratio則對每個 token-level gradient term提供 prefix correction。
- **Limitations:** 主要是 LLM policy optimization / gradient correction，不等於 production Agent OPE；tool execution、external state transition、selective labels 與 semantic action abstraction仍需額外建模。
- **改變了什麼：** 支持「LLM action propensity 不能只看最後一個 tool token」；prefix/history 是 action probability 的一部分。

### 2. POTEC: Off-Policy Contextual Bandits for Large Action Spaces via Policy Decomposition
- **Authors:** Yuta Saito, Jihan Yao, Thorsten Joachims
- **Institution:** University of Washington / Cornell University（作者頁與 paper metadata）
- **Year:** 2025, ICLR
- **URL:** https://proceedings.iclr.cc/paper_files/paper/2025/hash/90e06fe49254204248cb12562528b952-Abstract-Conference.html
- **Architecture:** large action space → action clusters → first-stage cluster policy → second-stage within-cluster action policy
- **Contribution:** 將巨大 action-space policy 拆成 cluster selection 與 intra-cluster selection；第一階段用 low-variance policy-gradient estimator，第二階段用 regression-based policy；在 local correctness 條件下取得理論保證。
- **Limitations:** action cluster 的語義 / 因果品質決定 estimator 的可靠性；contextual bandit setting 不直接等同 long-horizon Agent trajectory。
- **改變了什麼：** 對 Hermes 最重要的是「propensity 可以分層，但每層保證不同」，不能只儲存一個 flat `π(a|x)`。

### 3. Off-Policy Evaluation of Slate Bandit Policies via Optimizing Abstraction (LIPS)
- **Authors:** Haruka Kiyohara, Masahiro Nomura, Yuta Saito
- **Institution:** Cornell University / CyberAgent, Inc.（paper metadata）
- **Year:** 2024, The Web Conference
- **URL:** https://arxiv.org/abs/2402.02171
- **Code:** https://github.com/aiueola/webconf2024-slate-ope-via-abstraction
- **Datasets:** semi-synthetic experiments based on Eurlex-4K, Wiki10-31K, Delicious (repository instructions)
- **Architecture:** high-dimensional slate action → learned latent abstraction → abstraction-level propensity → Latent IPS
- **Contribution:** 直接學習低維 slate abstraction，並讓 abstraction granularity面向 OPE bias/variance trade-off最佳化，而不是人工指定 abstraction。
- **Limitations:** abstraction learning依賴 training objective與資料支援；壓縮 action可能丟失 reward-relevant direct effect；實驗 setting仍遠小於 arbitrary LLM/browser trajectory。
- **改變了什麼：** action abstraction不是純 UI taxonomy；它本身是 statistical estimator 的一部分。

### 4. Off-Policy Evaluation for Large Action Spaces via Embeddings (MIPS)
- **Authors:** Yuta Saito, Thorsten Joachims
- **Year:** 2022, ICML
- **URL:** https://proceedings.mlr.press/v162/saito22a.html
- **Code:** https://github.com/usaito/icml2022-mips
- **Architecture:** action `a` → embedding `e` → marginalized propensity `p(e|x)` → MIPS
- **Contribution:** 避免在極大量 exact actions 上直接做 IPS，改在 action embedding 空間 marginalize importance weights，大幅降低變異。
- **Limitations:** estimator 的 unbiasedness 依賴 embedding 足以承接 action 對 reward 的效果（no-direct-effect 類條件）；「embedding 很像」不等於可安全合併。
- **改變了什麼：** 對 Agent OPE 提供重要基礎：可用 semantic/structural action representation改善 support，但必須認真驗證 abstraction validity。

### 5. Context-Action Embedding Learning for Off-Policy Evaluation in Contextual Bandits (CAEL-MIPS)
- **Authors:** Kushagra Chandak, Vincent Liu, Haanvid Lee
- **Institution:** University of Alberta / RBC Borealis（paper index metadata）
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2509.00648
- **Dataset:** synthetic + Open Bandit Dataset
- **Architecture:** `(context, action)` → learned context-aware embedding → MIPS estimator objective
- **Contribution:** 不再把 action embedding視為固定 domain feature，而是直接以 OPE MSE 的 bias/variance trade-off學 embedding。
- **Limitations:** learned embedding仍可能把因果不同但 prediction/estimation方便的 action合併；需要額外 certificate 才能用於高風險 policy transport。
- **改變了什麼：** Hermes 的 `ActionAbstraction` 未來應該是 context-conditioned，而不是只按 tool name建立靜態 taxonomy。

### 補充：ARIA — Training Language Agents with Intention-Driven Reward Aggregation
- **Authors:** Ruihan Yang et al.
- **Institution:** Fudan University / ByteDance Seed（公開 paper metadata）
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2506.00539
- **Architecture:** free-form language action → low-dimensional intention space → semantically similar actions share aggregated reward
- **Contribution:** language action space雖以 token sequence呈現，但策略層可能存在較緊湊的 intention latent space；透過 intention-aware reward aggregation降低 policy-gradient variance。
- **Limitations:** reward aggregation / training improvement不等於 OPE identification；intention cluster不能直接被視為「同一 counterfactual action」。

---

# 二、本小時最重要 5 個發現

## 發現 1：Agent 的 exact propensity 必須先定義 action boundary

對普通 contextual bandit：

```text
x → a → r
```

propensity 是：

```text
π(a | x)
```

但 Tool Agent 的一次「動作」可能是：

```text
Intent
→ choose tool
→ emit JSON
→ tool executes
→ inspect observation
→ retry
→ fallback tool
```

如果 action 定義成完整 tokenized tool-call sequence：

```text
a = (y1, y2, ..., yL)
```

autoregressive policy 的 sequence propensity 可寫成：

```text
π(a | h0)
=
∏_{t=1..L} π(yt | h_{t-1})
```

而 target vs behavior full-sequence ratio是：

```text
w(a)
=
∏_t
π_e(yt | h_{t-1})
───────────────
π_b(yt | h_{t-1})
```

2026 CTPO 研究再次顯示：這類 multiplicative correction 很快遇到高變異；只使用局部 token ratio又會漏掉 prefix state-distribution mismatch。

因此 Hermes 的 `LoggedActionRecord` 不能只存：

```text
tool = search
```

至少應能保存：

```text
StructuredActionRecord
├ context_hash
├ policy_version
├ decoding_config
├ intent
├ tool_family
├ tool_name
├ schema_version
├ normalized_arguments
├ raw_arguments
├ token_trace_hash
├ token_logprob_available
├ execution_subactions[]
├ retries[]
├ fallback_path[]
├ observation_ids[]
└ terminal_outcome_id
```

### 已確認事實
Autoregressive LLM sequence probability由 conditional token probabilities相乘；off-policy LLM work已明確分析 token / cumulative-prefix / full-sequence ratio的不同性質。

### 合理工程推論
Production API不一定暴露完整 tool-call token logprob，因此實務上的 propensity可能是「可計算」「可重建」「只能模型估計」「不可識別」四種不同狀態，必須寫進 certificate，不能假裝都有 exact propensity。

核心 edge：

```text
Tool Call Observed
≠
Logging Propensity Known
```

---

## 發現 2：Exact action propensity 在 LLM Agent 幾乎天然遇到 support explosion

假設 browser agent 的 action是：

```text
Tool = click
Arguments = {selector: "#checkout > div:nth-child(3) ..."}
```

另一個 policy產生：

```text
Tool = click
Arguments = {x: 815, y: 421}
```

兩者可能造成同一 UI effect，但 exact JSON不同。

如果用 exact matching：

```text
π_b(a_exact | x) ≈ 0
```

則：

```text
π_e(a_exact | x)
───────────────
π_b(a_exact | x)
```

會巨大甚至 support failure。

大型 action-space OPE 的 MIPS、OffCEM/POTEC、LIPS 都在不同形式下證明一件事：

> **當 action space 太大時，必須利用 action structure / embedding / cluster / factorization，而不是期待 flat IPS 自己撐住。**

但結論不是「直接用 embedding cosine 就好」。

Hermes 應建立 action hierarchy：

```text
Level 0  Outcome-equivalent effect
Level 1  Intent
Level 2  Tool family
Level 3  Tool/schema
Level 4  Semantic arguments
Level 5  Exact arguments
Level 6  Token sequence
Level 7  Multi-step execution trajectory
```

然後逐 certificate 選擇 estimator level。

例如：

```text
Claim:
「新 policy 是否更常完成網頁搜尋？」
→ tool-family / intent abstraction可能足夠

Claim:
「新 policy 是否會把付款金額改錯？」
→ amount argument不可被 abstraction丟掉
```

核心 edge：

```text
Higher Action Overlap
≠
Valid Counterfactual Abstraction
```

---

## 發現 3：Bottom-Level Mechanism = Marginalized Propensity over Action Abstraction

令：

```text
A = exact action
Z = abstraction / semantic action
q(z | x,a) = abstraction encoder
```

則 behavior policy在 abstraction上的 marginal propensity：

```text
p_b(z | x)
=
Σ_a π_b(a|x) q(z|x,a)
```

Evaluation policy：

```text
p_e(z | x)
=
Σ_a π_e(a|x) q(z|x,a)
```

Abstraction importance weight：

```text
w_Z(x,z)
=
p_e(z|x) / p_b(z|x)
```

這就是 MIPS/LIPS 類想法可轉入 Agent runtime 的核心。

LIPS 官方程式甚至不是抽象公式而已。`LatentRepresentationLearning.predict()` 會：

```text
observed slate
↓
encoder → latent abstraction z
↓
sample actions from behavior policy
↓
encoder.calc_latent_prob(..., z)
↓
approximate p_b(z|x)

sample actions from evaluation policy
↓
encoder.calc_latent_prob(..., z)
↓
approximate p_e(z|x)

abstraction_iw
=
p_e(z|x) / (p_b(z|x)+1e-10)
```

其 estimator 再使用：

```text
V_LIPS
≈ mean(abstraction_iw × reward)
```

這對 Hermes 非常重要：**semantic action propensity應該是 exact-policy probability經 abstraction map marginalize之後得到，而不是把 embedding similarity數值直接當 propensity。**

---

## 發現 4：Action abstraction 本身需要「因果／估計有效性 certificate」

MIPS 類 estimator 的低 variance來自把很多 exact actions合併到同一 embedding / abstraction。

但若：

```text
A1 = search(query="cheap flights")
A2 = search(query="delete account")
```

只是因語言 embedding接近而被壓成同一 `SEARCH` cluster，對 reward / safety可能完全不同。

因此要區分：

```text
Semantic Similarity
≠
Reward Sufficiency
≠
Counterfactual Equivalence
```

對不同 estimator，所需條件不同：

```text
MIPS-style
→ embedding需足以承接 action對reward的重要效果

OffCEM / POTEC-style
→ cluster內 reward model需滿足 local correctness 類條件

LIPS-style
→ abstraction granularity直接決定 bias/variance trade-off
```

Hermes 應新增：

```text
ActionAbstractionCertificate
├ abstraction_id
├ encoder_version
├ context_conditioning
├ action_levels_merged[]
├ preserved_fields[]
├ forbidden_fields_to_drop[]
├ reward_sufficiency_test
├ local_correctness_test
├ direct_effect_test
├ support_gain
├ effective_sample_size_gain
├ estimated_bias
├ estimated_variance
├ downstream_claims[]
└ validity_scope
```

對 tool calls，`forbidden_fields_to_drop` 特別重要，例如：

```text
money amount
recipient
file path
permission scope
HTTP method
MCP server identity
side-effect flag
```

這些欄位不能為了增加 overlap 而被 semantic embedding吞掉。

---

## 發現 5：最適合 Agent 的不是單一 abstraction，而是 Hierarchical Propensity Graph

POTEC 的兩階段 policy decomposition提供直接啟示：大型 action space不一定要先壓成一個 flat embedding；可以明確分層。

對 Hermes：

```text
π(a|x)
=
π(intent|x)
× π(tool_family|intent,x)
× π(tool|tool_family,intent,x)
× π(arg_semantics|tool,x)
× π(exact_args|arg_semantics,tool,x)
× π(exec_strategy|...)
```

注意：這是 **若 policy architecture / logging mechanism允許該 factorization時** 的建模方式，不是任何 Agent都天然可精確分解。

因此新增：

```text
HierarchicalAgentPropensity
├ intent_propensity
├ tool_family_propensity
├ tool_propensity
├ argument_semantic_propensity
├ exact_argument_propensity
├ execution_strategy_propensity
├ token_prefix_propensity
├ factorization_assumptions[]
└ unavailable_components[]
```

Evaluator不一定要每次使用最底層 exact ratio，而可以按 target claim選擇：

```text
Claim-level estimator router
├ intent-level IPS
├ cluster-level MIPS / OffCEM
├ structured-slate LIPS
├ exact-action DR
├ trajectory-level IS
└ BLOCK: insufficient support
```

這樣能把「action representation」真正接到 Permission Gate，而不是只做 embedding visualization。

---

# 三、Architecture Breakdown

## Structured Agent Action × Hierarchical OPE Runtime

```text
UI / Voice / Camera / Browser / MCP / Tool
↓
Agent State / Context Snapshot
↓
Policy Decision
↓
Structured Action Ledger
├ intent
├ tool family
├ tool/schema
├ arguments
├ token trace
├ execution sub-actions
├ retry/fallback
└ outcome
↓
Propensity Provenance Layer
├ exact logprob available?
├ model-replay estimate?
├ behavior policy checkpoint?
├ decoding config?
└ unknown propensity?
↓
Action Abstraction Graph
├ intention
├ tool family
├ schema
├ semantic args
├ exact args
└ trajectory pattern
↓
ActionAbstractionCertificate
↓
Hierarchical Propensity Builder
↓
Support / ESS Auditor
↓
Estimator Router
├ exact IPS / DR
├ MIPS
├ LIPS
├ OffCEM-style cluster correction
├ trajectory IS
└ partial / blocked
↓
Counterfactual Calibration / OPE
↓
Policy-Safe Evidence Certificate
↓
Permission Gate
```

### Runtime 最重要的設計原則

```text
Action Abstraction
不是 preprocess-only feature
```

它會改變：

```text
propensity
support
importance weights
bias
variance
estimand
counterfactual interpretation
```

所以 abstraction schema變更應該像 model / encoder更新一樣，有 version、dependency graph與 certificate migration。

---

# 四、Bottom-Level Logic

## 4.1 Exact autoregressive propensity

```text
A = y_1:L
π(A|h0) = Π_t π(y_t|h_{t-1})
```

Target / behavior ratio：

```text
W_L
=
Π_t [π_e(y_t|h_{t-1}) / π_b(y_t|h_{t-1})]
```

問題：
- 長 sequence乘積變異爆炸。
- behavior/target tokenizer、tool serialization、schema formatting不同時，exact token support更差。
- external observation插入後，history本身是 policy-dependent state。

## 4.2 Prefix cumulative ratio

```text
W_t
=
Π_{j≤t}
π_e(y_j|h_{j-1}) / π_b(y_j|h_{j-1})
```

CTPO 類工作顯示 cumulative prefix correction可在 token-level objective中比 full-sequence ratio更具 variance優勢；但 Hermes要注意：這不自動解決 external tool dynamics的 trajectory-OPE。

## 4.3 Semantic / latent marginalized propensity

```text
A --q(z|x,A)--> Z

p_b(z|x)=Σ_a π_b(a|x)q(z|x,a)
p_e(z|x)=Σ_a π_e(a|x)q(z|x,a)

w_z=p_e(z|x)/p_b(z|x)
```

這是最有希望處理：

```text
free-form query strings
JSON argument variants
browser selectors
semantically equivalent natural-language actions
```

但必須用 certificate控制 abstraction bias。

## 4.4 Hierarchical propensity

若 action生成機制顯式分層：

```text
A=(I,T,S,G,E)
```

則可能：

```text
π(A|x)
=
π(I|x)
π(T|I,x)
π(S|T,I,x)
π(G|S,T,I,x)
π(E|G,S,T,I,x)
```

此架構可以針對特定 claim只 correction到某一層，但前提是下游 reward / estimand與被 marginalize的層之間條件成立。

---

# 五、Visual Simulation Idea

## **Agent Action Abstraction × Propensity Explosion Lab**

畫面左側顯示一條真實 tool trajectory：

```text
Intent: find information
↓
Tool: browser.search
↓
Args:
"best agent OPE papers 2026"
↓
Open result
↓
Retry query
↓
Read paper
```

中間讓使用者拖動 `Action Resolution`：

```text
[ Intent ]
[ Tool Family ]
[ Tool ]
[ Semantic Args ]
[ Exact Args ]
[ Token Sequence ]
[ Full Trajectory ]
```

右側即時計算：

```text
Abstraction Level     Overlap    ESS    Max Weight   Est. Bias
Intent                0.98       910      1.8         HIGH
Tool Family           0.92       780      2.9         MED
Tool                  0.84       601      4.7         LOW-MED
Semantic Args         0.61       302     12.1         LOW
Exact Args            0.19        44    131.0         VERY LOW
Full Token Sequence   0.03         7   9842.0         UNKNOWN
```

再顯示一個 safety-sensitive field：

```text
transfer(amount=100, recipient=A)
transfer(amount=10000, recipient=B)
```

如果 abstraction錯誤把它們都壓成：

```text
TRANSFER_MONEY
```

畫面立刻顯示：

```text
⚠ ABSTRACTION INVALID

Forbidden fields dropped:
- amount
- recipient

Support improved:
YES

Counterfactual validity:
FAIL
```

最重要的教學訊息：

> **Overlap 越高不代表 estimator 越正確；action abstraction 是 bias–variance–causal-validity 三者的取捨。**

---

# 六、Code / GitHub

## 深讀：`aiueola/webconf2024-slate-ope-via-abstraction`

值得讀的結構：

```text
src/
├ estimators.py
├ learners.py
├ meta.py
├ models.py
└ utils.py

real/
├ main_ips.py
├ main_dr.py
└ visualize.py
```

### `src/estimators.py`

包含一般 IPS：

```python
iw = (evaluation_policy_prob_for_chosen_action / pscore).prod(axis=1)
return iw * reward
```

也包含 LIPS：

```python
return abstraction_iw * reward
```

這個對比很重要：前者在完整 slate slot propensity上相乘，後者直接把 correction搬到 learned abstraction probability ratio。

### `src/learners.py`

`LatentRepresentationLearning` 同時建立：

```text
encoder
+ decoder
+ abstraction reward predictor
```

training objective同時牽涉：

```text
reward prediction loss
+ reconstruction objective
+ KL / abstraction regularization
```

其中 `beta` 控制 abstraction granularity / bias-variance trade-off。

`predict()` 則對 behavior與evaluation policy各自 Monte Carlo抽樣 slates，再透過 encoder計算 observed latent abstraction出現機率，最後：

```python
abstraction_iw = evaluation_abstraction_prob / (
    behavior_abstraction_prob + 1e-10
)
```

### 對 Hermes 可直接借用的工程概念

不是直接複製 LIPS estimator，而是抽出：

```text
PolicySampler
↓
ActionAbstractionEncoder
↓
AbstractionProbabilityEstimator
↓
ImportanceWeight
↓
Estimator
```

並替換 slate action為：

```text
Tool Call / Browser Action / MCP Action / Agent Trajectory
```

---

# 七、Papers

## 優先閱讀順序

### P0 — 需要先讀
1. **POTEC: Off-Policy Contextual Bandits for Large Action Spaces via Policy Decomposition** — Saito, Yao, Joachims — ICLR 2025  
   https://proceedings.iclr.cc/paper_files/paper/2025/hash/90e06fe49254204248cb12562528b952-Abstract-Conference.html

2. **Off-Policy Evaluation of Slate Bandit Policies via Optimizing Abstraction** — Kiyohara, Nomura, Saito — WWW 2024  
   https://arxiv.org/abs/2402.02171

3. **Rethinking Importance Sampling in LLM Policy Optimization: A Cumulative Token Perspective** — Zhang et al. — 2026  
   https://arxiv.org/abs/2605.07331

### P1 — 接著追
4. **Off-Policy Evaluation for Large Action Spaces via Embeddings** — Saito, Joachims — ICML 2022  
   https://proceedings.mlr.press/v162/saito22a.html

5. **Context-Action Embedding Learning for Off-Policy Evaluation in Contextual Bandits** — Chandak, Liu, Lee — 2025  
   https://arxiv.org/abs/2509.00648

6. **Effective Off-Policy Evaluation and Learning in Contextual Combinatorial Bandits** — Shimizu et al. — RecSys 2024  
   https://arxiv.org/abs/2408.11202

7. **ARIA: Training Language Agents with Intention-Driven Reward Aggregation** — Yang et al. — 2025  
   https://arxiv.org/abs/2506.00539

---

# 八、Unknown / Open Questions

## Open Question 1 — Tool-call propensity到底能不能被可靠重建？

若 production logs只保存：

```text
tool_name
arguments
```

但沒保存：

```text
behavior model checkpoint
prompt/context snapshot
decoding parameters
tool schema version
token log probabilities
```

則 exact propensity通常不可重建。

需要研究：

```text
Propensity status
├ EXACT_LOGGED
├ REPLAYABLE
├ MODEL_ESTIMATED
├ BOUNDED_ONLY
└ UNIDENTIFIED
```

不同狀態可允許哪些 estimator？

## Open Question 2 — Semantic action equivalence如何驗證？

LLM embedding或intent classifier可以說：

```text
A1 ≈ A2
```

但 OPE真正需要的是類似：

```text
A1 與 A2
對目標 outcome / estimand 的 direct effect差異
在指定 scope內足夠小
```

這需要 causal / outcome-sensitive abstraction test，而不是 embedding-only clustering。

## Open Question 3 — Long-horizon trajectory要在哪一層抽象？

可以抽象：

```text
single tool call
macro action
option
subgoal
trajectory segment
entire workflow
```

粒度越高：support越差；粒度越低：Markov / reward sufficiency越可能失效。

這是下一輪最值得深入的問題。

---

# 九、Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Structured Agent Action
StructuredActionRecord
Action Boundary
Exact Action Propensity
Token Sequence Propensity
Prefix Cumulative Propensity
Hierarchical Agent Propensity
Tool Family Propensity
Schema Propensity
Argument Propensity
Execution Strategy Propensity
Action Abstraction Graph
Semantic Action Abstraction
Context-Conditioned Action Embedding
ActionAbstractionCertificate
Abstraction Support Gain
Abstraction Bias
Reward Sufficiency
Local Correctness
Forbidden-to-Drop Action Field
Marginalized Action Propensity
Abstraction Importance Weight
Propensity Provenance
Propensity Identifiability Status
Trajectory Action Support
Macro Action
Intention Space
```

## 新增 Edges

```text
Tool Call Observed
≠ Logging Propensity Known

Exact Action Match
→ Often Causes Support Collapse

Semantic Similarity
≠ Counterfactual Equivalence

Higher Action Overlap
≠ Valid Counterfactual Abstraction

Action Embedding
→ Can Improve Effective Support

Action Embedding
→ Can Introduce Abstraction Bias

Marginalized Propensity
= Exact Policy Probability Marginalized Through Abstraction

Action Abstraction Version Change
→ May Invalidate OPE Certificate

Dropped Reward-Relevant Argument
→ Invalidates Abstraction Certificate

Hierarchical Policy Factorization
→ Enables Level-Specific Propensity

Token-Level Ratio
≠ Prefix Distribution Correction

Full-Sequence Ratio
→ High Variance Under Long Sequences
```

---

# 十、下一輪研究

下一輪應進入：

# **Macro-Actions / Options × Semi-Markov Agent OPE × Trajectory Segmentation × Hierarchical Credit Assignment**

因為本輪已經知道 flat exact action不適合 Agent，但真正的 Agent不是一次 tool call就結束，而是：

```text
Search
→ Open
→ Read
→ Compare
→ Verify
→ Summarize
```

可能應該被視為一個 macro-action / option。

下一輪核心問題：

```text
Raw tool trajectory
↓
Segment into options / subgoals
↓
Initiation condition
↓
Internal policy
↓
Termination condition
↓
Semi-Markov transition
↓
Option-level propensity
↓
Option-level OPE / DR
↓
Credit assignment
↓
Policy certificate
```

並要回答：
- option boundary怎麼自動發現？
- termination是 policy-dependent時 propensity怎麼算？
- tool retry / fallback算同一 option還是新 action？
- option abstraction怎麼驗證 Markov sufficiency？
- semantic subgoal相同但執行工具不同，是否可共享 counterfactual evidence？

---

# 十一、本輪結束判定

**缺哪一層：** `Structured Action Logging + Propensity Provenance Layer`。目前 Hermes若沒有完整 behavior policy/context/schema/decoding provenance，就無法對 tool call做可信 exact propensity reconstruction。

**哪個節點最淺：** `PropensityIdentifiabilityStatus`、`ActionAbstractionCertificate`、`HierarchicalAgentPropensity`。

**哪個概念仍只是名詞：** production 級 `Semantic Counterfactual Action Equivalence`；目前 embedding / intention clustering很多，但能直接授權 OPE marginalization的通用 certificate仍不存在。

**哪個系統值得讀原始碼：** `aiueola/webconf2024-slate-ope-via-abstraction`，優先順序 `src/learners.py → src/estimators.py → src/models.py → src/meta.py`。

**哪篇論文需追引用：** 首先追 `POTEC` 與 `LIPS` 的後續 citation；對 LLM token policy correction則追 2026 `CTPO`。

**哪個概念最適合視覺模擬：** `Agent Action Abstraction × Propensity Explosion Lab`。

**哪個 Agent 架構最值得實作：**

```text
Structured Action Ledger
↓
Propensity Provenance
↓
Action Abstraction Graph
↓
ActionAbstractionCertificate
↓
Hierarchical Propensity Builder
↓
Support / ESS Auditor
↓
Estimator Router
↓
Policy-Safe Evidence Gate
```

---

# 十二、對「AI 到底怎麼運作」新增的一層

從使用者說一句話到 Agent action，現在可以再往下還原：

```text
User utterance
↓
Tokenizer / multimodal encoder
↓
Context state
↓
LLM next-token distribution
↓
Reasoning / planning state
↓
Intent
↓
Tool-selection distribution
↓
Tool schema
↓
Argument token generation
↓
Exact structured action
↓
Runtime execution
↓
Observation
↓
Retry / next decision
```

而當系統要問：

> 「如果換成另一個 Agent policy，結果會不會更好？」

真正的問題不是只有比較 final answer，而是先定義：

> **哪一層 action 才是可比較的 counterfactual decision unit？**

太細，propensity與support會崩潰；太粗，因果上不同的動作會被錯誤合併。

因此可驗證 Agent 的底層還需要一個介於 LLM token generation 與 OPE之間的新層：

# **Action Semantics / Propensity Runtime**

它負責把「模型吐出一串 tokens」轉成「可被統計、因果與安全系統理解的決策單位」。