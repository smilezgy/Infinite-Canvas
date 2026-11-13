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

---

## 十二、gpt-image-2.6 接入（2026-11-13）

> 依据官方 API reference 核对：`developers.openai.com/api/reference/resources/images/methods/generate`
> 与 `.../methods/edit`。第三方博客里的 `resolution` / `aspect_ratio` / 16 档比例等说法**不是** OpenAI Images API 的参数，未采纳。

### 官方新增能力

| 项 | 官方取值 | 说明 |
|---|---|---|
| 模型 ID | `gpt-image-2.6-sunburst` / `gpt-image-2.6-flare` | 与 2.5 同构，Flare 偏速度、Sunburst 偏细节与编辑一致性 |
| `complexity` | `low` / `medium` / `high`（默认 high） | **2.5/2.6 新增**：渲染前的规划量，与 `quality` 相互独立 |
| `quality` | 新增 `xhigh` / `max` | 原 low/medium/high 保留 |
| `output_format` | 新增 `svg` / `gif` | 矢量图与动态图；编辑端同样列出，但 GIF 不支持 mask |
| GIF 帧控制 | `frame_count` 2–16（默认 9）、`frame_duration_ms` ≥20（默认 200） | 仅 `output_format=gif` 时有效 |
| SVG 约束 | 必须 `n=1`；不支持流式、`partial_images`、`output_compression` | 需 `svg.model` 权限，未接入 |
| `markup` | 编辑端透明 PNG 标注层，与 `mask` 互斥 | 需前端上传标注层，本轮未做 |
| `safety_identifier` | ≤128 字符，替代已弃用的 `user` | 本地单人工具未接入 |
| `input_fidelity` | edits 参考把 **gpt-image-2 标注为「必须省略」**，2.5/2.6 亦未提供 | 本次改为**不再发送** |
| Responses API | 不支持 2.6 | 2.6 必须走 Images API |

### 改动清单

**后端 `main.py`**

| 改动 | 说明 |
|---|---|
| `gpt_image_output_options()` | 支持 `svg`/`gif` 格式、`complexity`、`frame_count`、`frame_duration_ms`；透明背景只允许 png/webp（选 jpeg/gif/svg 自动纠正为 png）；svg/gif 不带 `output_compression` |
| `is_gpt_image_new_series()` | 判定 2.5 / 2.6 系列（含 `/text-to-image` 这类子路径写法） |
| `gpt_image_supports_input_fidelity()` | gpt-image-2 及以后一律不发 `input_fidelity`，从根上避免 400 |
| `quality` 白名单 | 放开 `xhigh` / `max` |
| `OPTIONAL_IMAGE_PARAMS` | 增加 `complexity` / `frame_count` / `frame_duration_ms`，继续走「按上游报错精确降级」 |
| `sniff_image_extension()` | 支持 SVG（文本，按根标签识别）；GIF 原本已支持 |
| `build_online_image_result()` | SVG 输出强制 `n=1`（官方要求） |

**前端 `static/online.html`**

- 输出分组新增：复杂度下拉、GIF 帧数、GIF 帧时长
- 格式下拉新增 SVG / GIF（仅 2.5/2.6 系列可见，其余模型自动隐藏并回落）
- 质量下拉新增 xhigh / max（仅 2.5/2.6 系列可见）
- 编辑保真对 gpt-image-2 及以后隐藏（官方已移除该字段）
- 选 SVG 时数量自动锁定为 ×1

**前端 `static/js/canvas.js`**

- 画布生图节点的质量档放开 `xhigh` / `max`（原先会被重置为 auto）

### 验证记录

| 项 | 结果 |
|---|---|
| 纯函数单测 | 29/29 通过（参数组装、系列判定、格式纠正、后缀嗅探） |
| 假上游端到端 | 上游实收 body 含 `complexity` / `frame_count` / `frame_duration_ms` / `output_format=gif` / `quality=xhigh`，且**不含** `input_fidelity` |
| 降级重试 | 假上游回 `does not support the 'complexity' parameter` → 自动剔除后重试成功，其它参数保留，notes 记录被忽略项 |
| 落盘后缀 | SVG → `.svg`、GIF → `.gif`，文件内容与后缀一致 |
| 接口回归 | `/`、`/api/config`、`/api/history`、`/api/storage-settings`、`/api/tasks`、`/api/stats/overview`、`/api/image-params` 均 200；`/api/queue_status` 422 属缺 `client_id` 的既有行为 |
| 页面渲染 | 无头浏览器驱动 `setModel('gpt-image-2.6-flare')`：复杂度/GIF 字段按预期显隐；切回 `gpt-image-2` 后 SVG/GIF/xhigh/max 全部隐藏、格式回落为空 |

