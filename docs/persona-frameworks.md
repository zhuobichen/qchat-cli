# 人格预设的理论依据（不是拍脑袋编的）

> 这份文档是 `private/personas/presets/` 里那几份预设的底座。
> 号主 2026-11-13 的要求：「不能无中生有，用那种经过认可的、大家公认的。」
> 所以每份预设都不自己发明性格类型，而是挂在两个成熟框架上。

---

## 一、原型：荣格十二原型（Margaret Mark & Carol S. Pearson, *The Hero and the Outlaw*）

出处与现状：
- 荣格（Carl Jung）提出「集体无意识」与原型（archetype）概念
- Margaret Mark 与 Carol S. Pearson 在 *The Hero and the Outlaw*（1999）把它落成 12 个可操作的原型，
  这本书至今是品牌人格设计的标准参考，行业里通常就叫「12 brand archetypes」
- 参考：[orthotropy 的 12 原型整理](https://orthotropy.com/en/insights/brand-archetypes)、
  [Skills Directory 原型对照表](https://www.skillsdirectory.com/skills/thedixitjain-archetypes)

| 原型 | 核心动机 | 我们的预设 |
|---|---|---|
| Sage 智者 | 求真、知识 | `tech-geek`（技术宅老哥） |
| Jester 愚者 | 享乐、松弛 | `meme-bro`（沙雕群友） |
| Outlaw 叛逆者 | 打破常规 | `sharp-critic`（毒舌损友） |
| Caregiver 照顾者 | 保护、体谅 | `warm-helper`（暖心管家） |
| Sage × Magician 的冷面变体 | 洞察、不解释 | `deadpan-poet`（抽象诗人） |
| Ruler 统治者 | 秩序、界限 | `cold-minimal`（高冷话少） |

**为什么用这套**：原型的好处是「一看标签就知道该怎么说话」——Sage 不会撒娇，
Jester 不会说教。这比自创「小暖、皮皮、冰冰」这类名字可复用得多。

---

## 二、强度：大五人格（Big Five / OCEAN）

出处与现状：
- 大五人格是当代人格心理学里实证支持最强的模型（Costa & McCrae 等人的五因素模型）
- 在 AI 人设设计里也被广泛采用：把人格写成五个 0–1 的分值，再推导行为特征
  （参考 [Sonzai 的 Big Five 人设系统](https://sonz.ai/docs/en/personality)、
  [OCEAN 人设实践指南](https://webheadsunited.com/personas-ocean-model-examples-guide-ai-design/3)）

五个维度：

| 维度 | 高 | 低 |
|---|---|---|
| Openness 开放性 | 爱玩新东西、爱玩梗 | 务实、只谈具体 |
| Conscientiousness 尽责性 | 有条理、给方案 | 随性、想到哪说到哪 |
| Extraversion 外向性 | 话多、主动 | 话少、被动 |
| Agreeableness 宜人性 | 顺着人、体谅 | 直给、爱戳破 |
| Neuroticism 神经质 | 情绪起伏大 | 情绪稳 |

**为什么用它**：原型只说了「是什么角色」，大五补上「到什么程度」。
同样是 Sage，宜人性 0.8 是温和的老师，宜人性 0.2 是嘴硬的顾问——差别全在分值上。

---

## 三、每份预设的结构

每份预设文件头都写明：

```
原型：Sage（智者）— Mark & Pearson 12 原型
OCEAN：O 0.9 / C 0.7 / E 0.3 / A 0.25 / N 0.3
```

后面才是具体说话方式、抽象手法、边界、示例。
**分值是推导工具，不是科学测量**——它是给人看的一致性约束（同一个 Sage，
宜人性不能一会儿 0.2 一会儿 0.9），不是心理学结论。

---

## 四、诚实声明

- 12 原型与大五都是**公认框架**，出处可查
- 但「哪个预设对应哪个原型、分值打多少」是**我做的映射判断**，不是任何原书给的答案
- 如果觉得某一个映射不对，改分值就行，不用换框架

---

## 五、附：不采用的那些

- **星座、MBTI**：流传广，但学术上争议大（MBTI 的重测信度长期被批评）。
  用来聊天可以，用来定义一套要长期保持一致的人格不合适。
- **DISC**：职场沟通模型，适合协作场景，不适合群聊的松弛语气。
- **Bartle 玩家类型**（杀手/成就者/社交者/探索者）：它描述的是「为什么玩」，
  不是「怎么说话」，只能借用一点，不能当人设底座。
