# dsh-dashboard

DeepSeek Harness（DSH）Web UI 侧边栏插件：在左侧新增「项目看板」，把任务进度、下载/解压、模型训练、测试结果和 GPU 状态集中到一个紧凑面板。

## 功能

- **紧凑单面板**：顶部任务进度卡 + 任务 / 下载 / 训练 / 测试 / 传输五个页签，列表在面板内滚动。
- **任务进度**：从配置的 `taskPlan`（Markdown 表格或 checkbox 列表）生成任务；状态可由计划标记和 `taskRules` 中配置的证据路径 / 进程匹配推断。未配置计划时任务页签为空，不会内置任何示例计划。
- **可选 AI 任务识别**：配置 `aiTasks` 后，可用 DSH 已配置的模型在“计划/日志/进程证据变化”时低频推断任务状态；默认关闭 thinking、限制输出 token、最短 10 分钟一次，AI 改动的任务带 `AI` 标记，失败自动回退到计划/规则状态。无需单独配置 API key。
- **下载与解压**：本地下载目录与远端 raw 目录；归档显示已解压体积/文件数，解压中显示百分比和当前第几个压缩包。下载中的文件显示**已下载大小、增长速率、已观察时间**；长时间不增长会标记「停滞」并显示停滞时长；同一 partial 文件不会重复出现（没有总大小的格式使用不定进度条）。
- **模型训练**：最近的训练产物；GPU 支持**本机 + 多台远端**（`remoteAliases`），每个来源一组，显示利用率、显存、温度、功耗、风扇、频率、驱动、占用进程，以及该机器的 CPU / 内存 / load；每张卡带一条最近约 30 个采样的利用率迷你趋势线。
- **测试信息**：pytest 历史（每个 run 目录取最新一份日志）、评测指标和结果目录。
- **传输**：新增「传输」页签，显示 dsh-ssh 文件传输的**方向（↑ 上传 / ↓ 下载）、阶段（接收/发送）、已传输字节、速率、已用时间**和最近完成记录，并可一键清空已完成；同时聚合服务器上的 `scp` / `rsync` / `sftp` 进程并解析其方向。传输页签每 2 秒单独轮询，不拖慢主快照。
- **点击查看详情**：点击任意条目打开右侧详情抽屉——测试显示 pytest 日志末尾，训练显示产物列表/指标/日志末尾，下载显示大小与解压明细，传输显示方向/阶段/速率/路径；详情里的路径可一键复制，行尾的复制图标仍可直接复制完整路径。
- 支持来源筛选（全部/本地/服务器）和名称/路径搜索；当前页签与来源会记住；服务端不可用时不影响本地数据。
- **实时刷新**：页面每 2 秒拉取最新快照（隐藏时暂停，回到前台立即刷新），也可点右上角刷新强制重建。

远程数据通过 `dsh-ssh` 的 loopback exec 路由只读采集，不复制或存储 SSH 凭据；未安装 `dsh-ssh` 时插件仍可只展示本地工作区。

## 安装

1. 克隆仓库；
2. 在 DSH 插件管理页安装本目录，或使用 `plugin_manager install_bundle` 指向克隆目录的绝对路径；
3. 首次安装后重启 DSH。之后修改文件可以在插件管理页把 bundle 关一次再开，触发热重载，无需重启。

可选依赖：已安装并配置主机别名的 `dsh-ssh`（用于远程数据与 GPU）。

## 配置

在 `cordis.patch.yml` 的插件行里配置：