> 未做真实出图（会消耗真实额度），SVG/GIF 的实际产物需要你在自己的平台跑一次确认。

### 本轮未覆盖

- `markup` 标注层编辑（需前端上传标注 PNG，与 mask 互斥）
- `svg.model` / `svg.reasoning.effort`（需 SVG 模型选择权限）
- `safety_identifier`、`moderation`、`partial_images`
- 画布节点里的输出格式/背景/复杂度控件（画布当前只透传 quality，未接 gpt-image 输出控制，2.0 时代同样缺失）

---

## 十三、线上排障：400 被误报成「尺寸超限」（2026-11-13）

### 现象

在 `newapi.lkkcdn.com`（provider `custom-api-7`，模型 `gpt-image-2.6-flare`）出图，
上游回 400，但界面提示却是：

> GPT-Image-2 不支持当前尺寸 1024x1024：它有最大像素限制（长边最大 3840、总像素约 829 万）……

1024x1024 远在限制之内，**提示完全指错了方向**。

### 实测上游行为（直连该平台复现）

| 请求 | 结果 |
|---|---|
| `model+prompt+size` | 200，正常出图 |
| `+complexity+quality=xhigh+background` | 200，正常出图 |
| `+output_format=webp + output_compression=80` | 400 `Compression less than 100 is not supported for PNG output format` —— 平台**静默丢弃** output_format，仍按 PNG 处理 |
| `+output_format=svg` | 200，出的是 SVG |
| `+output_format=gif, frame_count=9, size=1024x1024` | 400 `No supported sheet fits 9 GIF frames at size '1024x1024'. Invalid size '3072x3072'. Requested resolution exceeds the current pixel budget.` |
| `+output_format=gif, frame_count=2`（同样是 1024x1024） | 400，报错里**仍是 9 frames** → 平台忽略 frame_count |
| `+output_format=gif, size=512x512` | 200，出的是 GIF |
| `+input_fidelity=high` | 400 `Unknown parameter: 'input_fidelity'.` |

三条关键事实：

1. 该平台**静默忽略** `output_format`（webp 被当 PNG），随后压缩参数才暴露冲突；
2. 该平台**忽略** `frame_count`，GIF 固定 9 帧拼 3×3 sheet → 1024×1024 时拼版 3072×3072（943 万）超 829 万预算；
3. `input_fidelity` 确实不被接受 —— 上一节的「2 系不发 input_fidelity」改动正好命中。

### 三个缺陷与修法

| 缺陷 | 修法 |
|---|---|
| 尺寸误判：报文里的 `Invalid size '3072x3072'` 是平台自己的拼版尺寸，与用户请求的 1024x1024 不同，却被当成用户尺寸非法 | 比对报文里出现的具体尺寸与本次请求尺寸，不同则不判为尺寸问题；GIF 类报错单独出文案 |
| 平台不点名参数时降级机制失效（压缩冲突报文里没有参数名） | 新增 `compression_conflict_params()`：报文含 compression + 不支持语义时，剔除 `output_compression` 重试一次（400 未生成、不计费，安全） |
| GIF 拼版超预算无解 | 新增 `gif_size_budget_fix()`：从报文的 `Invalid size '3072x3072'` 反推拼版倍率（3×3），再按像素预算算出可用单帧尺寸（留 5% 余量 → 912×912）并重试；因为平台忽略帧数，降帧只在报文不涉及 sheet 时才尝试，避免白费往返 |

另外两条配套改动：

- `frame_count` / `size` **不写进**拒绝参数缓存（它们是「被自动调小」，不是「不被支持」；
  尤其 size 是必需参数，一旦被缓存会导致后续请求直接失败）；
- 上游 400 原文现在会打进日志（`[image] 上游返回 400 原文：...`），不再只有二手的友好文案。

### 验证

| 项 | 结果 |
|---|---|
| 假上游复现（报文取真实平台的原文） | 压缩冲突 → 自动剔除 output_compression 后成功；GIF → 自动缩到 912×912 后成功，且只多一次往返 |
| 拒绝缓存 | `size` / `frame_count` 均未进入 `IMAGE_PARAM_REJECT_CACHE` |
| 文案分类 | GIF 报文不再出现「最大像素限制」；真正的尺寸枚举错误与用户自选超大尺寸仍报尺寸 |
| 真实平台 | `size=912x912 + output_format=gif` → 200，返回 GIF89a 内容；`size=512x512 + gif` → 200；`svg` → 200 |
| 单测 | 26/26 通过（参数组装、格式纠正、后缀嗅探、压缩冲突识别、尺寸反推、文案分类） |

