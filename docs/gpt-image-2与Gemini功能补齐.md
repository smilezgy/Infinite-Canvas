# gpt-image-2 / Gemini 图像模型能力补齐

> 聚焦方向：把项目重心放在 **gpt-image-2** 与 **Gemini 图像模型**（nano banana / Gemini 3 Pro Image）上
> 日期：2026-11-04

---

## 一、我们原本已经做到的

| 能力 | gpt-image-2 | Gemini 图像 |
|---|---|---|
| 文生图 | ✅ | ✅ |
| 图生图 / 参考图 | ✅ `/images/edits` multipart | ✅ 多参考图 part |
| 蒙版编辑 | ✅ `mask` 字段 | —（靠提示词语义编辑） |
| 尺寸 | ✅ 原样透传，不做裁剪 | ✅ 换算成 `aspectRatio` + `imageSize` |
| 分辨率 | ✅ 1K / 2K / 4K 预设 | ✅ 1K / 2K / 4K |
| 质量档位 | ✅ low / medium / high | — |
| 多张输出 | ✅ n ≤ 8 | — |
| 协议适配 | OpenAI / APIMart / Responses / Codex | Gemini 原生 / APIMart 包装 |
| 多轮补图 | — | ✅ 最多 3 轮追问 |

底子相当扎实，尤其在**协议兼容**和**多中转适配**上比多数开源项目做得细。

---

## 二、两个模型的官方能力清单

### gpt-image-2（OpenAI Images API）

| 参数 | 取值 | 我们原来 | 说明 |
|---|---|---|---|
| `size` | 如 1024x1024 | ✅ | |
| `quality` | low / medium / high / auto | ✅ | |
| `n` | 1–8 | ✅ | |
| **`background`** | auto / transparent / opaque | ❌ | **透明背景**，设计场景刚需 |
| **`output_format`** | png / jpeg / webp | ❌ | |
| **`output_compression`** | 0–100（仅 jpeg/webp） | ❌ | 控制体积 |
| **`input_fidelity`** | low / high | ❌ | 编辑时对原图的保真度 |

### Gemini 3 Pro Image（nano banana pro）

| 能力 | 官方规格 | 我们原来 |
|---|---|---|
| 宽高比 | 3:2 / 2:3 / 3:4 / 1:4 / 4:1 / 4:3 / 4:5 / 5:4 / 1:8 / 8:1 / 9:16 / 16:9 / 21:9 | ✅ 常用 8 种 + 自定义 |
| 分辨率 | 512 / 1K / 2K / 4K | ✅ 1K/2K/4K |
| 参考图上限 | **14 张**（其中远端 URL ≤ 10） | ⚠️ 统一按 20 张放行 |
| 多轮对话 | 需回传 `thoughtSignature` | ⚠️ 只回传纯文本 |

---

## 三、竞品怎么用这两个模型

| 产品 | 与这两个模型相关的关键交互 |
|---|---|
| **OpenAI 官方图像面板** | 背景（透明/不透明）、尺寸、质量、输出格式（PNG/JPEG/WebP）、生成数量；编辑时提供"保真度"概念 |
| **Google AI Studio / Gemini** | 宽高比下拉（含 21:9 等极端比例）、1K/2K/4K、多图参考（≤14）、对话式连续编辑 |
| **Krea / Freepik / SeaArt** | 提示词增强、参考图权重、透明背景导出、批量变体、生成历史 |
| **LiblibAI / 即梦** | 积分消耗提示、比例模板、一键扩图 |

归纳出的共同点：**这两个模型的差异化能力，几乎都集中在"输出规格"上**——
背景、格式、压缩、分辨率、比例、保真度。谁把这些参数完整暴露给用户，谁就能吃满模型能力。

---

## 四、差距与本次补齐

### 4.1 主缺口：gpt-image-2 的输出控制一个都没接

原代码只发 `model / prompt / size / quality`，`background`、`output_format`、`output_compression`、
`input_fidelity` 四个参数完全没出现过（全项目 0 处匹配）。

这意味着：**用户无法生成透明底 PNG**，也无法控制输出体积，而这恰恰是 gpt-image-2 相对上一代的主要卖点。

### 4.2 隐藏 Bug：图片后缀硬编码 `.png`

`save_ai_image_to_output()` 在解析 b64 时默认 `mime_type = image/png`，
而上游返回 b64 通常**不带 mime**。所以即使传了 `output_format=webp`，
拿回来的 webp 字节也会被存成 `.png` 文件——后缀与内容不符，后续按后缀处理的逻辑全错。

**必须先修这个，输出格式功能才有意义。**

### 4.3 Gemini 两处正确性问题

