/**
 * dino-dashboard — Client half.
 *
 * Registers the shell's global sidebar panel entry (`sidebar.panellist`) and
 * the compact dashboard page in the layout's keyed `main` seat. The page polls
 * the Host's read-only snapshot route and keeps one tab (downloads / training /
 * tests) visible at a time, so it never grows into a long three-section page.
 */
window.__ModuleLoader__.load({
  id: '@local/dino-dashboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dino-dashboard'
    const PANEL_ID = 'dino-dashboard'
    const API = 'api/dino-dashboard'
    const POLL_MS = 2000
    const STORE_TAB = 'dino-dashboard:tab:v2'
    const STORE_SOURCE = 'dino-dashboard:source'
    const TABS = ['tasks', 'downloads', 'training', 'tests', 'transfers']

    /** Translate function installed by apply(); components call it via useT(). */
    let translate = (key) => key
    /** Client locale service face, used to re-render on language changes. */
    let localeFace = null
    /** Layout service face, used by the back-to-conversation control. */
    let layoutFace = null

    const zh = {
      'entry.label': '项目看板',
      'page.title': '项目看板',
      'page.subtitle': '任务 · 下载 · 训练 · 测试',
      'page.loading': '读取中…',
      'page.refresh': '刷新',
      'page.back': '返回对话',
      'page.autoRefresh': '每 {seconds}s 自动刷新',
      'page.updatedAt': '更新于 {time}',
      'section.downloads': '下载',
      'section.training': '训练',
      'section.tests': '测试',
      'section.tasks': '任务',
      'section.transfers': '传输',
      'source.local': '本地',
      'source.remote': '服务器',
      'state.fail': '异常',
      'state.off': '关闭',
      'summary.items': '{n} 项',
      'stat.running': '{n} 进行中',
      'stat.gpu': 'GPU {n}%',
      'stat.passed': '{n} 通过',
      'stat.failed': '{n} 失败',
      'count.filtered': '{shown} / {total}',
      'filter.label': '来源筛选',
      'filter.all': '全部',
      'filter.local': '本地',
      'filter.remote': '服务器',
      'filter.search': '搜索名称 / 路径',
      'empty.downloads': '暂无下载记录',
      'empty.training': '暂无训练记录',
      'empty.tests': '暂无测试记录',
      'empty.tasks': '暂无任务计划（在配置 taskPlan 指向 Markdown 计划文件）',
      'empty.transfers': '暂无文件传输',
      'empty.filtered': '当前筛选下没有记录',
      'empty.search': '没有匹配的记录',
      'status.running': '进行中',
      'status.passed': '通过',
      'status.failed': '失败',
      'status.done': '已完成',
      'status.pending': '待开始',
      'status.blocked': '阻塞',
      'status.info': '信息',
      'task.heroLabel': '任务进度',
      'task.nextTag': '下一步',
      'task.meta': '{done}/{total} 已完成 · 下一步 {next}',
      'task.estimate': '预估 {value}',
      'task.currentTag': '进行中',
      'task.open': '查看任务明细',
      'task.tileMeta': '{percent}% · 下一步 {next}',
      'task.tileDone': '{percent}% 已完成',
      'task.tileRunning': '进行中 {current} · 下一步 {next}',
      'task.panelCount': '{done}/{total} 已完成',
      'task.aiUsage': 'AI 推断：{n} 项 · {tokens} tokens',
      'task.aiPending': 'AI 推断中…',
      'detail.download': '下载文件',
      'detail.directory': '目录',
      'detail.remoteDirectory': '服务器目录',
      'detail.remoteDownload': '服务器文件',
      'detail.remotePartial': '下载中临时文件',
      'detail.run': '产物：{list}',
      'detail.runEmpty': '暂无训练产物',
      'detail.remoteRun': '服务端产物：{list}',
      'detail.remoteRunEmpty': '服务端暂无产物',
      'detail.pytest': 'pytest',
      'detail.metrics': '整体评测',
      'detail.suite': '{n} 个测试文件',
      'detail.resultFile': '评测结果',
      'detail.session': '后台任务',
      'detail.extracting': '解压中 {percent}',
      'detail.extractingPlain': '解压中',
      'detail.extractStep': '第 {index}/{total} 个',
      'detail.extracted': '已解压 · {files} 文件 · {size}',
      'detail.extractPartial': '解压未完成 · 已解压 {files} 文件 · {size}',
      'detail.extractPending': '待解压 · {archives} 个压缩包',
      'status.extracting': '解压中',
      'tag.extract': '解压',
      'tag.ai': 'AI',
      'transfer.upload': '上传',
      'transfer.download': '下载',
      'transfer.remote': '远端',
      'transfer.session': '会话',
      'transfer.unknown': '传输',
      'transfer.phaseReceiving': '接收中',
      'transfer.phaseSending': '发送中',
      'transfer.phaseProcess': '进行中',
      'transfer.rate': '{value}/s',
      'transfer.elapsed': '已运行 {value}',
      'transfer.panelCount': '{active} 进行中 · {done} 已完成',
      'transfer.clear': '清空已完成',
      'stat.transferActive': '{n} 进行中',
      'stat.transferDone': '{n} 已完成',
      'detail.passed': '{n} passed',
      'detail.failed': '{n} failed',
      'gpu.label': 'GPU',
      'gpu.mem': '{used}/{total} GB',
      'gpu.noLocal': '本地未检测到 GPU（nvidia-smi 不可用）',
      'gpu.noRemote': '服务器未返回 GPU 信息',
      'gpu.noGpu': '未检测到 GPU',
      'gpu.system': 'CPU {cpu}% · 内存 {used}/{total} GB',
      'gpu.memOnly': '内存 {used}/{total} GB',
      'gpu.load': 'load {load}',
      'gpu.driver': '驱动 {v}',
      'gpu.fan': '风扇 {n}%',
      'gpu.memUtil': '显存 {n}%',
      'gpu.usage': '占用：{list}',
      'time.justNow': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'error.load': '加载失败：{message}',
      'error.local': '本地扫描失败：{message}',
      'error.remote': '服务器扫描失败：{message}',
      'toast.copied': '已复制路径',
      'toast.copyFailed': '复制失败',
      'row.copyHint': '点击复制路径',
      'row.detailHint': '点击查看详情',
      'detail.title': '详情',
      'detail.close': '关闭',
      'detail.path': '路径',
      'detail.size': '大小',
      'detail.time': '时间',
      'detail.source': '来源',
      'detail.status': '状态',
      'detail.kind': '类型',
      'detail.loading': '正在读取…',
      'detail.error': '读取失败：{message}',
      'detail.logTail': '日志末尾',
      'detail.dirListing': '目录列表',
      'detail.files': '目录内容',
      'detail.dir': '目录',
      'detail.emptyDir': '空目录',
      'detail.copyPath': '复制路径',
      'detail.metrics': '指标',
      'detail.taskInfo': '任务说明',
      'detail.deliverable': '产出',
      'detail.steps': '关键步骤',
      'detail.acceptance': '验收',
      'detail.dependencies': '依赖',
      'detail.owner': '负责',
      'detail.scope': '写作用域',
      'detail.ai': 'AI 推断',
      'detail.evidence': '判断依据',
      'detail.estimate': '预计',
      'detail.direction': '方向',
      'detail.phase': '阶段',
      'detail.bytes': '已传输',
      'detail.rate': '速率',
      'detail.elapsed': '已用时间',
      'detail.from': '来源',
      'detail.to': '目标',
      'detail.command': '命令',
      'foot.hint': '点击条目查看详情 · 右侧图标复制路径',
    }

    const en = {
      'entry.label': 'Project Dashboard',
      'page.title': 'Project Dashboard',
      'page.subtitle': 'Tasks · Downloads · Training · Tests',
      'page.loading': 'Reading…',
      'page.refresh': 'Refresh',
      'page.back': 'Back to chat',
      'page.autoRefresh': 'Auto {seconds}s',
      'page.updatedAt': 'Updated {time}',
      'section.downloads': 'Downloads',
      'section.training': 'Training',
      'section.tests': 'Tests',
      'section.tasks': 'Tasks',
      'section.transfers': 'Transfers',
      'source.local': 'Local',
      'source.remote': 'Server',
      'state.fail': 'Error',
      'state.off': 'Off',
      'summary.items': '{n} items',
      'stat.running': '{n} running',
      'stat.gpu': 'GPU {n}%',
      'stat.passed': '{n} passed',
      'stat.failed': '{n} failed',
      'count.filtered': '{shown} / {total}',
      'filter.label': 'Source filter',
      'filter.all': 'All',
      'filter.local': 'Local',
      'filter.remote': 'Server',
      'filter.search': 'Search name / path',
      'empty.downloads': 'No download records yet',
      'empty.training': 'No training records yet',
      'empty.tests': 'No test records yet',
      'empty.tasks': 'No task plan yet (set taskPlan to a Markdown plan file)',
      'empty.transfers': 'No file transfers yet',
      'empty.filtered': 'Nothing matches this filter',
      'empty.search': 'Nothing matches this search',
      'status.running': 'Running',
      'status.passed': 'Passed',
      'status.failed': 'Failed',
      'status.done': 'Done',
      'status.pending': 'Pending',
      'status.blocked': 'Blocked',
      'status.info': 'Info',
      'task.heroLabel': 'Task progress',
      'task.nextTag': 'Next',
      'task.meta': '{done}/{total} done · next {next}',
      'task.estimate': 'est. {value}',
      'task.currentTag': 'Running',
      'task.open': 'Open task detail',
      'task.tileMeta': '{percent}% · next {next}',
      'task.tileDone': '{percent}% done',
      'task.tileRunning': 'running {current} · next {next}',
      'task.panelCount': '{done}/{total} done',
      'task.aiUsage': 'AI: {n} changes · {tokens} tokens',
      'task.aiPending': 'AI classifying…',
      'detail.download': 'Downloaded file',
      'detail.directory': 'Directory',
      'detail.remoteDirectory': 'Server directory',
      'detail.remoteDownload': 'Server file',
      'detail.remotePartial': 'Partial download',
      'detail.run': 'Artifacts: {list}',
      'detail.runEmpty': 'No training artifacts yet',
      'detail.remoteRun': 'Server artifacts: {list}',
      'detail.remoteRunEmpty': 'No server artifacts yet',
      'detail.pytest': 'pytest',
      'detail.metrics': 'Evaluation metrics',
      'detail.suite': '{n} test files',
      'detail.resultFile': 'Evaluation result',
      'detail.session': 'Background task',
      'detail.extracting': 'Extracting {percent}',
      'detail.extractingPlain': 'Extracting',
      'detail.extractStep': 'part {index}/{total}',
      'detail.extracted': 'Extracted · {files} files · {size}',
      'detail.extractPartial': 'Extraction incomplete · {files} files · {size}',
      'detail.extractPending': 'Waiting to extract · {archives} archives',
      'status.extracting': 'Extracting',
      'tag.extract': 'Extract',
      'tag.ai': 'AI',
      'transfer.upload': 'Upload',
      'transfer.download': 'Download',
      'transfer.remote': 'Remote',
      'transfer.session': 'Session',
      'transfer.unknown': 'Transfer',
      'transfer.phaseReceiving': 'Receiving',
      'transfer.phaseSending': 'Sending',
      'transfer.phaseProcess': 'Running',
      'transfer.rate': '{value}/s',
      'transfer.elapsed': 'elapsed {value}',
      'transfer.panelCount': '{active} running · {done} done',
      'transfer.clear': 'Clear finished',
      'stat.transferActive': '{n} running',
      'stat.transferDone': '{n} done',
      'detail.passed': '{n} passed',
      'detail.failed': '{n} failed',
      'gpu.label': 'GPU',
      'gpu.mem': '{used}/{total} GB',
      'gpu.noLocal': 'No local GPU detected (nvidia-smi unavailable)',
      'gpu.noRemote': 'No GPU information from the server',
      'gpu.noGpu': 'No GPU detected',
      'gpu.system': 'CPU {cpu}% · mem {used}/{total} GB',
      'gpu.memOnly': 'mem {used}/{total} GB',
      'gpu.load': 'load {load}',
      'gpu.driver': 'driver {v}',
      'gpu.fan': 'fan {n}%',
      'gpu.memUtil': 'mem {n}%',
      'gpu.usage': 'usage: {list}',
      'time.justNow': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'error.load': 'Failed to load: {message}',
      'error.local': 'Local scan failed: {message}',
      'error.remote': 'Server scan failed: {message}',
      'toast.copied': 'Path copied',
      'toast.copyFailed': 'Copy failed',
      'row.copyHint': 'Click to copy path',
      'row.detailHint': 'Click to view details',
      'detail.title': 'Details',
      'detail.close': 'Close',
      'detail.path': 'Path',
      'detail.size': 'Size',
      'detail.time': 'Time',
      'detail.source': 'Source',
      'detail.status': 'Status',
      'detail.kind': 'Type',
      'detail.loading': 'Loading…',
      'detail.error': 'Load failed: {message}',
      'detail.logTail': 'Log tail',
      'detail.dirListing': 'Directory listing',
      'detail.files': 'Contents',
      'detail.dir': 'dir',
      'detail.emptyDir': 'Empty directory',
      'detail.copyPath': 'Copy path',
      'detail.metrics': 'Metrics',
      'detail.taskInfo': 'Task',
      'detail.deliverable': 'Deliverable',
      'detail.steps': 'Steps',
      'detail.acceptance': 'Acceptance',
      'detail.dependencies': 'Depends on',
      'detail.owner': 'Owner',
      'detail.scope': 'Scope',
      'detail.ai': 'AI inference',
      'detail.evidence': 'Evidence',
      'detail.estimate': 'Estimate',
      'detail.direction': 'Direction',
      'detail.phase': 'Phase',
      'detail.bytes': 'Transferred',
      'detail.rate': 'Rate',
      'detail.elapsed': 'Elapsed',
      'detail.from': 'From',
      'detail.to': 'To',
      'detail.command': 'Command',
      'foot.hint': 'Click a row for details · icon copies the path',
    }

    const METRIC_LABEL = {
      image_auroc: 'I-AUROC',
      image_f1: 'I-F1',
      image_average_precision: 'I-AP',
      pixel_auroc: 'P-AUROC',
      pixel_f1: 'P-F1',
    }

    /** Small category glyphs shown in the overview tiles. */
    const STAT_ICONS = {
      tasks: glyph([
        h('path', { key: 'a', d: 'M3 4.4l1.1 1.2L6.1 3.8' }),
        h('path', { key: 'b', d: 'M3 8.7l1.1 1.2 2-1.8' }),
        h('path', { key: 'c', d: 'M3 13l1.1 1.2 2-1.8' }),
        h('path', { key: 'd', d: 'M8 4.8h5.2M8 9.1h5.2M8 13.4h5.2' }),
      ], 13),
      downloads: glyph([
        h('path', { key: 'a', d: 'M8 2.4v7.2' }),
        h('path', { key: 'b', d: 'M4.9 7l3.1 3.2L11.1 7' }),
        h('path', { key: 'c', d: 'M2.8 13.2h10.4' }),
      ], 13),
      training: glyph([
        h('rect', { key: 'a', x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.2 }),
        h('path', { key: 'b', d: 'M5.3 8h5.4M5.3 5.5h5.4M5.3 10.5h3.2' }),
      ], 13),
      tests: glyph([
        h('path', { key: 'a', d: 'M3.4 8.5l3 3 6.2-6.6' }),
      ], 13),
      transfers: glyph([
        h('path', { key: 'a', d: 'M8 2.6v10.8' }),
        h('path', { key: 'b', d: 'M5.2 5.4L8 2.6l2.8 2.8' }),
        h('path', { key: 'c', d: 'M10.8 10.6L8 13.4l-2.8-2.8' }),
      ], 13),
    }

    /** Translate and fill `{name}` placeholders. */
    function fmt(t, key, vars) {
      let out = t(key)
      if (vars) {
        for (const name of Object.keys(vars)) out = out.split('{' + name + '}').join(String(vars[name]))
      }
      return out
    }

    /** Re-render a component when the active locale changes. */
    function useT() {
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => {
        if (localeFace === null || typeof localeFace.subscribe !== 'function') return undefined
        return localeFace.subscribe(() => setVersion((value) => value + 1))
      }, [])
      void version
      return translate
    }

    /** Read a persisted preference without throwing in restricted contexts. */
    function readStore(key, fallback) {
      try {
        const value = localStorage.getItem(key)
        return value === null ? fallback : value
      } catch {
        return fallback
      }
    }

    /** Persist a preference without throwing in restricted contexts. */
    function writeStore(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* Preferences are optional. */
      }
    }

    /** Format a byte count. */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      const text = value >= 100 ? Math.round(value) : value >= 10 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100
      return `${text} ${units[unit]}`
    }

    /** Format `MM-DD HH:mm` (or `YYYY-MM-DD` for other years). */
    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const date = new Date(ms)
      const pad = (value) => String(value).padStart(2, '0')
      const now = new Date()
      if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** Format a wall-clock time of day for the last-updated label. */
    function formatClock(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const date = new Date(ms)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Format a recency phrase. */
    function relativeTime(ms, t) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const diff = Date.now() - ms
      if (diff < 60000) return t('time.justNow')
      const minutes = Math.floor(diff / 60000)
      if (minutes < 60) return fmt(t, 'time.minutes', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return fmt(t, 'time.hours', { n: hours })
      const days = Math.floor(hours / 24)
      if (days < 30) return fmt(t, 'time.days', { n: days })
      return formatTime(ms)
    }

    /** Format one metric value. */
    function formatMetric(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      return value <= 1 ? (value * 100).toFixed(1) : value.toFixed(1)
    }

    /** Average GPU utilization for the training meta line. */
    function averageUtil(gpu) {
      if (!Array.isArray(gpu) || gpu.length === 0) return null
      const values = gpu.map((card) => card.util).filter((value) => typeof value === 'number')
      if (values.length === 0) return null
      return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    }

    /** Last path segment, used for the compact workspace label. */
    function baseName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]/).filter(Boolean)
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    /** Small stroked glyph helper. */
    function glyph(children, size) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, children)
    }

    /** Sidebar panellist glyph (the shell owns the button; only the glyph renders). */
    function PanelIcon(props) {
      const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('rect', { key: 'frame', x: 1.9, y: 2.4, width: 12.2, height: 9.4, rx: 1.8 }),
        h('path', { key: 'line', d: 'M1.9 6.6h12.2' }),
        h('path', { key: 'bars', d: 'M4.4 10.9l1.9-2.1 1.4 1.5 1.5-2.4 2.1 3' }),
        h('path', { key: 'stand', d: 'M6 13.7h4' }),
      ])
    }

    /** Header logo. */
    function Logo() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('rect', { key: 'a', x: 2.8, y: 3.6, width: 18.4, height: 12.6, rx: 2.4 }),
        h('path', { key: 'b', d: 'M5.6 12.4l3.1-3.6 2.2 2.3 1.9-2.8 3.4 3.9' }),
        h('path', { key: 'c', d: 'M8.8 19.8h6.4' }),
      ])
    }

    /** Colored status dot. */
    function Dot({ tone }) {
      return h('span', { className: `dd-dot dd-dot-${tone}` })
    }

    /** Resolve a localized detail line for one item. */
    function itemDetail(item, t) {
      if (item.kind === 'pytest') {
        const counts = item.counts ?? {}
        const parts = []
        if (typeof counts.passed === 'number' && counts.passed > 0) parts.push(fmt(t, 'detail.passed', { n: counts.passed }))
        if (typeof counts.failed === 'number' && counts.failed > 0) parts.push(fmt(t, 'detail.failed', { n: counts.failed }))
        return parts.join(' / ')
      }
      if (item.kind === 'suite') return fmt(t, 'detail.suite', { n: item.fileCount ?? 0 })
      if (item.kind === 'task') return typeof item.detail === 'string' ? item.detail : ''
      if (item.kind === 'transfer') return transferDetail(item, t)
      if (item.kind === 'extract') return extractDetail(item.extract, t)
      if (item.kind === 'session') return typeof item.detail === 'string' && item.detail !== '' ? item.detail : t('detail.session')
      if (item.kind === 'run') {
        const artifacts = Array.isArray(item.artifacts) ? item.artifacts : []
        if (artifacts.length === 0) return t(item.detailKey === 'detail.remoteRunEmpty' ? 'detail.remoteRunEmpty' : 'detail.runEmpty')
        return fmt(t, item.detailKey === 'detail.remoteRun' ? 'detail.remoteRun' : 'detail.run', { list: artifacts.slice(0, 4).join(' · ') })
      }
      if (typeof item.detailKey === 'string' && item.detailKey !== '') return t(item.detailKey)
      return ''
    }

    /** Human duration for transfer rows. */
    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
      const total = Math.round(ms / 1000)
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) return `${minutes}m ${seconds}s`
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }

    /** Arrow + localized direction label. */
    function directionInfo(direction, t) {
      if (direction === 'upload') return { arrow: '↑', label: t('transfer.upload') }
      if (direction === 'download') return { arrow: '↓', label: t('transfer.download') }
      if (direction === 'remote') return { arrow: '⇄', label: t('transfer.remote') }
      if (direction === 'session') return { arrow: '·', label: t('transfer.session') }
      return { arrow: '·', label: t('transfer.unknown') }
    }

    /** One-line transfer summary. */
    function transferDetail(item, t) {
      const transfer = item.transfer === null || item.transfer === undefined ? {} : item.transfer
      const info = directionInfo(transfer.direction, t)
      const parts = [`${info.arrow} ${info.label}`]
      if (transfer.phase === 'done') {
        if (item.size > 0) parts.push(formatBytes(item.size))
        if (typeof transfer.durationMs === 'number') parts.push(formatDuration(transfer.durationMs))
        return parts.join(' · ')
      }
      if (transfer.phase === 'process') {
        if (typeof transfer.alias === 'string' && transfer.alias !== '') parts.push(transfer.alias)
        if ((typeof transfer.sourcePath === 'string' && transfer.sourcePath !== '') || (typeof transfer.destPath === 'string' && transfer.destPath !== '')) {
          parts.push(`${transfer.sourcePath || '?'} → ${transfer.destPath || '?'}`)
        }
        if (typeof transfer.etime === 'string' && transfer.etime !== '') parts.push(fmt(t, 'transfer.elapsed', { value: transfer.etime }))
        return parts.join(' · ')
      }
      parts.push(transfer.phase === 'receiving' ? t('transfer.phaseReceiving') : t('transfer.phaseSending'))
      if (item.size > 0) parts.push(formatBytes(item.size))
      if (typeof transfer.rate === 'number' && transfer.rate > 0) parts.push(fmt(t, 'transfer.rate', { value: formatBytes(transfer.rate) }))
      if (typeof transfer.elapsedMs === 'number') parts.push(fmt(t, 'transfer.elapsed', { value: formatDuration(transfer.elapsedMs) }))
      return parts.join(' · ')
    }

    /** One-line summary for an extraction status row. */
    function extractDetail(extract, t) {
      if (extract === null || extract === undefined) return ''
      const percent = typeof extract.percent === 'number' ? `${extract.percent}%` : null
      const size = formatBytes(extract.bytes)
      const files = typeof extract.files === 'number' ? Number(extract.files).toLocaleString() : '0'
      if (extract.state === 'running') {
        const parts = [percent === null ? t('detail.extractingPlain') : fmt(t, 'detail.extracting', { percent })]
        if (typeof extract.index === 'number' && typeof extract.total === 'number') {
          parts.push(fmt(t, 'detail.extractStep', { index: extract.index, total: extract.total }))
        }
        if (size !== '') parts.push(size)
        if (typeof extract.current === 'string' && extract.current !== '') parts.push(extract.current)
        return parts.join(' · ')
      }
      if (extract.state === 'done') return fmt(t, 'detail.extracted', { files, size })
      if (extract.state === 'partial') return fmt(t, 'detail.extractPartial', { files, size })
      return fmt(t, 'detail.extractPending', { archives: extract.archives ?? 0 })
    }

    /** Inline metric summary for one row. */
    function metricsText(item) {
      if (item.metrics === null || item.metrics === undefined || typeof item.metrics !== 'object') return ''
      return Object.keys(item.metrics).slice(0, 3)
        .map((key) => `${METRIC_LABEL[key] ?? key} ${formatMetric(item.metrics[key])}`)
        .join(' · ')
    }

    /** Copy text to the clipboard, with a legacy fallback. */
    async function copyText(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* Fall through to the legacy path. */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
      } catch {
        return false
      }
    }

    /** Pick the most relevant tab for a first visit. */
    function smartTab(data) {
      if (data === null || data === undefined) return 'tasks'
      if (data.tasks !== null && data.tasks !== undefined) return 'tasks'
      if ((data.tests?.failed ?? 0) > 0) return 'tests'
      if ((data.training?.running ?? 0) > 0) return 'training'
      if ((data.downloads?.running ?? 0) > 0) return 'downloads'
      return 'downloads'
    }

    /** One compact list row. */
    function Row({ item, t, onCopy, onOpen }) {
      const detail = itemDetail(item, t)
      const metrics = metricsText(item)
      const source = item.source === 'remote' ? t('source.remote') : t('source.local')
      const isTask = item.kind === 'task' && item.task !== undefined && item.task !== null
      const isTransfer = item.kind === 'transfer'
      const transferInfo = isTransfer ? directionInfo(item.transfer?.direction, t) : null
      const meta = isTask ? detail : [source, detail, metrics].filter(Boolean).join(' · ')
      const stamp = item.mtime > 0 ? relativeTime(item.mtime, t) : ''
      const absolute = item.mtime > 0 ? formatTime(item.mtime) : ''
      const statusText = isTask
        ? item.status === 'done' ? t('status.done') : item.status === 'pending' ? t('status.pending') : item.status === 'blocked' ? t('status.blocked') : t('status.running')
        : isTransfer
          ? item.status === 'done' ? t('status.done') : t('status.running')
          : item.kind === 'extract' && item.status === 'running'
            ? t('status.extracting')
            : item.status === 'running' ? t('status.running') : item.status === 'failed' ? t('status.failed') : ''
      const copyable = typeof item.path === 'string' && item.path !== ''
      const title = [
        item.name,
        copyable ? item.path : null,
        isTransfer && typeof item.transfer?.command === 'string' ? item.transfer.command : null,
        isTask && typeof item.task.evidence === 'string' ? item.task.evidence : null,
        absolute,
        copyable ? t('row.copyHint') : null,
        t('row.detailHint'),
      ].filter(Boolean).join('\n')
      const rowClass = `dd-row${item.status === 'failed' ? ' dd-row-failed' : item.status === 'running' ? ' dd-row-running' : ''}${isTask && item.task.next === true ? ' dd-row-next' : ''}`
      const extracting = item.kind === 'extract' && item.extract !== null && item.extract !== undefined && typeof item.extract.percent === 'number' && item.extract.state !== 'done'
      const taskBar = isTask && typeof item.task.percent === 'number' && item.task.percent > 0 && item.task.percent < 100
      return h('div', {
        role: 'button',
        tabIndex: 0,
        className: rowClass,
        title,
        onClick: () => onOpen(item),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(item)
          }
        },
      }, [
        h(Dot, { key: 'dot', tone: item.status }),
        h('span', { key: 'main', className: 'dd-row-main' }, [
          h('span', { key: 'title', className: 'dd-row-title' }, [
            h('span', { key: 'name', className: 'dd-row-name' }, item.name),
            isTask && item.task.next === true ? h('span', { key: 'next', className: 'dd-tag dd-tag-next' }, t('task.nextTag')) : null,
            item.kind === 'extract' ? h('span', { key: 'kind', className: 'dd-tag dd-tag-extract' }, t('tag.extract')) : null,
            isTransfer && transferInfo !== null ? h('span', { key: 'direction', className: 'dd-tag dd-tag-transfer' }, `${transferInfo.arrow} ${transferInfo.label}`) : null,
            isTask && item.task.ai === true ? h('span', { key: 'ai', className: 'dd-tag dd-tag-ai', title: item.task.aiDetail ?? '' }, t('tag.ai')) : null,
            item.tag ? h('span', { key: 'tag', className: 'dd-tag', title: item.tag }, item.tag) : null,
          ]),
          h('span', { key: 'meta', className: 'dd-row-meta' }, meta),
          extracting
            ? h('span', { key: 'bar', className: 'dd-row-bar' }, h('span', { className: 'dd-row-fill', style: { width: `${item.extract.percent}%` } }))
            : null,
          taskBar
            ? h('span', { key: 'taskbar', className: 'dd-row-bar' }, h('span', { className: 'dd-row-fill', style: { width: `${item.task.percent}%` } }))
            : null,
          isTransfer && item.status === 'running'
            ? h('span', { key: 'transferbar', className: 'dd-row-bar dd-row-bar-active' }, h('span', { className: 'dd-row-fill' }))
            : null,
        ]),
        h('span', { key: 'side', className: 'dd-row-side' }, [
          statusText === '' ? null : h('span', { key: 'status', className: `dd-row-pill dd-row-pill-${item.status}` }, statusText),
          isTask && typeof item.task.estimate === 'string' && item.task.estimate !== ''
            ? h('span', { key: 'estimate', className: 'dd-row-time' }, fmt(t, 'task.estimate', { value: item.task.estimate }))
            : null,
          item.size > 0 && item.kind !== 'extract' ? h('span', { key: 'size', className: 'dd-row-size' }, formatBytes(item.size)) : null,
          isTransfer && item.status === 'running' ? null : (stamp === '' ? null : h('span', { key: 'time', className: 'dd-row-time' }, stamp)),
          copyable
            ? h('span', {
                key: 'copy',
                className: 'dd-row-copy',
                role: 'button',
                tabIndex: 0,
                'aria-hidden': true,
                onClick: (event) => {
                  event.stopPropagation()
                  onCopy(item)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    onCopy(item)
                  }
                },
              }, h('svg', {
                viewBox: '0 0 16 16',
                width: 13,
                height: 13,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }, [
                h('rect', { key: 'a', x: 5.4, y: 5.4, width: 8, height: 8, rx: 1.5 }),
                h('path', { key: 'b', d: 'M10.6 5.4V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.3c0 .8.6 1.4 1.4 1.4h1.5' }),
              ]))
            : null,
          h('span', { key: 'chev', className: 'dd-row-chev', 'aria-hidden': true }, '›'),
        ]),
      ])
    }

    /** Localized status for the drawer. */
    function statusLabel(item, t) {
      if (item.kind === 'task') return item.status === 'done' ? t('status.done') : item.status === 'pending' ? t('status.pending') : item.status === 'blocked' ? t('status.blocked') : t('status.running')
      if (item.kind === 'transfer') return item.status === 'done' ? t('status.done') : t('status.running')
      if (item.kind === 'extract' && item.status === 'running') return t('status.extracting')
      if (item.status === 'running') return t('status.running')
      if (item.status === 'failed') return t('status.failed')
      if (item.status === 'passed') return t('status.passed')
      if (item.status === 'done') return t('status.done')
      if (item.status === 'blocked') return t('status.blocked')
      return t('status.info')
    }

    /** Localized transfer phase. */
    function phaseLabel(phase, t) {
      if (phase === 'receiving') return t('transfer.phaseReceiving')
      if (phase === 'sending') return t('transfer.phaseSending')
      if (phase === 'process') return t('transfer.phaseProcess')
      if (phase === 'done') return t('status.done')
      return phase ?? ''
    }

    /** Slide-over detail view for one row. */
    function DetailDrawer({ detail, t, onClose, onCopy }) {
      if (detail === null) return null
      const item = detail.item
      const data = detail.data
      const transfer = item.transfer === null || item.transfer === undefined ? null : item.transfer
      const transferInfo = transfer === null ? null : directionInfo(transfer.direction, t)
      const meta = (label, value) => h('div', { key: label, className: 'dd-dmeta' }, [
        h('span', { key: 'label', className: 'dd-dmeta-label' }, label),
        h('span', { key: 'value', className: 'dd-dmeta-value' }, value),
      ])
      const metaRows = [
        meta(t('detail.status'), statusLabel(item, t)),
        meta(t('detail.source'), item.source === 'remote' ? t('source.remote') : t('source.local')),
        meta(t('detail.kind'), item.kind ?? '—'),
        item.size > 0 ? meta(t('detail.size'), formatBytes(item.size)) : null,
        item.mtime > 0 ? meta(t('detail.time'), new Date(item.mtime).toLocaleString()) : null,
      ].filter(Boolean)
      const pathRow = typeof item.path === 'string' && item.path !== ''
        ? h('div', { key: 'path', className: 'dd-dmeta dd-dmeta-path' }, [
            h('span', { key: 'label', className: 'dd-dmeta-label' }, t('detail.path')),
            h('span', { key: 'value', className: 'dd-dmeta-value' }, item.path),
            h('button', { key: 'copy', type: 'button', className: 'dd-dmeta-copy', onClick: () => onCopy(item) }, t('detail.copyPath')),
          ])
        : null
      const metrics = item.metrics !== null && item.metrics !== undefined && typeof item.metrics === 'object'
        ? Object.keys(item.metrics).map(key => meta(METRIC_LABEL[key] ?? key, formatMetric(item.metrics[key])))
        : []
      const taskRows = item.kind === 'task' && item.task !== null && item.task !== undefined
        ? [
            meta(t('detail.taskInfo'), `${item.task.id ?? ''} ${item.task.title ?? ''}`.trim()),
            typeof item.task.percent === 'number' ? meta(t('detail.status'), `${item.task.percent}%`) : null,
            typeof item.task.deliverable === 'string' && item.task.deliverable !== '' ? meta(t('detail.deliverable'), item.task.deliverable) : null,
            typeof item.task.steps === 'string' && item.task.steps !== '' ? meta(t('detail.steps'), item.task.steps) : null,
            typeof item.task.acceptance === 'string' && item.task.acceptance !== '' ? meta(t('detail.acceptance'), item.task.acceptance) : null,
            typeof item.task.dependencies === 'string' && item.task.dependencies !== '' ? meta(t('detail.dependencies'), item.task.dependencies) : null,
            typeof item.task.owner === 'string' && item.task.owner !== '' ? meta(t('detail.owner'), item.task.owner) : null,
            typeof item.task.scope === 'string' && item.task.scope !== '' ? meta(t('detail.scope'), item.task.scope) : null,
            item.task.ai === true ? meta(t('detail.ai'), item.task.aiDetail !== '' ? item.task.aiDetail : item.detail) : null,
            typeof item.task.evidence === 'string' && item.task.evidence !== '' ? meta(t('detail.evidence'), item.task.evidence) : null,
            typeof item.task.estimate === 'string' && item.task.estimate !== '' ? meta(t('detail.estimate'), item.task.estimate) : null,
          ].filter(Boolean)
        : []
      const transferRows = transfer === null
        ? []
        : [
            transferInfo === null ? null : meta(t('detail.direction'), `${transferInfo.arrow} ${transferInfo.label}`),
            typeof transfer.phase === 'string' && transfer.phase !== '' ? meta(t('detail.phase'), phaseLabel(transfer.phase, t)) : null,
            item.size > 0 ? meta(t('detail.bytes'), formatBytes(item.size)) : null,
            typeof transfer.rate === 'number' && transfer.rate > 0 ? meta(t('detail.rate'), `${formatBytes(transfer.rate)}/s`) : null,
            typeof transfer.elapsedMs === 'number' ? meta(t('detail.elapsed'), formatDuration(transfer.elapsedMs)) : null,
            typeof transfer.etime === 'string' && transfer.etime !== '' ? meta(t('detail.elapsed'), transfer.etime) : null,
            typeof transfer.sourcePath === 'string' && transfer.sourcePath !== '' ? meta(t('detail.from'), transfer.sourcePath) : null,
            typeof transfer.destPath === 'string' && transfer.destPath !== '' ? meta(t('detail.to'), transfer.destPath) : null,
            typeof transfer.command === 'string' && transfer.command !== '' ? meta(t('detail.command'), transfer.command) : null,
          ].filter(Boolean)
      const files = data !== null && data !== undefined && Array.isArray(data.files) ? data.files : []
      const listing = data !== null && data !== undefined && typeof data.listing === 'string' ? data.listing.trim() : ''
      const tail = data !== null && data !== undefined && typeof data.tail === 'string' ? data.tail.trim() : ''
      const tailName = data !== null && data !== undefined && typeof data.tailName === 'string' ? data.tailName : ''
      return h('div', { key: 'drawer-wrap', className: 'dd-drawer-wrap' }, [
        h('div', { key: 'backdrop', className: 'dd-backdrop', onClick: onClose }),
        h('aside', { key: 'panel', className: 'dd-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('detail.title') }, [
          h('header', { key: 'head', className: 'dd-drawer-head' }, [
            h('div', { key: 'titles', className: 'dd-drawer-titles' }, [
              h('span', { key: 'name', className: 'dd-drawer-name' }, item.name),
              h('span', { key: 'tags', className: 'dd-drawer-tags' }, [
                h('span', { key: 'status', className: `dd-row-pill dd-row-pill-${item.status}` }, statusLabel(item, t)),
                transferInfo === null ? null : h('span', { key: 'direction', className: 'dd-tag dd-tag-transfer' }, `${transferInfo.arrow} ${transferInfo.label}`),
              ]),
            ]),
            h('button', { key: 'close', type: 'button', className: 'dd-drawer-close', onClick: onClose, 'aria-label': t('detail.close') }, '×'),
          ]),
          h('div', { key: 'body', className: 'dd-drawer-body' }, [
            h('dl', { key: 'meta', className: 'dd-drawer-meta' }, metaRows),
            pathRow,
            taskRows.length === 0 ? null : h('dl', { key: 'task', className: 'dd-drawer-meta' }, taskRows),
            transferRows.length === 0 ? null : h('dl', { key: 'transfer', className: 'dd-drawer-meta' }, transferRows),
            metrics.length === 0 ? null : h('div', { key: 'metrics', className: 'dd-drawer-section' }, [
              h('h3', { key: 'title', className: 'dd-drawer-title' }, t('detail.metrics')),
              h('dl', { key: 'list', className: 'dd-drawer-meta' }, metrics),
            ]),
            detail.loading === true ? h('p', { key: 'loading', className: 'dd-drawer-note' }, t('detail.loading')) : null,
            detail.error !== null && detail.error !== undefined ? h('p', { key: 'error', className: 'dd-drawer-error' }, fmt(t, 'detail.error', { message: detail.error })) : null,
            files.length > 0
              ? h('div', { key: 'files', className: 'dd-drawer-section' }, [
                  h('h3', { key: 'title', className: 'dd-drawer-title' }, t('detail.files')),
                  h('ul', { key: 'list', className: 'dd-dfiles' }, files.map(file => h('li', { key: file.name, className: 'dd-dfile' }, [
                    h('span', { key: 'name', className: 'dd-dfile-name' }, file.name),
                    h('span', { key: 'size', className: 'dd-dfile-size' }, file.dir === true ? t('detail.dir') : formatBytes(file.size)),
                  ]))),
                ])
              : null,
            listing !== ''
              ? h('div', { key: 'listing', className: 'dd-drawer-section' }, [
                  h('h3', { key: 'title', className: 'dd-drawer-title' }, t('detail.dirListing')),
                  h('pre', { key: 'pre', className: 'dd-drawer-pre' }, listing),
                ])
              : null,
            tail !== ''
              ? h('div', { key: 'tail', className: 'dd-drawer-section' }, [
                  h('h3', { key: 'title', className: 'dd-drawer-title' }, tailName === '' ? t('detail.logTail') : `${t('detail.logTail')} · ${tailName}`),
                  h('pre', { key: 'pre', className: 'dd-drawer-pre' }, tail),
                ])
              : null,
            files.length === 0 && listing === '' && tail === '' && data !== null && data !== undefined && data.isDir === true
              ? h('p', { key: 'empty-dir', className: 'dd-drawer-note' }, t('detail.emptyDir'))
              : null,
          ]),
        ]),
      ])
    }

    /** Compact CPU / memory / load summary for one machine. */
    function formatSystem(system, t) {
      if (system === null || system === undefined) return ''
      const parts = []
      if (typeof system.cpu === 'number') parts.push(fmt(t, 'gpu.system', {
        cpu: Math.round(system.cpu),
        used: typeof system.memUsed === 'number' ? (system.memUsed / 1024 ** 3).toFixed(1) : '—',
        total: typeof system.memTotal === 'number' ? Math.round(system.memTotal / 1024 ** 3) : '—',
      }))
      else if (typeof system.memUsed === 'number' && typeof system.memTotal === 'number') {
        parts.push(fmt(t, 'gpu.memOnly', { used: (system.memUsed / 1024 ** 3).toFixed(1), total: Math.round(system.memTotal / 1024 ** 3) }))
      }
      if (Array.isArray(system.load) && system.load.some((value) => typeof value === 'number' && value > 0)) {
        parts.push(fmt(t, 'gpu.load', { load: Number(system.load[0]).toFixed(2) }))
      }
      return parts.join(' · ')
    }

    /** Tiny utilization sparkline from the Host's rolling history. */
    function Sparkline({ values }) {
      if (!Array.isArray(values) || values.length < 2) return null
      const width = 120
      const height = 18
      const points = values.map((value, index) => {
        const x = (index / (values.length - 1)) * width
        const y = height - (Math.max(0, Math.min(100, value)) / 100) * height
        return `${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
      return h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: 16, preserveAspectRatio: 'none', 'aria-hidden': true }, [
        h('polyline', { key: 'line', points, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
      ])
    }

    /** One GPU card: utilization, history, memory, temperature, power, fan, clock and processes. */
    function GpuCard({ card, t }) {
      const util = typeof card.util === 'number' ? Math.max(0, Math.min(100, card.util)) : null
      const used = typeof card.memUsed === 'number' ? Math.round((card.memUsed / 1024) * 10) / 10 : null
      const total = typeof card.memTotal === 'number' ? Math.round(card.memTotal / 1024) : null
      const details = []
      if (used !== null && total !== null) details.push(fmt(t, 'gpu.mem', { used, total }))
      if (typeof card.temp === 'number') details.push(`${Math.round(card.temp)}°C`)
      if (typeof card.power === 'number') details.push(`${Math.round(card.power)}${typeof card.powerLimit === 'number' ? `/${Math.round(card.powerLimit)}` : ''} W`)
      if (typeof card.fan === 'number') details.push(fmt(t, 'gpu.fan', { n: Math.round(card.fan) }))
      if (typeof card.clock === 'number') details.push(`${Math.round(card.clock)} MHz`)
      if (typeof card.memUtil === 'number') details.push(fmt(t, 'gpu.memUtil', { n: Math.round(card.memUtil) }))
      const apps = Array.isArray(card.apps) ? card.apps.filter((app) => typeof app.memory === 'number' && app.memory > 0).slice(0, 2) : []
      const appText = (app) => {
        const label = typeof app.label === 'string' && app.label !== '' ? app.label : baseName(app.name)
        const mib = typeof app.memory === 'number' ? app.memory : 0
        const size = mib >= 1024 ? `${(mib / 1024).toFixed(mib / 1024 >= 10 ? 0 : 1)}G` : `${Math.round(mib)}M`
        return `${label} ${size}`
      }
      const appTitle = apps.map((app) => `${typeof app.pid === 'string' && app.pid !== '' ? `PID ${app.pid} · ` : ''}${app.name} · ${app.memory} MiB`).join('\n')
      const history = card.history !== null && card.history !== undefined && Array.isArray(card.history.util) ? card.history.util : []
      return h('span', { className: 'dd-gpu-card' }, [
        h('span', { key: 'head', className: 'dd-gpu-head' }, [
          h('span', { key: 'name', className: 'dd-gpu-name' }, `${t('gpu.label')}${card.index ?? ''} · ${card.name ?? ''}`),
          h('span', { key: 'util', className: 'dd-gpu-util' }, util === null ? '—' : `${Math.round(util)}%`),
        ]),
        h('span', { key: 'bar', className: 'dd-gpu-bar' }, h('span', { className: 'dd-gpu-fill', style: { width: `${util ?? 0}%` } })),
        history.length < 2 ? null : h('span', { key: 'spark', className: 'dd-gpu-spark' }, h(Sparkline, { values: history })),
        h('span', { key: 'detail', className: 'dd-gpu-detail' }, details.join(' · ')),
        apps.length === 0
          ? null
          : h('span', { key: 'apps', className: 'dd-gpu-apps', title: appTitle }, fmt(t, 'gpu.usage', { list: apps.map(appText).join(' · ') })),
      ])
    }

    /** GPU strip: local + one group per configured remote host. */
    function GpuStrip({ groups, t }) {
      return h('div', { className: 'dd-gpu' }, groups.map((group) => h('div', { key: group.key, className: 'dd-gpu-group' }, [
        h('div', { key: 'head', className: 'dd-gpu-group-head' }, [
          h('span', { key: 'label', className: 'dd-gpu-group-label' }, group.label),
          group.gpus.length > 0 && typeof group.gpus[0].driver === 'string' && group.gpus[0].driver !== ''
            ? h('span', { key: 'driver', className: 'dd-gpu-driver' }, fmt(t, 'gpu.driver', { v: group.gpus[0].driver }))
            : null,
          formatSystem(group.system, t) === ''
            ? null
            : h('span', { key: 'system', className: 'dd-gpu-sys' }, formatSystem(group.system, t)),
        ]),
        group.gpus.length === 0
          ? h('span', { key: 'empty', className: 'dd-gpu-empty' }, group.message)
          : h('div', { key: 'cards', className: 'dd-gpu-cards' }, group.gpus.map((card) => h(GpuCard, { key: String(card.index), card, t }))),
      ])))
    }

    /** Loading skeleton rows. */
    function Skeleton() {
      return h('ul', { className: 'dd-list' }, [0, 1, 2, 3, 4].map((index) => h('li', { key: index, className: 'dd-row dd-row-skeleton' }, [
        h('span', { key: 'dot', className: 'dd-sk-dot' }),
        h('span', { key: 'main', className: 'dd-sk-main' }, [
          h('span', { key: 'a', className: 'dd-sk-line dd-sk-line-wide' }),
          h('span', { key: 'b', className: 'dd-sk-line dd-sk-line-short' }),
        ]),
        h('span', { key: 'side', className: 'dd-sk-line dd-sk-side' }),
      ])))
    }

    /** Byte summary for the downloads stat tile. */
    function sectionSummaryBytes(section) {
      if (section === null || section === undefined) return ''
      return formatBytes(section.bytes)
    }

    /** Prominent plan-progress banner shown above the tab tiles. */
    function TaskHero({ tasks, t, onClick }) {
      if (tasks === null || tasks === undefined || !Array.isArray(tasks.items) || tasks.items.length === 0) return null
      const current = typeof tasks.current === 'string' ? tasks.current : null
      const running = tasks.items.find(entry => entry.status === 'running' && entry.task !== undefined && entry.task.id === current)
        ?? tasks.items.find(entry => entry.status === 'running')
      const next = tasks.items.find(entry => entry.task !== undefined && entry.task.next === true)
      const focus = running ?? next
      const percent = typeof tasks.percent === 'number' ? Math.max(0, Math.min(100, tasks.percent)) : 0
      const meta = fmt(t, 'task.meta', {
        done: tasks.done ?? 0,
        total: tasks.total ?? 0,
        next: tasks.next ?? '—',
      })
      return h('button', { type: 'button', className: 'dd-hero', title: t('task.open'), onClick }, [
        h('span', { key: 'top', className: 'dd-hero-top' }, [
          h('span', { key: 'label', className: 'dd-hero-label' }, t('task.heroLabel')),
          focus === undefined ? null : h('span', { key: 'tag', className: 'dd-hero-tag' }, running !== undefined ? t('task.currentTag') : t('task.nextTag')),
          h('span', { key: 'pct', className: 'dd-hero-pct' }, `${percent}%`),
        ]),
        h('span', { key: 'title', className: 'dd-hero-title' }, focus === undefined ? '' : focus.name),
        h('span', { key: 'bar', className: 'dd-hero-bar' }, h('span', { className: 'dd-hero-fill', style: { width: `${percent}%` } })),
        h('span', { key: 'steps', className: 'dd-hero-steps' }, tasks.items.map(entry => h('span', {
          key: entry.id,
          className: `dd-hero-step dd-hero-step-${entry.status}`,
          title: `${entry.name} · ${entry.status}`,
        }))),
        h('span', { key: 'foot', className: 'dd-hero-foot' }, [
          h('span', { key: 'meta' }, meta),
          focus === undefined || focus.task === undefined || typeof focus.task.estimate !== 'string' || focus.task.estimate === ''
            ? null
            : h('span', { key: 'est', className: 'dd-hero-est' }, fmt(t, 'task.estimate', { value: focus.task.estimate })),
        ]),
      ])
    }

    /** The compact dashboard page mounted in the keyed `main` seat. */
    function PanelPage() {
      const t = useT()
      const [state, setState] = React.useState({ data: null, error: null, refreshing: false })
      const [tab, setTab] = React.useState(() => {
        const stored = readStore(STORE_TAB, '')
        return TABS.includes(stored) ? stored : null
      })
      const [source, setSource] = React.useState(() => {
        const stored = readStore(STORE_SOURCE, 'all')
        return stored === 'local' || stored === 'remote' ? stored : 'all'
      })
      const [toast, setToast] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [transferData, setTransferData] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const alive = React.useRef(true)
      const busy = React.useRef(false)

      const load = React.useCallback(async (force) => {
        if (busy.current) return
        busy.current = true
        if (alive.current && force) setState((previous) => ({ ...previous, refreshing: true }))
        try {
          const response = await fetch(force ? `${API}/refresh` : `${API}/state`, {
            method: force ? 'POST' : 'GET',
            cache: 'no-store',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          if (alive.current) setState({ data, error: null, refreshing: false })
        } catch (error) {
          if (alive.current) {
            setState((previous) => ({
              data: previous.data,
              error: error instanceof Error ? error.message : String(error),
              refreshing: false,
            }))
          }
        } finally {
          busy.current = false
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        let cancelled = false
        const tick = () => {
          if (!cancelled && document.visibilityState !== 'hidden') void load(false)
        }
        tick()
        const timer = setInterval(tick, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState !== 'hidden') void load(false)
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          cancelled = true
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [load])

      React.useEffect(() => {
        let cancelled = false
        const tick = async () => {
          try {
            const response = await fetch(`${API}/transfers`, { cache: 'no-store', headers: { accept: 'application/json' } })
            if (!response.ok) return
            const payload = await response.json()
            if (!cancelled) setTransferData(payload)
          } catch {
            /* Transfers stay on the last known state. */
          }
        }
        void tick()
        const timer = setInterval(tick, 2000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [])

      React.useEffect(() => {
        if (tab !== null) writeStore(STORE_TAB, tab)
      }, [tab])

      React.useEffect(() => {
        writeStore(STORE_SOURCE, source)
      }, [source])

      React.useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 1800)
        return () => clearTimeout(timer)
      }, [toast])

      const data = state.data
      const transfers = transferData !== null ? transferData : (data?.transfers ?? null)

      React.useEffect(() => {
        if (tab === null && data !== null) setTab(smartTab(data))
      }, [tab, data])

      React.useEffect(() => {
        if (source === 'remote' && data !== null && data.remote?.enabled !== true) setSource('all')
      }, [source, data])

      const activeTab = tab ?? 'tasks'
      const isTasks = activeTab === 'tasks'
      const activeSection = data === null
        ? null
        : isTasks
          ? { items: data.tasks?.items ?? [] }
          : activeTab === 'transfers'
            ? { items: [...(transfers?.active ?? []), ...(transfers?.completed ?? [])] }
            : data[activeTab]
      const all = Array.isArray(activeSection?.items) ? activeSection.items : []
      const items = isTasks || source === 'all' ? all : all.filter((entry) => entry.source === source)
      const needle = query.trim().toLowerCase()
      const visibleItems = needle === '' ? items : items.filter((entry) => `${entry.name} ${entry.detail ?? ''} ${entry.path ?? ''}`.toLowerCase().includes(needle))
      const noMatches = needle !== '' && items.length > 0 && visibleItems.length === 0
      const local = data?.local
      const remote = data?.remote
      const remoteEnabled = remote !== undefined && remote !== null && remote.enabled === true
      const localTone = local === undefined || local === null ? 'off' : local.ok === true ? 'ok' : 'bad'
      const remoteTone = remoteEnabled === false ? 'off' : remote?.ok === true ? 'ok' : 'bad'
      const gpuData = data?.gpu ?? null
      const localInfo = gpuData?.local ?? null
      const localGpus = Array.isArray(localInfo?.gpus) ? localInfo.gpus : []
      const remoteInfos = Array.isArray(gpuData?.remotes)
        ? gpuData.remotes
        : gpuData?.remote
          ? [{ alias: remote?.alias ?? '', host: remote?.host ?? '', available: gpuData.remote.available, gpus: gpuData.remote.gpus ?? [], system: null }]
          : []
      const remoteGpus = remoteInfos.flatMap((entry) => (Array.isArray(entry.gpus) ? entry.gpus : []))
      const statGpus = source === 'local' ? localGpus : remoteGpus
      const gpuGroups = []
      if (gpuData !== null) {
        if (source !== 'remote' && localInfo !== null) {
          if (localGpus.length > 0) {
            gpuGroups.push({ key: 'local', label: t('source.local'), gpus: localGpus, system: localInfo.system })
          } else if (localInfo.available === false) {
            gpuGroups.push({ key: 'local', label: t('source.local'), gpus: [], system: localInfo.system, message: localInfo.error === 'local scan disabled' ? t('state.off') : t('gpu.noLocal') })
          }
        }
        if (source !== 'local' && remoteEnabled) {
          for (const entry of remoteInfos) {
            const label = entry.host !== '' ? `${entry.alias} · ${entry.host}` : entry.alias
            gpuGroups.push({
              key: `remote:${entry.alias}`,
              label,
              gpus: Array.isArray(entry.gpus) ? entry.gpus : [],
              system: entry.system,
              message: entry.available === false ? t('gpu.noRemote') : t('gpu.noGpu'),
            })
          }
        }
      }

      const copy = React.useCallback(async (item) => {
        const ok = await copyText(item.path)
        setToast({ id: Date.now(), message: t(ok ? 'toast.copied' : 'toast.copyFailed') })
      }, [t])

      const openDetail = React.useCallback(async (item) => {
        setDetail({ item, data: null, loading: true, error: null })
        if (typeof item.path !== 'string' || item.path === '' || item.kind === 'transfer') {
          setDetail({ item, data: null, loading: false, error: null })
          return
        }
        try {
          const url = `${API}/detail?source=${encodeURIComponent(item.source ?? 'local')}&path=${encodeURIComponent(item.path)}&kind=${encodeURIComponent(item.kind ?? '')}`
          const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          setDetail({ item, data: payload, loading: false, error: null })
        } catch (error) {
          setDetail({ item, data: null, loading: false, error: error instanceof Error ? error.message : String(error) })
        }
      }, [])

      React.useEffect(() => {
        if (detail === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setDetail(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [detail])

      const warnings = []
      if (state.error !== null) warnings.push(h('div', { key: 'load', className: 'dd-warn' }, fmt(t, 'error.load', { message: state.error })))
      if (local?.ok === false && typeof local.error === 'string') warnings.push(h('div', { key: 'local', className: 'dd-warn' }, fmt(t, 'error.local', { message: local.error })))
      if (remoteEnabled && remote.ok === false && typeof remote.error === 'string') warnings.push(h('div', { key: 'remote', className: 'dd-warn' }, fmt(t, 'error.remote', { message: remote.error })))

      const statMeta = {
        tasks: (() => {
          if (data?.tasks === null || data?.tasks === undefined) return ''
          if (data.tasks.running === true && data.tasks.current !== null) {
            return fmt(t, 'task.tileRunning', { current: data.tasks.current, next: data.tasks.next ?? '—' })
          }
          return data.tasks.next !== null
            ? fmt(t, 'task.tileMeta', { percent: data.tasks.percent, next: data.tasks.next })
            : fmt(t, 'task.tileDone', { percent: data.tasks.percent })
        })(),
        downloads: (() => {
          const parts = []
          const bytes = sectionSummaryBytes(data?.downloads)
          if (bytes !== '') parts.push(bytes)
          if ((data?.downloads?.running ?? 0) > 0) parts.push(fmt(t, 'stat.running', { n: data.downloads.running }))
          return parts.join(' · ')
        })(),
        training: (() => {
          const parts = []
          if ((data?.training?.running ?? 0) > 0) parts.push(fmt(t, 'stat.running', { n: data.training.running }))
          const util = averageUtil(statGpus)
          if (util !== null) parts.push(fmt(t, 'stat.gpu', { n: util }))
          return parts.join(' · ')
        })(),
        tests: (() => {
          const parts = []
          if ((data?.tests?.passed ?? 0) > 0) parts.push(fmt(t, 'stat.passed', { n: data.tests.passed }))
          if ((data?.tests?.failed ?? 0) > 0) parts.push(fmt(t, 'stat.failed', { n: data.tests.failed }))
          return parts.join(' · ')
        })(),
        transfers: (() => {
          const active = transfers?.active?.length ?? 0
          const done = transfers?.completed?.length ?? 0
          return active > 0 ? fmt(t, 'stat.transferActive', { n: active }) : fmt(t, 'stat.transferDone', { n: done })
        })(),
      }

      const statTone = {
        tasks: data?.tasks?.running === true ? 'run' : null,
        downloads: (data?.downloads?.running ?? 0) > 0 ? 'run' : null,
        training: (data?.training?.running ?? 0) > 0 ? 'run' : null,
        tests: (data?.tests?.failed ?? 0) > 0 ? 'bad' : null,
        transfers: (transfers?.active?.length ?? 0) > 0 ? 'run' : null,
      }

      return h('div', { className: 'dd-page' }, [
        h('style', { key: 'css' }, CSS),
        h('div', { key: 'shell', className: 'dd-shell' }, [
          h('header', { key: 'head', className: 'dd-head' }, [
            h('span', { key: 'logo', className: 'dd-logo' }, h(Logo)),
            h('div', { key: 'titles', className: 'dd-titles' }, [
              h('h1', { key: 'title', className: 'dd-title' }, t('page.title')),
              h('p', { key: 'sub', className: 'dd-sub' }, t('page.subtitle')),
            ]),
            h('span', { key: 'updated', className: 'dd-updated', title: data === null ? '' : new Date(data.generatedAt).toLocaleString() },
              data === null ? t('page.loading') : fmt(t, 'page.updatedAt', { time: formatClock(data.generatedAt) })),
            h('button', {
              key: 'back',
              type: 'button',
              className: 'dd-iconbtn',
              title: t('page.back'),
              'aria-label': t('page.back'),
              onClick: () => {
                if (layoutFace !== null && typeof layoutFace.selectPanel === 'function') layoutFace.selectPanel('conversation')
              },
            }, h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
              h('path', { key: 'a', d: 'M10 3.5L5.5 8l4.5 4.5' }),
            ])),
            h('button', {
              key: 'refresh',
              type: 'button',
              className: `dd-iconbtn${state.refreshing ? ' dd-spin' : ''}`,
              title: t('page.refresh'),
              'aria-label': t('page.refresh'),
              onClick: () => { void load(true) },
            }, h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
              h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.55-3.63' }),
              h('path', { key: 'b', d: 'M13 2.6V6H9.6' }),
            ])),
          ]),
          h('div', { key: 'status', className: 'dd-status' }, [
            h('span', { key: 'local', className: 'dd-schip', title: local?.root ?? '' }, [
              h(Dot, { key: 'dot', tone: localTone }),
              h('span', { key: 'label', className: 'dd-schip-label' }, t('source.local')),
              h('span', { key: 'value', className: 'dd-schip-value' }, local?.ok === true ? baseName(local.root) : local === null || local === undefined ? t('state.off') : t('state.fail')),
            ]),
            remoteEnabled
              ? h('span', { key: 'remote', className: 'dd-schip', title: remote?.error ?? remote?.alias ?? '' }, [
                  h(Dot, { key: 'dot', tone: remoteTone }),
                  h('span', { key: 'label', className: 'dd-schip-label' }, t('source.remote')),
                  h('span', { key: 'value', className: 'dd-schip-value' }, remote?.ok === true ? (remote.host !== '' ? remote.host : remote.alias) : t('state.fail')),
                ])
              : null,
            h('span', { key: 'spacer', className: 'dd-spacer' }),
            h('span', { key: 'auto', className: 'dd-hint' }, fmt(t, 'page.autoRefresh', { seconds: Math.round((data?.refreshMs ?? POLL_MS) / 1000) })),
          ]),
          warnings.length === 0 ? null : h('div', { key: 'warnings', className: 'dd-warnings' }, warnings),
          h(TaskHero, { key: 'hero', tasks: data?.tasks, t, onClick: () => setTab('tasks') }),
          h('div', { key: 'stats', className: 'dd-stats', role: 'tablist' }, TABS.map((key) => h('button', {
            key,
            type: 'button',
            role: 'tab',
            'aria-selected': activeTab === key,
            className: `dd-stat${activeTab === key ? ' dd-stat-active' : ''}`,
            onClick: () => setTab(key),
          }, [
            h('span', { key: 'label', className: 'dd-stat-label' }, [
              h('span', { key: 'icon', className: 'dd-stat-icon' }, STAT_ICONS[key]),
              h('span', { key: 'text' }, t(`section.${key}`)),
              statTone[key] === null ? null : h('span', { key: 'dot', className: `dd-sdot dd-sdot-${statTone[key]}` }),
            ]),
            h('span', { key: 'value', className: 'dd-stat-value' }, data === null
              ? '—'
              : key === 'tasks'
                ? `${data.tasks?.done ?? 0}/${data.tasks?.total ?? 0}`
                : key === 'transfers'
                  ? String(transfers?.active?.length ?? 0)
                  : String(data[key]?.count ?? 0)),
            h('span', { key: 'meta', className: 'dd-stat-meta' }, statMeta[key]),
          ]))),
          h('section', { key: 'panel', className: 'dd-panel', role: 'tabpanel' }, [
            h('div', { key: 'toolbar', className: 'dd-toolbar' }, [
              h('span', { key: 'title', className: 'dd-pane-title' }, t(`section.${activeTab}`)),
              h('span', { key: 'count', className: 'dd-pane-count' }, isTasks
                ? fmt(t, 'task.panelCount', { done: data?.tasks?.done ?? 0, total: data?.tasks?.total ?? 0 })
                : activeTab === 'transfers'
                  ? fmt(t, 'transfer.panelCount', { active: transfers?.active?.length ?? 0, done: transfers?.completed?.length ?? 0 })
                  : source === 'all'
                    ? fmt(t, 'summary.items', { n: visibleItems.length })
                    : fmt(t, 'count.filtered', { shown: visibleItems.length, total: all.length })),
              h('span', { key: 'spacer', className: 'dd-spacer' }),
              h('input', {
                key: 'search',
                className: 'dd-search',
                type: 'search',
                value: query,
                placeholder: t('filter.search'),
                'aria-label': t('filter.search'),
                onChange: (event) => setQuery(event.target.value),
              }),
              activeTab === 'transfers' && (transfers?.completed?.length ?? 0) > 0
                ? h('button', {
                    key: 'clear-transfers',
                    type: 'button',
                    className: 'dd-clear',
                    onClick: async () => {
                      try {
                        const response = await fetch(`${API}/transfers/clear`, { method: 'POST', cache: 'no-store', headers: { accept: 'application/json' } })
                        if (response.ok) setTransferData(await response.json())
                      } catch {
                        /* Keep the last known list. */
                      }
                    },
                  }, t('transfer.clear'))
                : null,
              isTasks
                ? null
                : h('div', { key: 'seg', className: 'dd-seg', role: 'group', 'aria-label': t('filter.label') }, [
                    h('button', { key: 'all', type: 'button', className: `dd-seg-btn${source === 'all' ? ' dd-seg-active' : ''}`, onClick: () => setSource('all') }, t('filter.all')),
                    h('button', { key: 'local', type: 'button', className: `dd-seg-btn${source === 'local' ? ' dd-seg-active' : ''}`, onClick: () => setSource('local') }, t('filter.local')),
                    remoteEnabled ? h('button', { key: 'remote', type: 'button', className: `dd-seg-btn${source === 'remote' ? ' dd-seg-active' : ''}`, onClick: () => setSource('remote') }, t('filter.remote')) : null,
                  ]),
            ]),
            activeTab === 'training' && gpuGroups.length > 0 ? h(GpuStrip, { key: 'gpu', groups: gpuGroups, t }) : null,
            data === null && state.error === null
              ? h(Skeleton, { key: 'skeleton' })
              : visibleItems.length === 0
                ? h('p', { key: 'empty', className: 'dd-empty' }, noMatches ? t('empty.search') : all.length > 0 ? t('empty.filtered') : t(`empty.${activeTab}`))
                : h('ul', { key: 'list', className: 'dd-list' }, visibleItems.map((entry) => h(Row, { key: entry.id, item: entry, t, onCopy: copy, onOpen: openDetail }))),
          ]),
          h('footer', { key: 'foot', className: 'dd-foot' }, [
            h('span', { key: 'hint' }, t('foot.hint')),
            isTasks && data?.tasks?.ai?.enabled === true
              ? h('span', { key: 'ai', className: 'dd-ai-hint', title: data.tasks.ai.error ?? data.tasks.ai.model ?? '' }, data.tasks.ai.pending === true
                  ? t('task.aiPending')
                  : fmt(t, 'task.aiUsage', { n: data.tasks.ai.count ?? 0, tokens: data.tasks.ai.usage?.totalTokens ?? 0 }))
              : null,
          ]),
        ]),
        h(DetailDrawer, { key: 'drawer', detail, t, onClose: () => setDetail(null), onCopy: copy }),
        toast === null ? null : h('div', { key: 'toast', className: 'dd-toast' }, toast.message),
      ])
    }

    /** Install locale dictionaries and both slot seats. */
    function apply(ctx) {
      try {
        localeFace = ctx.locale
      } catch {
        localeFace = null
      }
      try {
        layoutFace = ctx.layout
      } catch {
        layoutFace = null
      }
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dino-dashboard: dictionaries')
      } catch {
        /* A host without the locale service still renders the Chinese defaults. */
      }
      try {
        translate = ctx.locale.bind(NS)
      } catch {
        translate = (key) => key
      }
      ctx.effect(() => {
        const disposers = [
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 35,
            label: () => translate('entry.label'),
          }, PanelIcon)),
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
          }, PanelPage)),
        ]
        return () => {
          for (const dispose of disposers) dispose()
        }
      }, 'dino-dashboard: seats')
    }

    const CSS = [
      '.dd-page{box-sizing:border-box;height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;padding:20px 28px 14px}',
      '.dd-shell{flex:1;min-height:0;width:100%;max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:13px}',
      '.dd-head{display:flex;align-items:center;gap:12px;flex:none}',
      '.dd-logo{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}',
      '.dd-titles{flex:1;min-width:0}',
      '.dd-title{margin:0;font-size:18px;line-height:1.2;font-weight:650;letter-spacing:.2px}',
      '.dd-sub{margin:2px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-updated{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dd-iconbtn{flex:none;display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .15s,border-color .15s}',
      '.dd-iconbtn:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l2)}',
      '.dd-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dd-spin svg{animation:dd-spin .8s linear infinite}',
      '@keyframes dd-spin{to{transform:rotate(360deg)}}',
      '.dd-status{display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:none;min-height:18px}',
      '.dd-schip{display:inline-flex;align-items:center;gap:6px;max-width:300px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dd-schip-value{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dd-dot-ok,.dd-dot-done,.dd-dot-passed{background:var(--dsw-alias-state-success-primary)}',
      '.dd-dot-running{background:var(--dsw-alias-state-warn-primary)}',
      '.dd-dot-failed,.dd-dot-bad{background:var(--dsw-alias-state-error-primary)}',
      '.dd-spacer{flex:1}',
      '.dd-hint{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.dd-warnings{display:flex;flex-direction:column;gap:4px;flex:none}',
      '.dd-warn{font-size:12px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:7px;padding:5px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-hero{display:flex;flex-direction:column;gap:5px;width:100%;text-align:left;border:1px solid var(--dsw-alias-brand-primary);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;padding:11px 15px;flex:none;cursor:pointer;transition:background .15s}',
      '.dd-hero:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dd-hero:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dd-hero-top{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dd-hero-label{font-size:11.5px;letter-spacing:.3px;color:var(--dsw-alias-label-secondary)}',
      '.dd-hero-tag{font-size:10.5px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);white-space:nowrap}',
      '.dd-hero-pct{margin-left:auto;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary)}',
      '.dd-hero-title{font-size:15px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-hero-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-base);overflow:hidden}',
      '.dd-hero-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .4s ease}',
      '.dd-hero-steps{display:flex;gap:3px;margin-top:1px}',
      '.dd-hero-step{flex:1;height:3px;border-radius:2px;background:var(--dsw-alias-border-l1)}',
      '.dd-hero-step-done{background:var(--dsw-alias-state-success-primary)}',
      '.dd-hero-step-running{background:var(--dsw-alias-state-warn-primary)}',
      '.dd-hero-foot{display:flex;align-items:center;gap:10px;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-hero-foot>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-hero-est{margin-left:auto;white-space:nowrap}',
      '.dd-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;flex:none}',
      '.dd-stat{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 14px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}',
      '.dd-stat:hover{border-color:var(--dsw-alias-border-l2)}',
      '.dd-stat:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dd-stat-active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dd-stat-active::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary)}',
      '.dd-stat-label{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-stat-icon{display:grid;place-items:center;color:var(--dsw-alias-label-secondary)}',
      '.dd-stat-active .dd-stat-icon{color:var(--dsw-alias-brand-primary)}',
      '.dd-sdot{width:6px;height:6px;border-radius:50%;flex:none;display:inline-block}',
      '.dd-sdot-run{background:var(--dsw-alias-state-warn-primary)}',
      '.dd-sdot-bad{background:var(--dsw-alias-state-error-primary)}',
      '.dd-stat-value{font-size:26px;line-height:1.1;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.3px}',
      '.dd-stat-meta{width:100%;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:17px}',
      '.dd-panel{flex:1;min-height:160px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dd-toolbar{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);flex:none}',
      '.dd-search{width:160px;min-width:90px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:18px;padding:2px 8px;outline:none}',
      '.dd-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dd-search::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.dd-clear{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;font:inherit;font-size:10.5px;line-height:18px;padding:2px 7px;cursor:pointer;white-space:nowrap}',
      '.dd-clear:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dd-pane-title{font-size:14px;font-weight:600}',
      '.dd-pane-count{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dd-seg{display:flex;gap:2px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-base)}',
      '.dd-seg-btn{appearance:none;border:0;border-radius:5px;padding:3px 10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.dd-seg-btn:hover{color:var(--dsw-alias-label-primary)}',
      '.dd-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.dd-seg-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dd-gpu{display:flex;flex-direction:column;gap:7px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}',
      '.dd-gpu-group{display:flex;flex-direction:column;gap:5px}',
      '.dd-gpu-group-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.dd-gpu-sys{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dd-gpu-group-label{font-size:11.5px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.dd-gpu-driver{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-gpu-cards{display:flex;gap:8px;flex-wrap:wrap}',
      '.dd-gpu-card{flex:1 1 240px;min-width:210px;display:flex;flex-direction:column;gap:4px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.dd-gpu-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px}',
      '.dd-gpu-name{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-gpu-util{font-weight:650;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}',
      '.dd-gpu-bar{height:4px;border-radius:3px;background:var(--dsw-alias-bg-base);overflow:hidden}',
      '.dd-gpu-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .4s ease}',
      '.dd-gpu-detail{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dd-gpu-spark{display:block;height:16px;color:var(--dsw-alias-brand-primary);opacity:.8}',
      '.dd-gpu-apps{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dd-gpu-empty{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dd-list{list-style:none;margin:0;padding:0;flex:1;min-height:0;overflow:auto}',
      '.dd-row{display:flex;align-items:center;width:100%;gap:11px;padding:10px 14px;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .12s}',
      '.dd-row:first-child{border-top:0}',
      '.dd-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dd-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dd-row-failed{box-shadow:inset 3px 0 0 var(--dsw-alias-state-error-primary)}',
      '.dd-row-running{box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary)}',
      '.dd-row-skeleton{cursor:default}',
      '.dd-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.dd-row-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:550;line-height:1.4}',
      '.dd-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-tag{flex:none;font-size:10.5px;line-height:17px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dd-tag-extract{color:var(--dsw-alias-brand-primary)}',
      '.dd-tag-transfer{color:var(--dsw-alias-brand-primary)}',
      '.dd-tag-ai{color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary);border-radius:4px;padding:0 3px}',
      '.dd-tag-next{color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base)}',
      '.dd-row-next{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}',
      '.dd-row-meta{font-size:12.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}',
      '.dd-row-bar{display:block;height:4px;margin-top:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.dd-row-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .4s ease}',
      '.dd-row-bar-active .dd-row-fill{width:35%;animation:dd-transfer 1.1s ease-in-out infinite alternate}',
      '@keyframes dd-transfer{from{transform:translateX(0);opacity:.45}to{transform:translateX(185%);opacity:1}}',
      '.dd-row-side{flex:none;display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dd-row-pill{font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}',
      '.dd-row-pill-running{color:var(--dsw-alias-state-warn-primary)}',
      '.dd-row-pill-done{color:var(--dsw-alias-state-success-primary)}',
      '.dd-row-pill-pending{color:var(--dsw-alias-label-secondary)}',
      '.dd-row-pill-failed{color:var(--dsw-alias-state-error-primary)}',
      '.dd-row-pill-blocked{color:var(--dsw-alias-state-warn-primary)}',
      '.dd-row-size{color:var(--dsw-alias-label-secondary)}',
      '.dd-row-time{color:var(--dsw-alias-label-secondary)}',
      '.dd-row-copy{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);opacity:0;transition:opacity .12s}',
      '.dd-row:hover .dd-row-copy,.dd-row-copy:focus-visible{opacity:1}',
      '.dd-row-copy:hover{color:var(--dsw-alias-brand-primary)}',
      '.dd-row-chev{margin-left:2px;color:var(--dsw-alias-label-secondary);font-size:17px;line-height:1;opacity:.35}',
      '.dd-row:hover .dd-row-chev{opacity:.75}',
      '.dd-drawer-wrap{position:fixed;inset:0;z-index:60}',
      '.dd-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.22)}',
      '.dd-drawer{position:absolute;top:0;right:0;bottom:0;width:min(560px,94vw);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-16px 0 40px rgba(0,0,0,.18)}',
      '.dd-drawer-head{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}',
      '.dd-drawer-titles{min-width:0;display:flex;flex-direction:column;gap:5px}',
      '.dd-drawer-name{font-size:14px;font-weight:650;line-height:19px;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.dd-drawer-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dd-drawer-close{margin-left:auto;flex:none;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:17px;line-height:1;cursor:pointer}',
      '.dd-drawer-close:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dd-drawer-body{padding:13px 14px 20px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      '.dd-drawer-meta{margin:0;display:flex;flex-direction:column;gap:4px}',
      '.dd-dmeta{display:flex;align-items:baseline;gap:8px;font-size:11.5px;line-height:17px}',
      '.dd-dmeta-label{flex:none;min-width:64px;color:var(--dsw-alias-label-secondary)}',
      '.dd-dmeta-value{min-width:0;color:var(--dsw-alias-label-primary);word-break:break-all;white-space:pre-wrap}',
      '.dd-dmeta-path{align-items:center}',
      '.dd-dmeta-copy{flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:16px;padding:1px 6px;cursor:pointer}',
      '.dd-dmeta-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dd-drawer-section{display:flex;flex-direction:column;gap:6px}',
      '.dd-drawer-title{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}',
      '.dd-drawer-pre{margin:0;padding:9px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;line-height:15px;white-space:pre-wrap;word-break:break-all;max-height:340px;overflow:auto}',
      '.dd-drawer-note{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-drawer-error{margin:0;font-size:11.5px;color:var(--dsw-alias-state-error-primary)}',
      '.dd-dfiles{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
      '.dd-dfile{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px}',
      '.dd-dfile:first-child{border-top:0}',
      '.dd-dfile-name{min-width:0;word-break:break-all}',
      '.dd-dfile-size{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dd-row:hover .dd-row-copy{opacity:.8}',
      '.dd-empty{margin:0;flex:1;display:grid;place-items:center;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.dd-foot{display:flex;align-items:center;gap:10px;flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dd-ai-hint{margin-left:auto;color:var(--dsw-alias-brand-primary);white-space:nowrap}',
      '.dd-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:40;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 15px;font-size:13px;color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.22)}',
      '.dd-sk-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-bg-layer-2)}',
      '.dd-sk-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}',
      '.dd-sk-line{display:block;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);animation:dd-pulse 1.1s ease-in-out infinite}',
      '.dd-sk-line-wide{width:56%}',
      '.dd-sk-line-short{width:34%}',
      '.dd-sk-side{width:52px;flex:none}',
      '@keyframes dd-pulse{0%,100%{opacity:.55}50%{opacity:1}}',
      '@media (max-width:900px){.dd-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.dd-hero-title{font-size:14px}.dd-search{width:120px}}',
      '@media (max-width:600px){.dd-drawer{width:100%}}',
      '@media (max-width:760px){.dd-page{padding:14px 16px 10px}.dd-stat-value{font-size:22px}.dd-schip{max-width:200px}.dd-pane-title{display:none}}',
    ].join('')

    return {
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
  },
})