```yaml
config:
  localRoot: '/path/to/workspace'   # 要扫描的本地工作区
  remoteAlias: 'my-ssh-host'        # 主 dsh-ssh 主机别名；留空则只扫描本地
  remoteAliases:                    # 可选：额外的 GPU/主机监控目标（同样经 dsh-ssh）
    - 'gpu-host-2'
  remoteRoots:
    downloadRoot: '/data/downloads'
    trainingRoot: '/data/runs'
    logRoot: '/data/logs'
    benchRoot: '/data/runs/bench'    # 可选：bench 汇总目录
  taskPlan: 'docs/TASKS.md'          # 可选：任务计划；'auto' 自动选 docs 下最新任务文件；留空则任务页签为空
  taskRules:                         # 可选：任务证据规则（相对 localRoot 或远端文件后缀）
    T1:
      doneWhen: ['raw/PROVENANCE.txt', 'raw/SHA256SUMS.txt']  # 全部存在才完成
    T2:
      doneWhenAny: ['reports/*.json']                          # 任一存在即完成
    T9:
      runningWhen: ['tools/train.py']                          # 进程参数匹配即进行中
  aiTasks:                            # 可选：用 DSH 默认模型智能识别任务状态
    enabled: true
    intervalSeconds: 600             # 最短调用间隔；仅在证据变化时调用
    maxTokens: 500
    reasoningEffort: off             # 关闭推理，节省 token
    provider: ''                     # 留空使用 DSH 默认模型
    model: ''
  refreshSeconds: 2                 # 快照缓存时间（越小越实时，默认 2 秒）
```

`remoteAlias` 同时是项目数据（下载/训练/测试/任务）的主机来源；`remoteAliases` 里的额外主机只聚合 GPU 与主机资源。可选键：`showLocal`、`showRemote`（布尔）。

任务计划支持两种写法（`taskPlan` 为空时不扫描、不显示任何任务；设为 `auto` 时会自动选择 `docs/` 下最新的 `TASK_PLAN*.md` / `NEXT_TASKS*.md`）：

```markdown
| ID | 标题 | 类型 | 估算 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | 下载并校验数据 | 数据 | 1h | 已完成 |
| T2 | 训练模型 | 训练 | 2d | 进行中 |
| T3 | 汇总报告 | 文档 | 1h | 待开始 |
```

```markdown
- [x] T1 下载并校验数据
- [ ] T2 训练模型
- [ ] T3 汇总报告
```

`doneWhen` / `doneWhenAny` 支持相对路径、`*` 通配符，匹配本地文件或远端探测到的文件列表；`runningWhen` 匹配远端进程命令行。

AI 任务识别使用 Host 的 `llm` 服务（默认模型，或显式 `provider`/`model`），不会额外存 API key。为控制 token：只在任务计划/日志/进程证据的指纹变化时调用，最短 `intervalSeconds` 一次，`reasoningEffort: off`，输入只含任务 ID/标题/状态与最近日志/进程摘要，默认每次约 1–2k token；结果缓存在内存，规则或计划更新后 AI 结论会重新计算。任务标题、进程命令行和日志文件名会发送给所配置的模型服务。

状态列支持 `✅/完成`（已完成）、`🟡/进行中`（进行中）、`⛔/阻塞`（阻塞）、`⬜/待开始`（待开始）。表格里的「产出 / 关键步骤 / 验收 / 依赖 / 负责 / 写作用域」列会一并保留，点击任务行可在详情抽屉查看。

仓库里的 `cordis.patch.yml` 只保留空配置；本机实际使用的路径、SSH 别名等建议写在 **profile 的 `cordis.patch.yml`** 覆盖层（同 id 覆盖），这样仓库里不会出现个人路径。

## 接口

- `GET /api/dino-dashboard/state`：当前快照（过期则重建）
- `GET /api/dino-dashboard/transfers`：轻量传输状态（2 秒轮询，不触发 SSH 扫描）
- `GET /api/dino-dashboard/detail?source=local|remote&path=...&kind=...`：条目详情（本地读文件末尾/目录；远端经 dsh-ssh 读取）
- `POST /api/dino-dashboard/refresh`：强制重建

两个接口都只接受 loopback 请求，且只返回只读状态信息。

## 开发

```
package.json         # bundle patch + dsh.client（platform web）
cordis.patch.yml     # Host 行与配置
index.js             # Host：本地扫描、远程探测、路由
client.js            # Client：侧边栏入口与看板页面
locale/{zh,en}.json  # 插件管理页标题/描述
icon.svg             # 图标
```

安装后修改文件，重新安装或对 bundle 做一次「关→开」即可热重载。