1. **多轮补图丢签名**：第一轮只返回文本/思考时，原实现把模型回复**降级成纯文本**回填，
   丢掉了 `thoughtSignature`。Gemini 3 系在连续对话中要求回传签名，丢签名会导致下一轮 400 或质量下降。
2. **参考图超限**：Gemini 3 Pro Image 单次上限 14 张，我们按全局 20 张放行，超限会被上游直接拒绝。

---

## 五、实现内容

### 5.1 后端（`main.py`）

| 改动 | 说明 |
|---|---|
| `OnlineImageRequest` 新增 4 字段 | `output_format` / `output_compression` / `background` / `input_fidelity` |
| 新增 `gpt_image_output_options()` | 统一组装参数；非 gpt-image 模型返回空字典，避免污染其它模型请求 |
| `generate_ai_image()` 新增 `output_options` | 透传到 `/images/edits`（multipart）与 `/images/generations`（JSON） |
| APIMart 分支 | 带参发送；若上游 400 拒绝新参数，**去掉后自动重试一次**，不让可选参数拖垮整次生成 |
| 新增 `sniff_image_extension()` | 按文件头判断 png/jpg/webp/gif/tif，落盘用真实后缀 |
| `save_ai_image_to_output()` | 改为先嗅探魔数再定后缀（b64 与 URL 下载两条路径都改） |
| 新增 `gemini_candidate_parts()` | 多轮续聊时原样回传 parts（含 `thoughtSignature`），不再降级成纯文本 |
| Gemini 参考图上限 | gemini-3 系收敛到 14 张 |
| 历史记录 | `params.output_options` 记录实际发出的输出参数，便于复盘 |

**参数联动规则**（前后端一致）：

- `background=transparent` + `output_format=jpeg` → 自动纠正为 `png`（JPEG 不支持透明通道）
- `output_compression` 仅在 jpeg/webp 时生效，超出 0–100 自动夹取

### 5.2 前端（`static/online.html`）

新增「输出」分组，**仅在选中 gpt-image 系模型时显示**：

- 背景：默认 / 自动 / 透明 / 不透明
- 格式：默认 / PNG / JPEG / WebP
- 压缩：滑块 0–100（仅 jpeg/webp 时出现）
- 编辑保真：默认 / 低 / 高（仅上传了参考图时出现）

联动：切换背景为透明时若格式是 JPEG 自动切回 PNG；上传/清除参考图时保真项自动显隐。

---

## 六、验证记录

| 项 | 结果 |
|---|---|
| 参数组装 | 透明+jpeg → 自动转 png；透明+webp+75 → `{output_format:webp, output_compression:75, background:transparent}` |
| 非 gpt 模型隔离 | `gemini-3-pro-image-preview` 传入输出参数 → 返回 `{}`，不会污染 Gemini 请求 |
| 压缩越界 | 150 → 夹到 100 |
| 后缀嗅探 | png/jpg/webp 魔数全部识别正确，未知内容返回空 |
| 接口字段 | OpenAPI 中 4 个新字段均已注册 |
| 请求校验 | 带全部新参数 POST → 返回业务错误 400（非 422），说明参数解析通过 |
| 页面渲染 | 无头浏览器驱动选中 gpt-image-2：输出分组正常出现，下拉与滑块对齐，生成按钮完好 |

> 未做真实出图验证（会消耗真实额度）。建议你自己用一张图跑一次
> 「透明背景 + WebP」，确认产出文件后缀与透明通道都正确。

---

## 七、后续建议（按性价比排序）

1. **Gemini 极端比例预设**：把 21:9 / 4:5 / 5:4 / 1:4 / 4:1 做成下拉选项，
   目前只能靠自定义比例输入，普通用户不会用。
2. **生成前额度预估**：gpt-image-2 按 quality + size 计费，Gemini 按分辨率计费，
   提交前提示"本次约消耗 X"，对高频使用者价值很高。
3. **参考图权重**：Gemini 支持多图参考，但没有权重概念；可在提示词层做结构化模板（主体/风格/构图）。
4. **失败重试与降级**：APIMart 已做参数降级重试，可推广到其它可选参数。

---

## 八、模型映射导致的参数 400（2026-11-04 修复）

### 现象

前端选 `gpt-image-2`，请求发出去后上游返回：

```
status_code=400, The model 'gpt-image-2.5-flare' does not support the 'input_fidelity' parameter.
```

注意报错里的模型名是 `gpt-image-2.5-flare`，而不是我们发出去的 `gpt-image-2`——**平台在上游做了模型映射**。
映射后的实际模型能力比别名少，但我们按别名判断能力，于是把 `input_fidelity` 硬发了出去。

