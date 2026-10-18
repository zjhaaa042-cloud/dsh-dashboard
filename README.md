# dsh-dashboard

DeepSeek Harness（DSH）Web UI 侧边栏插件：在左侧新增「项目看板」，把任务进度、下载/解压、模型训练、测试结果和 GPU 状态集中到一个紧凑面板。

## 功能

- **紧凑单面板**：顶部任务进度卡 + 任务 / 下载 / 训练 / 测试四个页签，列表在面板内滚动。
- **任务进度**：读取工作区任务计划，结合服务器产物与运行中的进程推断每项任务的状态、进度和下一步（转换、校验、训练、评测进程会自动识别）。
- **下载与解压**：本地下载目录与远端 raw 目录；归档显示已解压体积/文件数，解压中显示百分比和当前第几个压缩包。
- **模型训练**：最近的训练产物；GPU 支持**本机 + 多台远端**（`remoteAliases`），每个来源一组，显示利用率、显存、温度、功耗、风扇、频率、驱动、占用进程，以及该机器的 CPU / 内存 / load；每张卡带一条最近约 30 个采样的利用率迷你趋势线。
- **测试信息**：pytest 历史（每个 run 目录取最新一份日志）、评测指标和结果目录。
- **传输**：新增「传输」页签，显示 dsh-ssh 文件传输的**方向（↑ 上传 / ↓ 下载）、阶段（接收/发送）、已传输字节、速率、已用时间**和最近完成记录，并可一键清空已完成；同时聚合服务器上的 `scp` / `rsync` / `sftp` 进程并解析其方向。传输页签每 2 秒单独轮询，不拖慢主快照。
- 点击条目复制完整路径；支持来源筛选（全部/本地/服务器）和名称/路径搜索；当前页签与来源会记住；服务端不可用时不影响本地数据。

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
  refreshSeconds: 20                # 快照缓存时间
```

`remoteAlias` 同时是项目数据（下载/训练/测试/任务）的主机来源；`remoteAliases` 里的额外主机只聚合 GPU 与主机资源。可选键：`showLocal`、`showRemote`（布尔）。

仓库里的 `cordis.patch.yml` 只保留空配置；本机实际使用的路径、SSH 别名等建议写在 **profile 的 `cordis.patch.yml`** 覆盖层（同 id 覆盖），这样仓库里不会出现个人路径。

## 接口

- `GET /api/dino-dashboard/state`：当前快照（过期则重建）
- `GET /api/dino-dashboard/transfers`：轻量传输状态（2 秒轮询，不触发 SSH 扫描）
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