> 代价说明：本次排障向该平台发了 9 次请求，其中 4 次成功出图（计费），5 次被 400 拒绝（不计费）。

### 补充：另一种报错措辞与平台真实边界（2026-11-13 续）

线上又遇到一次 GIF 失败，报文换了一种说法：

```
No supported sheet fits 4 GIF frames at size '1024x1024'.
Invalid size '2048x2048'. The longest edge must be less than or equal to 3840.
Invalid size '2048x4096'. The longest edge ...
```

两个新发现：

1. **措辞不只一种**。上一版的自动缩尺寸只认 `pixel budget`，这次报的是 `longest edge`，
   于是没触发、用户又撞了一次。→ 触发条件扩展为 `pixel budget` 或 `longest edge` 两者之一。
2. **帧数默认 4 也一样失败**。平台忽略 `frame_count`，实际仍按 9 帧排版，
   4 帧 @1024 依旧超限。

### 实测该平台 GIF 的真实边界

| 单帧尺寸 | 帧数 | 结果 |
|---|---|---|
| 512x512 | 9 | 200 ✅ |
| 640x640 | 4 | 200 ✅ |
| 768x768 | 4 | 200 ✅ |
| 912x912 | 9 | 200 ✅ |
| 1024x1024 | 4 | 400 ❌ |
| 1024x1024 | 9 | 400 ❌ |

→ 结论：**该平台 GIF 单帧长边必须 < 1024**（912 可行、1024 不行）。

### 改法

| 改动 | 说明 |
|---|---|
| `gif_size_budget_fix()` 触发条件 | 从只认 `pixel budget` 扩展为 `pixel budget` 或 `longest edge` |
| 反推算法改用候选尺寸 | 取报文里**面积最小**的候选拼版尺寸（如 `2048x2048`），留 25% 余量后除以排列倍率 → 单帧上限；4 帧与 9 帧两种情况都收敛到 768 |
| 历史记录尺寸 | 新增 `_applied_params` 传递实际生效参数，`params.size` 记**生效值**（768x768），`requested_size` 保留用户原值（1024x1024） |

### 验证

| 项 | 结果 |
|---|---|
| 真实平台 1024x1024 + GIF 4帧 | 200，日志「已缩小尺寸到 768x768 重试」，产物 GIF 画布实测 768x768 |
| 历史记录 | `params.size = 768x768`、`requested_size = 1024x1024`、`ignored_params = ['size']` |
| 真实平台 SVG / webp / edits 链路 | 200（沿用上一轮结论） |

> 该平台 GIF 的可用上限（单帧 < 1024）是它自己的实现，不适用于所有平台；
> 我们的做法是「失败后按报文反推并自动缩小」，不硬编码任何平台专属阈值。

### 补充二：尺寸**下限**报错被说成「最大像素限制」（2026-11-13 续）

用户在 SVG 场景又撞到一次：

```
Invalid size '512x512'. Requested resolution is below the current minimum pixel budget.
```

界面却提示「GPT-Image-2 不支持当前尺寸 512x512：它有最大像素限制（长边最大 3840、总像素约 829 万）」——
**方向完全说反**：平台嫌尺寸太小，提示却说太大。

### 实测该平台的尺寸下限

| 尺寸 | 总像素 | 结果 |
|---|---|---|
| 512x512 | 262,144 | 400 |
| 768x768 | 589,824 | 400 |
| 896x896 | 802,816 | 200 |
| 1024x1024 | 1,048,576 | 200 |

→ 下限与项目已有的 `GPT_IMAGE2_MIN_PIXELS = 655,360` 吻合（约 816x816）。

### 改动

| 改动 | 说明 |
|---|---|
| `gpt_image_2_size_too_small_message()` | 新增下限专用文案：说明要求总像素不低于 655,360（约 816x816），方向与超限提示分开 |
| `friendly_image_error_detail()` | 识别 `below the current minimum` / `minimum pixel` / `too small` 等措辞 → 走下限文案，不再落入「最大像素限制」 |
| `gpt_size_below_minimum_fix()` | 尺寸过小时按比例放大到 16 倍数的可用下限（512x512 → 816x816）并重试一次（400 未生成、不计费，安全） |
| `default_edit_params()` | 把 size 放进 params，使 edits（multipart）链路也能被重试机制调整尺寸 |
| 输出格式如实核对 | 平台**静默忽略** `output_format`（实测：选 webp 或 svg 都返回 png，且不报错）。现在用落盘的真实后缀对照请求格式，不一致就写进 `ignored_params`，前端提示「该平台不支持所选输出格式」，避免用户以为拿到了 SVG 实际是 PNG |