### 为什么不能靠"判断模型名"解决

`is_gpt_image_2_model()` 只能看到**用户选择的别名**，看不到映射目标。即使把 2.5 系列硬编码成
"不支持 input_fidelity"，也无法覆盖其它平台映射到别的变体、或明天新增的变体。硬编码能力表只会不断漏。

### 改法：按上游报错精确降级 + 记住结果

| 组件 | 作用 |
|---|---|
| `unsupported_request_params()` | 从 400 报文里解析被点名的参数（支持 `does not support the 'x' parameter`、`Unsupported parameter: 'x'`、`参数 x 不受支持` 等措辞），只认白名单里的可选参数 |
| `send_with_optional_param_retry()` | 命中后**只剔除被点名的字段**再重试，最多 3 轮；不做"任意 400 就盲重试" |
| `IMAGE_PARAM_REJECT_CACHE` | 按 `(provider_id, model)` 记住被拒参数，同一进程内后续请求直接不发，省掉注定失败的一次往返 |

三条路径全部接入：`/images/generations`（JSON）、`/images/edits`（multipart）、APIMart 分支。

两个关键安全点：

1. **只对"参数不支持"重试**。400 表示请求被拒、没有生成也没有扣费，重试是安全的；
   内容安全拦截等其它 400 不会触发重试（旧版 APIMart 分支是"任意 400 就重发"，会白白多打一次上游）。
2. **multipart 每次重试重新打开文件句柄**。第一次请求后句柄已读到末尾，复用会让重试发出 0 字节的文件——
   这是 `send_with_optional_param_retry` 接入 edits 时必须同步改的地方。

另外，`quality` 原来在 `post_openai_edits()` 里单独拼接，会绕过降级（剔除了又会被加回去），
已并入统一的参数字典，参与同一套降级逻辑。

### 用户可见行为

被忽略的参数会写进 `params.ignored_params`，前端在页面底部弹一条提示：
"该平台把此模型映射到了能力更少的版本，上游不支持「编辑保真」，本次已自动忽略这项设置，其余参数照常生效。"

> 提示条挂在 `<html>` 而非 `<body>`：`theme.js` 会给 body 加 `transform: scale()`，
> body 一旦成为 `position: fixed` 的包含块，提示条会被定位到文档底部（实测 y=1126，视口只有 900）。

---

## 九、内容安全 400 的文案处理

上游返回：

```
非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。
```

原实现只匹配英文措辞（`safety system` / `content_policy_violation` 等），中文报文会**原样透传**给前端，
用户看到一大段上游原文，不知道该怎么办。现在 `friendly_image_error_detail()` 增加了中文特征词匹配，
统一转成可执行提示：

> 上游内容安全拦截了本次生成：提示词或参考图触发了上游的成人/敏感内容策略，这不是本系统故障，
> 原样重试大概率仍会被拦。建议：① 改写描述，避免裸露、亲密动作等直接表述，改用服装、姿态、光线的间接描述；
> ② 若用了人物参考图，换一张更保守的图；③ 换一个平台或模型再试。

同时明确**不自动重试**：同一段提示词重发只会再被拦一次，白等一轮。

### 验证记录（本轮）

| 项 | 结果 |
|---|---|
| 参数名解析 | `does not support the 'input_fidelity' parameter` / `Unsupported parameter: 'background'` / `参数 output_format 不受支持` 均正确提取 |
| 真实 HTTP 往返（JSON） | 第一次 400 → 自动剔除 `input_fidelity` → 第二次 200，其余参数（`output_format`）保留 |
| 真实 HTTP 往返（multipart） | 重试请求体积 4555→4456 字节，文件内容完整，未出现空文件 |
| 缓存 | 首次降级后 `(provider, model)` 记入缓存，后续请求不再发送该参数 |
| 内容安全不重试 | 安全类 400 只发 1 次请求，不产生重复调用 |
| 提示条渲染 | 无头浏览器实测：位于视口底部居中（top=811 / 视口 900），已避开「生成」按钮 |

---

## 十、异步任务式模型"一直生成中"（2026-11-06 修复）

### 现象