### 验证

| 项 | 结果 |
|---|---|
| 单测 | 放大换算（512/768 → 816x816，1024 不动）、文案方向、端到端自动放大重试，全部通过 |
| 真实平台 SVG + 512x512 | 200，日志「尺寸低于平台最小像素要求，已放大到 816x816 重试」；历史 `size=816x816`、`requested_size=512x512` |
| 输出格式核对 | 同一请求返回 PNG，`ignored_params = ['size', 'output_format']`，日志「平台未采纳 output_format=svg，实际返回 png」 |
| edits 回归 | 1024x1024 + 参考图 + complexity → 200，multipart 正常 |

## 十三、区分「平台静默忽略」与「我们主动降级」

### 问题

上一节把「平台静默忽略 `output_format`」也写进了 `ignored_params`，前端统一提示：

> 该平台对「输出格式」有额外限制（可能把模型映射到了能力更少的版本），本次已自动调整该设置，其余参数照常生效。

这句文案有**两处不准确**：

1. 「自动调整了设置」—— 平台静默忽略时我们**什么都没调**，只是事后核对发现产物不对；
2. 「其余参数照常生效」—— 掩盖了真正的事实：**用户选的格式没生效，拿到的是别的东西**。

### 实测平台行为又变了

同一平台（`newapi.lkkcdn.com`），key 分组不同，行为不同：

| 请求 | 行为 |
|---|---|
| `output_format=webp` | 200，**返回真 WebP**（文件头 `RIFF....WEBP`，1.0 MB） |
| `output_format=svg` | 400 `SVG output is not available in this key's group (per-call route). Create a key with OpenAI Official as its group ...` |

即：此前「平台静默丢弃 output_format」的结论**已过期**，那是旧 key 分组的行为；现在 WebP 可用，SVG 则**明确报错且不给参数名**——一个参数名都没有，`unsupported_request_params()` 的五条正则全都匹配不上，降级机制直接失效，400 原样抛给用户。

### 改动

| 改动 | 说明 |
|---|---|
| `_FORMAT_VALUE_UNSUPPORTED_PATTERNS` | 新增按**格式值**识别的规则：`svg/gif/webp + output/format/image + not available/unsupported` → 映射回 `output_format` |
| `unsupported_params` | 新字段，只记「平台收下请求却不执行」（静默忽略）；`ignored_params` 只记「上游拒绝、我们剔除后重试」 |
| `requested_format` / `actual_format` | 如实记录所选格式与实际产物格式，前端据此说明「选了 SVG，实际返回 PNG」 |
| `REJECTED_OUTPUT_FORMATS` | 拒绝缓存改为**按格式值**记录（键含 format），修掉「拒过 SVG 就永久禁掉整个 `output_format`」的污染 |
| `friendly_image_error_detail()` | 输出格式不被支持时给专门文案：说明限制来自 **API Key 分组权限**，并给出「改用 PNG/WebP」或「切换 Key 分组」两条可执行建议 |
| 前端 `unsupportedNotice()` / `ignoredNotice()` | 拆成两条文案：静默忽略说清实际产物；主动降级说清改用了默认格式 |

### 验证

| 项 | 结果 |
|---|---|
| 格式值识别单测 | 真实 SVG 报文、WEBP/GIF 变体均能识别；尺寸下限、GIF 拼版超限等报文**不误判**；白名单外不返回 |
| 四路径分类 | 静默忽略 → `unsupported_params`；上游拒 complexity → `ignored_params`；上游拒 svg → `ignored_params` 且 `unsupported_params` 为空；格式一致 → 两者皆空 |
| 拒绝缓存隔离 | 拒过 svg 后，webp / png 请求仍照常携带 `output_format`，不再被误伤 |
| 真实平台 | svg → 200（自动降级为 png，`ignored_params=['output_format']`）；**随后** webp → 200 且落盘真 WebP、`ignored_params=[]`；png → 200 无任何标记 |
| 前端文案 | 无头浏览器驱动，四种场景文案与预期一致 |

> 计数：本次排障向该平台发了 6 次请求，6 次成功出图（计费）。