用 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` 这类代号模型时：**日志没有任何报错，页面一直转圈，
但上游其实早就出完图了**，项目里什么都不显示。等满 30 分钟才弹超时。

### 根因

这类模型在部分中转上是**异步任务式**：第一次 `POST /v1/images/generations` 只返回任务号，不返回图片。

我们的兜底逻辑是"拿不到图但看到任务号 → 去轮询"，openai 模式默认轮询
`/v1/images/tasks/{id}`。但这些站的任务实际挂在 `/v1/tasks/{id}`，而且它们对不存在的路径
返回的是 **HTTP 200 + `{"detail":"Not Found"}`**，不是 404。

于是三个判断全部落空：

| 检查 | 结果 |
|---|---|
| `raise_for_status()` | 通过（200，不报错） |
| `image_task_status()` | 空（响应里没有 status 字段） |
| `extract_image()` | 失败（没有图片） |

代码把它当成"任务还在跑"，继续每 2 秒轮询一次，直到 `IMAGE_TASK_TIMEOUT`（1800 秒）超时。
整个过程**不打任何日志**，所以表现就是"没有报错，但一直生成中"。

### 改法

| 改动 | 作用 |
|---|---|
| `image_task_url_candidates()` | 按配置推断的主地址 + `/images/tasks/{id}`、`/tasks/{id}` 两个兼容候选 |
| 连续无法识别即换地址 | 同一地址连续 4 次（`IMAGE_TASK_UNRECOGNIZED_LIMIT`）返回"既无状态又无图片"，判定地址不对，换下一个候选 |
| HTTP 400/404/405 直接换地址 | 明确的"路径不对"信号，不必等计数 |
| 候选全部失败 → 立即 502 | 报错里带：试过的地址、上游最后返回内容、该改哪个设置。不再空等 30 分钟 |
| 三行诊断日志 | `[image] 开始`（provider/model/mode/endpoint）、`[image] 上游响应`（status+耗时）、`[image-task] 转任务轮询`（task_id+原始响应） |
| 前端等待秒数 | 生成中显示 `12s`、`35s`，长任务至少能看出"在动" |

### 验证（本地假上游）

| 场景 | 旧行为 | 新行为 |
|---|---|---|
| `/v1/images/tasks` 返回 200 但内容是 `{"detail":"Not Found"}`，真地址是 `/v1/tasks` | 静默轮询 30 分钟 | **0.55s 自动换地址拿到图** |
| 所有候选地址都查不到任务 | 静默轮询 30 分钟 | **0.92s 报错**并提示该改哪个「图片接口」 |

> 这条修复只能救"任务地址猜错"的情况。如果平台把 2.5 挂在 `/v1/responses` 之类的接口上，
> 仍需在「API 设置」把该平台的「图片接口」改成对应模式。

---

## 十一、大图响应传输中断（2026-11-06 修复）

### 现象

```
[NET-ERR] 生图 网络/TLS错误 provider=custom-api-6 model=gpt-image-2.5-flare
| url=https://52.77.175.144/v1/images/generations
| httpx.RemoteProtocolError: peer closed connection without sending complete message body
  (received 11321 bytes, expected 3150013)
```

上游声明要回 3.15MB，只发了 11KB（0.4%）就断开。

### 性质

**这不是提示词、参数或模型的问题，是回传阶段被掐断**。图片在上游已经生成完，
只是没传回来。常见原因：中转带宽不稳、代理/VPN 掐断大响应、服务端写超时、
裸 IP 直连（无 CDN）的线路抖动。

base64 图片的 JSON 动辄 2~4MB，正好是最容易被中间设备掐掉的体积。

### 改法

| 改动 | 说明 |
|---|---|
| `RetryingImagePostClient` | 给生图 POST 包一层：捕获 `RemoteProtocolError` / `ReadError`，同一请求**重发一次** |
| 只对不带文件的 JSON POST 生效 | multipart 不能这样重试——文件句柄第一次已读到末尾，重发会发出 0 字节文件（这类请求在 `_send_edit` 里已按次重开文件） |
| 每次生成最多重试一次 | `self.retried` 守卫，避免无限重发 |
| `IMAGE_TRANSPORT_RETRY=0` | 想完全避免重复计费时可关掉 |
| `transport_error_detail()` | 把 `received X / expected Y` 解析成中文提示：收到多少、占多少、为什么、下一步怎么做 |

### 为什么要重试（以及代价）

传输中断意味着图已经生成、已经计费，但没拿到。不重试用户只能手动再点一次，
同样是一次计费。所以自动重发一次在成本上不更差，但**可能产生两次计费**——
日志里会明确打 `传输中断，同一请求重试一次（可能重复计费）`。

### 验证（本地假上游）

| 场景 | 结果 |
|---|---|
| 第一次声明 3.15MB 只发 11KB 后断开，第二次正常 | 自动重发，**0.17s 拿到图**，POST 次数 2 |
| 两次都在同一位置断开 | 不再重试，返回中文提示：`只收到 11,321 / 3,150,013 字节（0.4%）…` |
| 非传输类异常（如 connect timeout） | `transport_error_detail` 返回空串，仍走原来的通用文案 |
