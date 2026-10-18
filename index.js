/**
 * dino-dashboard — Host half.
 *
 * Serves a read-only JSON snapshot of the project's download, training and
 * test/evaluation information:
 *   - the local workspace (filesystem scan, bounded: no recursive walks of
 *     multi-hundred-GB experiment trees),
 *   - an optional remote host reached through the installed dsh-ssh plugin's
 *     loopback `/api/dsh-ssh/exec` route (so no SSH library or credentials are
 *     duplicated here).
 *
 * Routes (loopback only):
 *   GET  /api/dino-dashboard/state    cached snapshot (rebuilt when stale)
 *   POST /api/dino-dashboard/refresh  force a rebuild
 *
 * The Client half (client.js) renders the sidebar entry and the dashboard page.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

/** Services required before the routes can mount. */
export const inject = ['webServer']

/** Default workspace; empty means the DSH default working directory at runtime. */
const DEFAULT_LOCAL_ROOT = ''
/** Default dsh-ssh host alias; empty disables remote scanning. */
const DEFAULT_REMOTE_ALIAS = ''

/** Remote roots scanned by the Python probe; configured by the plugin row. */
const DEFAULT_REMOTE_ROOTS = {
  downloadRoot: '',
  trainingRoot: '',
  logRoot: '',
}

/** Local directories whose entries are reported as download information. */
const LOCAL_DOWNLOAD_DIRS = ['.downloads', 'weights']
/** Local directories whose immediate children are reported as training runs. */
const LOCAL_TRAIN_ROOTS = ['outputs', 'experiments', 'runs']
/** File names that mark a training/package directory as having produced output. */
const ARTIFACT_NAMES = [
  'metrics.json',
  'training_state.pt',
  'student.pt',
  'package_manifest.json',
  'config_resolved.yaml',
  'predictions.pt',
  'compliance.json',
  'provenance.json',
]
/** Suffixes of files a downloader leaves behind while a transfer is running. */
const PARTIAL_SUFFIXES = ['.part', '.aria2', '.crdownload', '.tmp', '.download', '.partial']

/** Hard caps that keep one snapshot cheap even on a large project tree. */
const LIMITS = {
  downloadEntries: 60,
  directoryFiles: 1500,
  directoryDepth: 4,
  trainingChildren: 80,
  maxItemsPerSection: 16,
  jsonBytes: 262144,
}

/**
 * Python probe executed on the remote host through dsh-ssh. It prints one
 * `@@DINO@@`-prefixed JSON line; all parsing stays on the Host so this script
 * is a pure, read-only filesystem reporter.
 */
const PY_PROBE = String.raw`
import json, os, re, shlex, subprocess, time

CFG = __CFG__

def sh(cmd, timeout=8):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or '').strip()
    except Exception:
        return ''

def stat_item(path, name):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return {'p': name, 's': st.st_size, 'm': int(st.st_mtime)}

def download_entries(root, limit=120):
    out = []
    if not os.path.isdir(root):
        return out
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for name in names:
        p = os.path.join(root, name)
        if os.path.isdir(p):
            item = stat_item(p, name + '/')
            if item is not None:
                item['dir'] = True
                item['s'] = 0
                out.append(item)
            try:
                kids = sorted(os.listdir(p))[:40]
            except OSError:
                kids = []
            for kid in kids:
                cp = os.path.join(p, kid)
                if os.path.isfile(cp):
                    it = stat_item(cp, name + '/' + kid)
                    if it is not None:
                        out.append(it)
        else:
            it = stat_item(p, name)
            if it is not None:
                out.append(it)
    out.sort(key=lambda x: x['m'], reverse=True)
    return out[:limit]

def partial_files(root, limit=40, max_dirs=200):
    out = []
    if not os.path.isdir(root):
        return out
    dirs = 0
    suffixes = ('.part', '.aria2', '.crdownload', '.tmp', '.download', '.partial')
    for dirpath, dirnames, filenames in os.walk(root):
        dirs += 1
        if dirs > max_dirs:
            dirnames[:] = []
            break
        for name in filenames:
            if name.lower().endswith(suffixes):
                p = os.path.join(dirpath, name)
                rel = os.path.relpath(p, root).replace(os.sep, '/')
                it = stat_item(p, rel)
                if it is not None:
                    out.append(it)
        if len(out) >= limit:
            break
    return out[:limit]

def top_entries(root, hints, limit=60):
    out = []
    if not os.path.isdir(root):
        return out
    try:
        names = sorted(os.listdir(root))[:limit]
    except OSError:
        return out
    for name in names:
        p = os.path.join(root, name)
        it = stat_item(p, name)
        if it is None:
            continue
        if os.path.isdir(p):
            it['dir'] = True
            try:
                kids = os.listdir(p)
            except OSError:
                kids = []
            it['kids'] = [k for k in kids if k in hints][:12]
            it['count'] = len(kids)
        out.append(it)
    out.sort(key=lambda x: x['m'], reverse=True)
    return out

def result_files(root, limit=80, max_depth=2):
    out = []
    if not os.path.isdir(root):
        return out
    base = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        depth = dirpath.rstrip(os.sep).count(os.sep) - base
        if depth >= max_depth:
            dirnames[:] = []
        for name in filenames:
            low = name.lower()
            if not low.endswith(('.json', '.csv', '.md', '.txt')):
                continue
            if not ('pytest' in low or 'summary' in low or 'metrics' in low or 'report' in low or 'eval' in low):
                continue
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            it = stat_item(p, rel)
            if it is None:
                continue
            if it['s'] <= 200000 and (low.startswith('pytest') or low.endswith('metrics.json')):
                try:
                    with open(p, 'r', encoding='utf-8', errors='replace') as f:
                        it['tail'] = f.read()[-2500:]
                except OSError:
                    pass
            out.append(it)
    out.sort(key=lambda x: x['m'], reverse=True)
    return out[:limit]

def process_label(pid, fallback):
    try:
        with open('/proc/%s/cmdline' % pid, 'rb') as handle:
            raw = handle.read().split(b'\x00')
    except OSError:
        raw = []
    args = [value.decode('utf-8', 'replace') for value in raw if value]
    for arg in args:
        name = os.path.basename(arg)
        if name.endswith('.py'):
            return name[:80]
    for arg in args[1:]:
        name = os.path.basename(arg)
        if name and not name.startswith('-'):
            return name[:80]
    return os.path.basename(fallback)[:80] if fallback else 'process'

def system_info():
    cpu_total = None
    cpu_idle = None
    try:
        with open('/proc/stat', 'r') as handle:
            parts = handle.readline().split()
        values = [int(x) for x in parts[1:]]
        if values:
            cpu_idle = values[3] + (values[4] if len(values) > 4 else 0)
            cpu_total = sum(values)
    except Exception:
        pass
    mem_used = None
    mem_total = None
    try:
        info = {}
        with open('/proc/meminfo', 'r') as handle:
            for line in handle:
                key, value = line.split(':', 1)
                info[key] = int(value.strip().split()[0])
        mem_total = info.get('MemTotal', 0) * 1024
        available = info.get('MemAvailable', info.get('MemFree', 0)) * 1024
        mem_used = max(0, mem_total - available)
    except Exception:
        pass
    load = None
    try:
        with open('/proc/loadavg', 'r') as handle:
            load = [float(value) for value in handle.read().split()[:3]]
    except Exception:
        pass
    uptime_seconds = None
    try:
        with open('/proc/uptime', 'r') as handle:
            uptime_seconds = int(float(handle.read().split()[0]))
    except Exception:
        pass
    return {'cpuTotal': cpu_total, 'cpuIdle': cpu_idle, 'memUsed': mem_used, 'memTotal': mem_total, 'load': load, 'uptime': uptime_seconds}

def transfer_direction(args):
    try:
        parts = shlex.split(args)
    except Exception:
        parts = args.split()
    if not parts:
        return ('unknown', '', '')
    program = os.path.basename(parts[0]).lower()
    rest = [value for value in parts[1:] if not value.startswith('-')]
    remote = [value for value in rest if ':' in value and not value.startswith('/')]
    if program.startswith('sftp'):
        return ('session', remote[0] if remote else '', '')
    if len(remote) >= 2:
        return ('remote', rest[0] if rest else '', rest[-1] if rest else '')
    if remote:
        if rest and rest[0] == remote[0]:
            return ('download', remote[0], rest[-1] if len(rest) > 1 else '')
        return ('upload', rest[0] if rest else '', remote[0])
    return ('unknown', rest[0] if rest else '', rest[-1] if len(rest) > 1 else '')

def transfer_processes():
    out = []
    for line in sh("ps -eo pid=,etime=,args= 2>/dev/null").splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, etime, args = parts
        program = os.path.basename(args.split()[0]).lower() if args.split() else ''
        if program not in ('scp', 'rsync', 'sftp', 'rclone'):
            continue
        direction, source, dest = transfer_direction(args)
        out.append({
            'pid': pid,
            'etime': etime,
            'args': args[:300],
            'direction': direction,
            'source': source[:200],
            'dest': dest[:200],
        })
    return out

def gpu_info():
    out = []
    raw = sh("nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,driver_version --format=csv,noheader,nounits 2>/dev/null")
    apps_raw = sh("nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits 2>/dev/null")
    apps = {}
    for line in apps_raw.splitlines():
        parts = [x.strip() for x in line.split(',')]
        if len(parts) < 4:
            continue
        try:
            memory = int(float(parts[3]))
        except Exception:
            memory = 0
        apps.setdefault(parts[0], []).append({'pid': parts[1], 'name': parts[2], 'label': process_label(parts[1], parts[2]), 'memory': memory})
    for line in raw.splitlines():
        parts = [x.strip() for x in line.split(',')]
        if len(parts) < 13:
            continue
        def num(x):
            try:
                return round(float(x), 2)
            except Exception:
                return None
        out.append({
            'index': parts[0],
            'uuid': parts[1],
            'name': parts[2],
            'util': num(parts[3]),
            'memUtil': num(parts[4]),
            'memUsed': num(parts[5]),
            'memTotal': num(parts[6]),
            'temp': num(parts[7]),
            'power': num(parts[8]),
            'powerLimit': num(parts[9]),
            'fan': num(parts[10]),
            'clock': num(parts[11]),
            'driver': parts[12],
            'apps': sorted([a for a in apps.get(parts[1], []) if a.get('memory', 0) > 0], key=lambda a: -a['memory'])[:5],
        })
    return out

def tmux_sessions():
    out = []
    for line in sh('tmux ls 2>/dev/null').splitlines():
        line = line.strip()
        if not line:
            continue
        out.append({'name': line.split(':')[0].strip(), 'detail': line[:180]})
    return out

ARCHIVE_SUFFIXES = ('.tar.xz', '.tar.gz', '.tar.bz2', '.tar.zst', '.tgz', '.tbz2', '.tar', '.zip', '.7z', '.xz', '.zst', '.gz', '.bz2', '.rar')

def is_archive(name):
    low = name.lower()
    return any(low.endswith(suffix) for suffix in ARCHIVE_SUFFIXES)

def dir_stats(root, max_files=200000):
    total = 0
    count = 0
    if not os.path.isdir(root):
        return 0, 0
    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames:
            p = os.path.join(dirpath, name)
            try:
                total += os.path.getsize(p)
            except OSError:
                continue
            count += 1
            if count >= max_files:
                return total, count
    return total, count

def read_extract_log(path):
    jobs = []
    done = False
    mtime = 0
    if not path or not os.path.isfile(path):
        return jobs, done, mtime
    try:
        mtime = int(os.stat(path).st_mtime)
        with open(path, 'r', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                if 'EXTRACT_DONE' in line:
                    done = True
                low = line.lower()
                if low.startswith('+') and ('tar ' in low or 'unzip ' in low or '7z ' in low or 'bsdtar ' in low or 'unrar ' in low):
                    jobs.append(line[1:].strip()[:500])
    except OSError:
        pass
    return jobs, done, mtime

def extraction_processes():
    out = []
    raw = sh("ps -eo pid=,etime=,args= 2>/dev/null")
    for line in raw.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, etime, args = parts
        low = args.lower()
        if not any(token in low for token in ('tar ', 'unzip ', '7z ', 'bsdtar ', 'unrar ')):
            continue
        out.append({'pid': pid, 'etime': etime, 'args': args[:500]})
    return out

def process_token(args, flag):
    tokens = args.split()
    for index, token in enumerate(tokens):
        if token == flag and index + 1 < len(tokens):
            return tokens[index + 1]
    return ''

def process_archive(args):
    for token in args.split():
        if token.startswith('-'):
            continue
        if is_archive(token):
            return token
    return ''

def fd_progress(pid, archive):
    try:
        wanted = os.path.realpath(archive)
        size = os.path.getsize(wanted)
        if size <= 0:
            return None
        for fd in os.listdir('/proc/%s/fd' % pid):
            try:
                link = os.path.realpath(os.readlink('/proc/%s/fd/%s' % (pid, fd)))
            except OSError:
                continue
            if link != wanted:
                continue
            try:
                with open('/proc/%s/fdinfo/%s' % (pid, fd), 'r') as handle:
                    for line in handle:
                        if line.startswith('pos:'):
                            return max(0.0, min(0.999, int(line.split()[1]) / size))
            except OSError:
                return None
    except Exception:
        return None
    return None

def zip_progress(archive, target):
    try:
        import zipfile
        with zipfile.ZipFile(archive) as bundle:
            total = sum(item.file_size for item in bundle.infolist())
        if total <= 0:
            return None
        used, _ = dir_stats(target)
        return max(0.0, min(0.999, used / total))
    except Exception:
        return None

def extraction_groups(root, log_path):
    groups = []
    if not os.path.isdir(root):
        return groups
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return groups
    jobs_all, done_all, log_mtime = read_extract_log(log_path)
    processes = extraction_processes()
    for name in names:
        base = os.path.join(root, name)
        if not os.path.isdir(base):
            continue
        base_depth = base.rstrip(os.sep).count(os.sep)
        archives = []
        for dirpath, dirnames, filenames in os.walk(base):
            if dirpath.rstrip(os.sep).count(os.sep) - base_depth >= 3:
                dirnames[:] = []
            for child in filenames:
                if not is_archive(child):
                    continue
                p = os.path.join(dirpath, child)
                it = stat_item(p, os.path.relpath(p, base).replace(os.sep, '/'))
                if it is not None:
                    archives.append(it)
                if len(archives) >= 300:
                    break
        target = os.path.join(base, 'extracted')
        extracted_bytes, extracted_files = dir_stats(target)
        jobs = []
        for job in jobs_all:
            padded = ' ' + job
            if ('/' + name + '/') in padded or (' ' + name + '/') in padded:
                jobs.append(job)
        running = []
        for process in processes:
            padded = ' ' + process['args']
            if ('/' + name + '/') in padded or (' ' + name + '/') in padded:
                running.append(process)
        archive_bytes = sum(entry['s'] for entry in archives)
        newest_archive = max([entry['m'] for entry in archives], default=0)
        target_mtime = 0
        if os.path.isdir(target):
            try:
                target_mtime = int(os.stat(target).st_mtime)
            except OSError:
                target_mtime = 0
        if not archives and extracted_files == 0:
            continue
        total_jobs = max(len(jobs), len(archives), 1)
        status = 'pending'
        percent = 0
        current_index = None
        current_archive = ''
        mtime = target_mtime
        if running:
            status = 'running'
            process = running[0]
            current_archive = process_archive(process['args'])
            current_index = min(max(1, len(jobs)), total_jobs)
            fraction = None
            try:
                cwd = os.readlink('/proc/%s/cwd' % process['pid'])
            except OSError:
                cwd = root
            absolute = current_archive
            if absolute and not os.path.isabs(absolute):
                absolute = os.path.join(cwd, absolute)
            target_arg = process_token(process['args'], '-C') or process_token(process['args'], '-d') or process_token(process['args'], '--directory')
            target_abs = target_arg
            if target_abs and not os.path.isabs(target_abs):
                target_abs = os.path.join(cwd, target_abs)
            if absolute and os.path.isfile(absolute):
                if absolute.lower().endswith('.zip') and target_abs:
                    fraction = zip_progress(absolute, target_abs)
                if fraction is None:
                    fraction = fd_progress(process['pid'], absolute)
            if fraction is not None:
                percent = int(max(0.0, min(1.0, ((current_index - 1) + fraction) / total_jobs)) * 100)
            else:
                percent = None
            mtime = int(time.time())
        elif done_all:
            if log_mtime > 0 and log_mtime < newest_archive:
                status = 'pending'
                percent = 0
                mtime = newest_archive
            else:
                status = 'done'
                percent = 100
                mtime = max(target_mtime, newest_archive, log_mtime if jobs else 0)
        elif extracted_files > 0:
            if log_mtime == 0:
                status = 'done'
                percent = 100
            else:
                status = 'partial'
                percent = None
            mtime = max(target_mtime, newest_archive)
        elif archives:
            status = 'pending'
            percent = 0
            mtime = newest_archive
        else:
            continue
        groups.append({
            'dataset': name,
            'target': os.path.relpath(target, root).replace(os.sep, '/') if os.path.isdir(target) else '',
            'archives': len(archives),
            'archiveBytes': archive_bytes,
            'extractedBytes': extracted_bytes,
            'extractedFiles': extracted_files,
            'status': status,
            'percent': percent,
            'currentIndex': current_index,
            'totalJobs': total_jobs if status != 'pending' else None,
            'currentArchive': os.path.basename(current_archive) if current_archive else '',
            'mtime': mtime,
        })
    groups.sort(key=lambda group: (group['status'] == 'running', group['mtime']), reverse=True)
    return groups

def list_dirs(path):
    try:
        return sorted(name for name in os.listdir(path) if os.path.isdir(os.path.join(path, name)))
    except OSError:
        return []

def list_files(path, max_depth=2, limit=200):
    out = []
    if not os.path.isdir(path):
        return out
    base = path.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(path):
        depth = dirpath.rstrip(os.sep).count(os.sep) - base
        if depth >= max_depth:
            dirnames[:] = []
        for name in filenames:
            full = os.path.join(dirpath, name)
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            out.append({'p': os.path.relpath(full, path).replace(os.sep, '/'), 's': size})
            if len(out) >= limit:
                return out
    return out

def read_names(path):
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []

def task_processes():
    patterns = ('convert_to_unified.py', 'verify_manifest.py', 'prepare_omniad.py', 'make_configs.py', 'run_suite', 'tools/train.py', 'tools/evaluate.py', 'build_prototypes.py', 'build_global_stats.py', 'calibrate.py', 'tools/infer.py')
    out = []
    for line in sh("ps -eo pid=,etime=,args= 2>/dev/null").splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, etime, args = parts
        if any(token in args for token in patterns):
            out.append({'pid': pid, 'etime': etime, 'args': args[:400]})
    return out

def convert_datasets(log_path):
    out = []
    if not os.path.isfile(log_path):
        return out
    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                match = re.search(r'--dataset\s+([A-Za-z0-9_\-]+)', line)
                if match and match.group(1) not in out:
                    out.append(match.group(1))
    except OSError:
        pass
    return out

def bench_files(path, limit=120):
    out = list_files(path, max_depth=3, limit=limit)
    for item in out:
        low = item['p'].lower()
        if low.endswith(('.csv', '.md', '.txt', '.json')) and item['s'] <= 400000:
            full = os.path.join(path, item['p'])
            try:
                with open(full, 'r', encoding='utf-8', errors='replace') as handle:
                    item['lines'] = sum(1 for _ in handle)
            except OSError:
                pass
    return out

hints = set(['metrics.json', 'summary.csv', 'pytest.txt', 'report.md', 'student.pt', 'output.bin', 'training_state.pt', 'tA_summary.csv', 'tB_summary.csv'])
data = {
    'host': sh('hostname 2>/dev/null'),
    'now': int(time.time()),
    'downloads': download_entries(CFG['downloadRoot']),
    'partials': partial_files(CFG['downloadRoot']),
    'extraction': extraction_groups(CFG['downloadRoot'], CFG.get('extractLog', '')),
    'unified': list_dirs(CFG['unifiedRoot']),
    'convertReports': read_names(CFG['reportsRoot']),
    'verifyReports': [name for name in read_names(CFG['reportsRoot']) if name.endswith('_verify.json')],
    'manifests': list_files(CFG['manifestsRoot'], 1),
    'benchFiles': bench_files(CFG['benchRoot']),
    'configFiles': list_files(CFG['configRoot'], 2),
    'docsFiles': list_files(CFG['docsRoot'], 2),
    'taskProcesses': task_processes(),
    'convertDatasets': convert_datasets(CFG['convertLog']),
    'training': top_entries(CFG['trainingRoot'], hints),
    'results': result_files(CFG['trainingRoot']),
    'logs': top_entries(CFG['logRoot'], set(['.log']), 30),
    'tmux': tmux_sessions(),
    'gpu': gpu_info(),
    'system': system_info(),
    'transfers': transfer_processes(),
}
print('@@DINO@@' + json.dumps(data, ensure_ascii=False))
`

/** Read one plain config value with a fallback. */
function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** Read one numeric config value inside bounds. */
function number(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/** Normalize the row config the Loader passes to `apply`. */
function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const roots = raw.remoteRoots !== null && typeof raw.remoteRoots === 'object' ? raw.remoteRoots : {}
  const aliases = []
  const pushAlias = (value) => {
    if (typeof value !== 'string') return
    const alias = value.trim()
    if (alias !== '' && !aliases.includes(alias)) aliases.push(alias)
  }
  pushAlias(raw.remoteAlias)
  const extraAliases = Array.isArray(raw.remoteAliases)
    ? raw.remoteAliases
    : typeof raw.remoteAliases === 'string' ? raw.remoteAliases.split(',') : []
  for (const value of extraAliases) pushAlias(value)
  return {
    localRoot: text(raw.localRoot, DEFAULT_LOCAL_ROOT),
    remoteAlias: aliases.length > 0 ? aliases[0] : DEFAULT_REMOTE_ALIAS,
    remoteAliases: aliases,
    refreshSeconds: number(raw.refreshSeconds, 20, 5, 300),
    showLocal: raw.showLocal !== false,
    showRemote: raw.showRemote !== false,
    remoteDownloadRoot: text(roots.downloadRoot, DEFAULT_REMOTE_ROOTS.downloadRoot),
    remoteTrainingRoot: text(roots.trainingRoot, DEFAULT_REMOTE_ROOTS.trainingRoot),
    remoteLogRoot: text(roots.logRoot, DEFAULT_REMOTE_ROOTS.logRoot),
  }
}

/** Whether a socket remote address names loopback. */
function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice('::ffff:'.length)
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
}

/** Whether a Host header names the loopback authority. */
function isLoopbackHost(host) {
  if (typeof host !== 'string') return false
  try {
    const parsed = new URL('http://' + host)
    return parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Loopback trust fence for this read-only route family: the socket address is
 * authoritative and the Host header must agree. This mirrors the fence the
 * other local plugin routes use, without requiring browser markers because
 * these responses only ever expose ordinary project status data.
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  if (!isLoopbackHost(request.headers?.host)) return false
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (typeof origin !== 'string') return true
  try {
    return new URL(origin).host === new URL('http://' + request.headers.host).host
  } catch {
    return false
  }
}

/** Write one JSON response. */
function writeJson(response, status, value) {
  if (response.writableEnded) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** `stat` that returns null instead of throwing. */
async function statSafe(path) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/** `readdir` that returns an empty list instead of throwing. */
async function listSafe(path, limit) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return typeof limit === 'number' ? entries.slice(0, limit) : entries
  } catch {
    return []
  }
}

/** nvidia-smi fields read for both the local and the remote machine. */
const GPU_QUERY_FIELDS = 'index,uuid,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,driver_version'

/** Parse one nvidia-smi numeric cell. */
function gpuNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
}

/** Run one executable and resolve its stdout, or null on failure. */
function execFileText(executable, args, timeoutMs) {
  return new Promise(resolve => {
    execFile(executable, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error === null ? String(stdout) : null)
    })
  })
}

/** Run nvidia-smi from PATH, falling back to the Windows System32 location. */
async function readNvidiaSmi(args) {
  const candidates = ['nvidia-smi']
  if (typeof process.env.SystemRoot === 'string') candidates.push(join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe'))
  for (const executable of candidates) {
    const output = await execFileText(executable, args, 5000)
    if (output !== null) return output
  }
  return null
}

/** Read the local machine's GPU state (Windows host or any machine with nvidia-smi). */
async function readLocalGpu() {
  const raw = await readNvidiaSmi([`--query-gpu=${GPU_QUERY_FIELDS}`, '--format=csv,noheader,nounits'])
  if (raw === null) return { available: false, error: 'nvidia-smi unavailable', gpus: [] }
  const appsRaw = await readNvidiaSmi(['--query-compute-apps=gpu_uuid,pid,process_name,used_memory', '--format=csv,noheader,nounits'])
  const appsByUuid = new Map()
  if (appsRaw !== null) {
    for (const line of appsRaw.split(/\r?\n/)) {
      const parts = line.split(',').map(value => value.trim())
      if (parts.length < 4 || parts[0] === '') continue
      const list = appsByUuid.get(parts[0]) ?? []
      list.push({
        pid: parts[1],
        name: parts[2],
        label: parts[2].split(/[\\/]/).pop() ?? parts[2],
        memory: gpuNumber(parts[3]) ?? 0,
      })
      appsByUuid.set(parts[0], list)
    }
  }
  const gpus = []
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.split(',').map(value => value.trim())
    if (parts.length < 13 || parts[0] === '') continue
    gpus.push({
      index: parts[0],
      uuid: parts[1],
      name: parts[2],
      util: gpuNumber(parts[3]),
      memUtil: gpuNumber(parts[4]),
      memUsed: gpuNumber(parts[5]),
      memTotal: gpuNumber(parts[6]),
      temp: gpuNumber(parts[7]),
      power: gpuNumber(parts[8]),
      powerLimit: gpuNumber(parts[9]),
      fan: gpuNumber(parts[10]),
      clock: gpuNumber(parts[11]),
      driver: parts[12],
      apps: (appsByUuid.get(parts[1]) ?? []).filter(app => app.memory > 0).sort((left, right) => right.memory - left.memory).slice(0, 5),
    })
  }
  return { available: true, error: null, gpus }
}

/** Previous local CPU counters, for a delta-based utilization reading. */
let lastLocalCpu = null
/** Previous remote CPU counters keyed by SSH alias. */
const remoteCpuState = new Map()
/** Rolling per-GPU utilization/memory history (newest last, ~30 samples). */
const gpuHistory = new Map()
/** dsh-ssh staging files currently seen, keyed by staging file name. */
const stagingTransfers = new Map()
/** Recently finished staging transfers. */
const completedTransfers = []
/** Latest staging snapshot, refreshed by a 2 s background timer. */
let latestStaging = null
/** Latest remote transfer processes seen during a full snapshot. */
let latestRemoteTransfers = []

/** Read the local host's CPU, memory and uptime. */
function readLocalSystem() {
  let idle = 0
  let total = 0
  for (const core of os.cpus()) {
    for (const key of ['user', 'nice', 'sys', 'irq']) total += core.times[key] ?? 0
    idle += core.times.idle ?? 0
  }
  total += idle
  let cpu = null
  if (lastLocalCpu !== null && total > lastLocalCpu.total) {
    const totalDelta = total - lastLocalCpu.total
    const idleDelta = idle - lastLocalCpu.idle
    cpu = Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) * 10) / 10
  }
  lastLocalCpu = { total, idle }
  const memTotal = os.totalmem()
  return {
    cpu,
    memUsed: memTotal - os.freemem(),
    memTotal,
    load: null,
    uptime: os.uptime(),
  }
}

/** Convert raw remote /proc counters into a utilization figure. */
function readRemoteSystem(payload, alias) {
  const raw = payload !== null && typeof payload === 'object' && payload.system !== null && typeof payload.system === 'object' ? payload.system : {}
  let cpu = null
  if (typeof raw.cpuTotal === 'number' && typeof raw.cpuIdle === 'number') {
    const previous = remoteCpuState.get(alias)
    if (previous !== undefined && raw.cpuTotal > previous.total) {
      const totalDelta = raw.cpuTotal - previous.total
      const idleDelta = raw.cpuIdle - previous.idle
      cpu = Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) * 10) / 10
    }
    remoteCpuState.set(alias, { total: raw.cpuTotal, idle: raw.cpuIdle })
  }
  return {
    cpu,
    memUsed: typeof raw.memUsed === 'number' ? raw.memUsed : null,
    memTotal: typeof raw.memTotal === 'number' ? raw.memTotal : null,
    load: Array.isArray(raw.load) ? raw.load : null,
    uptime: typeof raw.uptime === 'number' ? raw.uptime : null,
  }
}

/** Append one GPU sample to its rolling history and return a copy. */
function pushGpuHistory(key, card) {
  const entry = gpuHistory.get(key) ?? { util: [], mem: [] }
  if (typeof card.util === 'number') {
    entry.util.push(Math.round(card.util))
    if (entry.util.length > 30) entry.util.shift()
  }
  if (typeof card.memUtil === 'number') {
    entry.mem.push(Math.round(card.memUtil))
    if (entry.mem.length > 30) entry.mem.shift()
  }
  gpuHistory.set(key, entry)
  return { util: entry.util.slice(), mem: entry.mem.slice() }
}

/** Attach history to a GPU list and tag it with a history namespace. */
function decorateGpus(gpus, namespace) {
  return gpus.map((card, index) => ({
    ...card,
    history: pushGpuHistory(`${namespace}:${card.index ?? index}`, card),
  }))
}

/**
 * Read the dsh-ssh transfer staging directory. File names carry the direction
 * (`upload-*` = local -> remote, `download-*` = remote -> local); a growing file
 * is still receiving bytes, a stable one is being sent onward.
 */
async function readStagingTransfers() {
  const dir = join(os.tmpdir(), 'dsh-ssh-uploads')
  const entries = await listSafe(dir, 100)
  const now = Date.now()
  const active = []
  const seen = new Set()
  for (const entry of entries) {
    if (!entry.isFile() || !/^(upload|download)-/.test(entry.name)) continue
    const info = await statSafe(join(dir, entry.name))
    if (info === null) continue
    const direction = entry.name.startsWith('upload-') ? 'upload' : 'download'
    let record = stagingTransfers.get(entry.name)
    if (record === undefined) {
      record = { direction, startedAt: now, lastSize: info.size, lastAt: now, rate: null }
      stagingTransfers.set(entry.name, record)
    }
    const elapsed = Math.max(1, now - record.lastAt)
    const delta = info.size - record.lastSize
    const rate = delta >= 0 ? (delta / elapsed) * 1000 : null
    const phase = delta > 0 ? 'receiving' : 'sending'
    if (typeof rate === 'number' && rate > 0) record.rate = rate
    record.lastSize = info.size
    record.lastAt = now
    active.push({
      name: entry.name,
      direction,
      phase,
      size: info.size,
      rate: record.rate,
      startedAt: record.startedAt,
      elapsedMs: now - record.startedAt,
      mtime: now,
    })
    seen.add(entry.name)
  }
  for (const [name, record] of stagingTransfers) {
    if (seen.has(name)) continue
    completedTransfers.unshift({
      name,
      direction: record.direction,
      bytes: record.lastSize,
      startedAt: record.startedAt,
      endedAt: now,
      durationMs: now - record.startedAt,
    })
    stagingTransfers.delete(name)
  }
  while (completedTransfers.length > 12) completedTransfers.pop()
  return { dir, active, completed: completedTransfers.slice() }
}

/** Whether a file name looks like an in-flight download. */
function isPartialName(name) {
  const lowered = String(name).toLowerCase()
  return PARTIAL_SUFFIXES.some(suffix => lowered.endsWith(suffix))
}

/** Sum a directory's file sizes with hard entry/depth caps (never unbounded). */
async function directorySizeBounded(root) {
  let bytes = 0
  let files = 0
  let seen = 0
  const stack = [[root, 0]]
  while (stack.length > 0 && seen < LIMITS.directoryFiles) {
    const [current, depth] = stack.pop()
    const entries = await listSafe(current)
    for (const entry of entries) {
      if (seen >= LIMITS.directoryFiles) break
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (depth < LIMITS.directoryDepth) stack.push([full, depth + 1])
      } else if (entry.isFile()) {
        seen += 1
        files += 1
        const info = await statSafe(full)
        if (info !== null) bytes += info.size
      }
    }
  }
  return { bytes, files, truncated: seen >= LIMITS.directoryFiles }
}

/** Parse a JSON file no larger than the configured bound. */
async function readJsonSmall(path) {
  try {
    const info = await stat(path)
    if (info.size > LIMITS.jsonBytes) return null
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/** Keep the image/pixel core metrics from a metrics.json document. */
function pickMetrics(document) {
  if (document === null || typeof document !== 'object') return null
  const overall = document.overall ?? document.macro_average
  if (overall === null || typeof overall !== 'object') return null
  const picked = {}
  for (const key of ['image_auroc', 'image_f1', 'image_average_precision', 'pixel_auroc', 'pixel_f1']) {
    const value = overall[key]
    if (typeof value === 'number' && Number.isFinite(value)) picked[key] = Math.round(value * 10000) / 10000
  }
  return Object.keys(picked).length > 0 ? picked : null
}

/** Parse `N passed` / `M failed` out of a pytest tail. */
function parsePytestTail(tail) {
  if (typeof tail !== 'string' || tail === '') return null
  const passed = /(\d+)\s+passed/.exec(tail)
  const failed = /(\d+)\s+failed/.exec(tail)
  if (passed === null && failed === null) return null
  return {
    passed: passed === null ? 0 : Number(passed[1]),
    failed: failed === null ? 0 : Number(failed[1]),
  }
}

/** Keep the human summary line of a pytest tail. */
function pytestSummaryLine(tail) {
  if (typeof tail !== 'string') return ''
  const lines = tail.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/(\d+)\s+passed/.test(lines[index]) || /(\d+)\s+failed/.test(lines[index])) return lines[index].slice(0, 160)
  }
  return ''
}

let itemSequence = 0
/** Build one normalized dashboard item. */
function item(fields) {
  itemSequence += 1
  return {
    id: `item-${itemSequence}`,
    kind: 'file',
    status: 'info',
    mtime: 0,
    size: 0,
    source: 'local',
    artifacts: [],
    ...fields,
  }
}

/** Scan the local workspace: downloads, training runs and test results. */
async function scanLocal(root) {
  const rootInfo = await statSafe(root)
  if (rootInfo === null || !rootInfo.isDirectory()) {
    throw new Error(`local workspace not found: ${root}`)
  }

  const downloads = []
  for (const relative of LOCAL_DOWNLOAD_DIRS) {
    const base = join(root, relative)
    const entries = await listSafe(base, LIMITS.downloadEntries)
    for (const entry of entries) {
      const full = join(base, entry.name)
      const info = await statSafe(full)
      if (info === null) continue
      const isDir = entry.isDirectory()
      const size = isDir ? (await directorySizeBounded(full)).bytes : info.size
      downloads.push(item({
        kind: isDir ? 'dir' : 'file',
        name: `${relative}/${entry.name}`,
        path: full,
        size,
        mtime: info.mtimeMs,
        source: 'local',
        status: isPartialName(entry.name) ? 'running' : 'done',
        detailKey: isDir ? 'detail.directory' : 'detail.download',
      }))
    }
  }

  const training = []
  const pytestItems = []
  for (const relative of LOCAL_TRAIN_ROOTS) {
    const base = join(root, relative)
    const entries = await listSafe(base, LIMITS.trainingChildren)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      const full = join(base, entry.name)
      const info = await statSafe(full)
      if (info === null) continue
      const children = await listSafe(full, 120)
      const artifacts = children.filter(child => ARTIFACT_NAMES.includes(child.name)).map(child => child.name)
      let metrics = null
      let tag = null
      if (artifacts.includes('metrics.json')) metrics = pickMetrics(await readJsonSmall(join(full, 'metrics.json')))
      if (artifacts.includes('package_manifest.json')) {
        const manifest = await readJsonSmall(join(full, 'package_manifest.json'))
        if (manifest !== null && typeof manifest.local_tag === 'string') tag = manifest.local_tag
      }
      training.push(item({
        kind: 'run',
        name: `${relative}/${entry.name}`,
        path: full,
        root: relative,
        mtime: info.mtimeMs,
        source: 'local',
        status: artifacts.length > 0 ? 'done' : 'info',
        artifacts,
        metrics,
        tag,
        detailKey: artifacts.length > 0 ? 'detail.run' : 'detail.runEmpty',
      }))

      const logs = []
      for (const child of children) {
        if (!child.isFile() || !/^pytest.*\.txt$/i.test(child.name)) continue
        const logPath = join(full, child.name)
        const logInfo = await statSafe(logPath)
        if (logInfo === null) continue
        logs.push({ name: child.name, path: logPath, mtime: logInfo.mtimeMs })
      }
      // One result per run directory: the newest log (a `*final*` log wins a
      // tie). Superseded logs must not resurface an old failure as the state of
      // a run that later passed.
      if (logs.length > 0) {
        logs.sort((left, right) => right.mtime - left.mtime || Number(/final/i.test(right.name)) - Number(/final/i.test(left.name)))
        const log = logs[0]
        let tail = ''
        try {
          const buffer = await readFile(log.path)
          tail = buffer.subarray(Math.max(0, buffer.length - 6000)).toString('utf8')
        } catch {
          tail = ''
        }
        const counts = parsePytestTail(tail)
        pytestItems.push(item({
          kind: 'pytest',
          name: `${relative}/${entry.name}/${log.name}`,
          path: log.path,
          mtime: log.mtime,
          source: 'local',
          status: counts === null ? 'info' : counts.failed > 0 ? 'failed' : 'passed',
          counts: counts ?? undefined,
          detail: pytestSummaryLine(tail),
          detailKey: 'detail.pytest',
          logCount: logs.length,
        }))
      }
    }
  }

  // Keep the newest run of every local root visible even when one root has
  // many more recent entries than the others.
  const newestByRoot = new Map()
  for (const entry of training) {
    const previous = newestByRoot.get(entry.root)
    if (previous === undefined || entry.mtime > previous.mtime) newestByRoot.set(entry.root, entry)
  }
  for (const entry of newestByRoot.values()) entry.pinned = true

  const tests = [...pytestItems]
  const evaluationPath = join(root, 'results', 'metrics.json')
  const evaluationInfo = await statSafe(evaluationPath)
  if (evaluationInfo !== null) {
    const evaluation = await readJsonSmall(evaluationPath)
    tests.push(item({
      kind: 'metrics',
      name: 'results/metrics.json',
      path: evaluationPath,
      mtime: evaluationInfo.mtimeMs,
      source: 'local',
      status: 'info',
      metrics: pickMetrics(evaluation),
      detailKey: 'detail.metrics',
      pinned: true,
    }))
  }
  for (const relative of ['results/reproduce_3runs', 'offline_eval']) {
    const full = join(root, relative)
    const info = await statSafe(full)
    if (info === null) continue
    tests.push(item({
      kind: 'dir',
      name: relative,
      path: full,
      mtime: info.mtimeMs,
      source: 'local',
      status: 'info',
      detailKey: 'detail.directory',
      pinned: true,
    }))
  }
  const suiteEntries = (await listSafe(join(root, 'tests'), 400)).filter(entry => entry.isFile() && entry.name.endsWith('.py'))
  let suiteMtime = 0
  for (const entry of suiteEntries.slice(0, 120)) {
    const info = await statSafe(join(root, 'tests', entry.name))
    if (info !== null && info.mtimeMs > suiteMtime) suiteMtime = info.mtimeMs
  }
  tests.push(item({
    kind: 'suite',
    name: 'tests/',
    path: join(root, 'tests'),
    mtime: suiteMtime,
    source: 'local',
    status: 'info',
    fileCount: suiteEntries.length,
    detailKey: 'detail.suite',
    pinned: true,
  }))

  return { downloads, training, tests }
}

/** Plan fallback when the local research document is missing or unparseable. */
const FALLBACK_PLAN = [
  { id: 'T1', title: '数据下载与完整性校验', type: '自动', estimate: '1–2 h' },
  { id: 'T2', title: '数据结构审计（只读）', type: '只读', estimate: '1 h' },
  { id: 'T3', title: '数据转换到统一布局', type: '数据', estimate: '2 h' },
  { id: 'T4', title: '工程改造：图像级数据集支持', type: '代码', estimate: '0.5–1 d' },
  { id: 'T5', title: '配置生成器与批量 runner', type: '代码', estimate: '0.5 d' },
  { id: 'T6', title: '指标口径交叉校验', type: '代码', estimate: '0.5 d' },
  { id: 'T7', title: '端到端冒烟验证', type: '验证', estimate: '0.5 d' },
  { id: 'T8', title: '免训练基线评测', type: '评测', estimate: '0.5 d' },
  { id: 'T9', title: '全量重训', type: '训练', estimate: '3–5 d' },
  { id: 'T10', title: '融合实验 P0', type: '实验', estimate: '3 d' },
  { id: 'T11', title: '融合实验 P1', type: '实验', estimate: '3 d' },
  { id: 'T12', title: '汇总报告与对比', type: '文档', estimate: '1 d' },
]

/** Read the plan table and the local evidence the task states are computed from. */
async function scanTaskEvidence(root) {
  const evidence = {
    rows: [],
    audit: false,
    scriptBench: false,
    imageOnly: false,
    adapterMasks: false,
  }
  try {
    const plan = await readFile(join(root, 'docs', 'research', 'NEXT_TASKS_20261018.md'), 'utf8')
    const rows = []
    for (const line of plan.split(/\r?\n/)) {
      const match = /^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(line)
      if (match !== null) rows.push({ id: match[1], title: match[2].trim(), type: match[3].trim(), estimate: match[4].trim() })
    }
    if (rows.length > 0) evidence.rows = rows
  } catch {
    /* Fall back to the built-in task list. */
  }
  if (evidence.rows.length === 0) evidence.rows = FALLBACK_PLAN.map(entry => ({ ...entry }))
  evidence.audit = (await statSafe(join(root, 'docs', 'bench13', 'DATA_AUDIT_20261018.md'))) !== null
  evidence.scriptBench = (await statSafe(join(root, 'scripts', 'bench'))) !== null
  try {
    evidence.imageOnly = /--image-only|image_only/.test(await readFile(join(root, 'tools', 'evaluate.py'), 'utf8'))
  } catch {
    evidence.imageOnly = false
  }
  try {
    evidence.adapterMasks = /require_masks/.test(await readFile(join(root, 'unitriad', 'data', 'omniad_adapter.py'), 'utf8'))
  } catch {
    evidence.adapterMasks = false
  }
  return evidence
}

/** Derive plan-task progress from the local plan plus remote conversion/bench evidence. */
function buildTasks(evidence, payload) {
  const unified = Array.isArray(payload?.unified) ? payload.unified : []
  const verifyReports = Array.isArray(payload?.verifyReports) ? payload.verifyReports : []
  const manifests = Array.isArray(payload?.manifests) ? payload.manifests : []
  const benchFiles = Array.isArray(payload?.benchFiles) ? payload.benchFiles : []
  const configFiles = Array.isArray(payload?.configFiles) ? payload.configFiles : []
  const docsFiles = Array.isArray(payload?.docsFiles) ? payload.docsFiles : []
  const processes = Array.isArray(payload?.taskProcesses) ? payload.taskProcesses : []
  const extractionGroups = Array.isArray(payload?.extraction) ? payload.extraction : []
  const convertDatasets = Array.isArray(payload?.convertDatasets) ? payload.convertDatasets : []

  const expected = Math.max(13, unified.length)
  const datasetTarget = Math.max(1, unified.length)
  const converted = unified.length
  const verified = verifyReports.length
  const manifestCount = manifests.length
  const yamlConfigs = configFiles.filter(file => /\.ya?ml$/i.test(file.p)).length
  const benchLineCount = (file) => (file !== undefined && typeof file.lines === 'number' ? Math.max(0, file.lines - 1) : 0)
  const tAFile = benchFiles.find(file => /tA_summary\.csv$/i.test(file.p))
  const tBFile = benchFiles.find(file => /tB_summary\.csv$/i.test(file.p))
  const reportFile = benchFiles.find(file => /^report\.md$/i.test(file.p))
  const fusionFiles = benchFiles.filter(file => /^fusion\//i.test(file.p))
  const tA = benchLineCount(tAFile)
  const tB = benchLineCount(tBFile)
  const extractionDone = extractionGroups.length > 0 && extractionGroups.every(group => group.status === 'done')
  const extractionFinished = extractionGroups.filter(group => group.status === 'done').length

  const rows = evidence.rows.map(entry => ({ ...entry, status: 'pending', percent: 0, detail: '', evidenceText: '' }))
  const byId = new Map(rows.map(row => [row.id, row]))
  const set = (id, fields) => {
    const row = byId.get(id)
    if (row !== undefined) Object.assign(row, fields)
  }

  set('T1', {
    status: extractionDone ? 'done' : 'pending',
    percent: extractionDone ? 100 : extractionGroups.length > 0 ? 50 : 0,
    detail: extractionDone
      ? `下载校验与解压完成（${extractionGroups.length} 个数据集）`
      : extractionGroups.length > 0
        ? `解压进行中 ${extractionFinished}/${extractionGroups.length}`
        : '等待下载校验/解压结果',
    evidenceText: 'raw/PROVENANCE.txt · SHA256SUMS.txt · extracted/',
  })

  const auditFound = evidence.audit || docsFiles.some(file => /bench13/i.test(file.p))
  set('T2', {
    status: auditFound ? 'done' : 'pending',
    percent: auditFound ? 100 : 0,
    detail: auditFound ? '结构审计报告已生成（docs/bench13）' : '等待结构审计报告',
    evidenceText: 'docs/bench13/DATA_AUDIT_20261018.md',
  })

  const t3Percent = converted >= 3 ? 100 : Math.min(99, Math.round((converted / 3) * 100))
  set('T3', {
    status: t3Percent >= 100 ? 'done' : converted > 0 ? 'running' : 'pending',
    percent: t3Percent,
    detail: `unified 已生成 ${converted} 个数据集（试点 3 个${converted >= 3 ? '已覆盖' : '未完成'}）`,
    evidenceText: 'unified/ · docs/convert_reports/',
  })

  const t4Done = evidence.imageOnly && evidence.adapterMasks
  set('T4', {
    status: t4Done ? 'done' : 'pending',
    percent: t4Done ? 100 : 0,
    detail: t4Done ? '已支持无 mask 数据集的图像级评测' : '待改造 unitriad adapter / evaluator 的 image-only 支持',
    evidenceText: 'tools/evaluate.py · unitriad/data/omniad_adapter.py',
  })

  const t5Percent = Math.min(100, Math.round((yamlConfigs / expected) * 100))
  set('T5', {
    status: t5Percent >= 100 ? 'done' : 'pending',
    percent: t5Percent,
    detail: `bench 配置 ${yamlConfigs}/${expected}${evidence.scriptBench ? ' · 本地 runner 目录已存在' : ''}`,
    evidenceText: 'configs/ · scripts/bench/',
  })

  set('T6', {
    status: 'pending',
    percent: 0,
    detail: '等待在 MVTec AD / VisA / MPDD 上交叉校验指标口径',
    evidenceText: 'anomalib / 官方 evaluate.py',
  })

  const t7Percent = manifestCount > 0 ? Math.min(100, Math.round((manifestCount / datasetTarget) * 100)) : 0
  set('T7', {
    status: t7Percent >= 100 ? 'done' : manifestCount > 0 ? 'running' : 'pending',
    percent: t7Percent,
    detail: `manifest ${manifestCount}/${datasetTarget} · 端到端冒烟${manifestCount > 0 ? '进行中' : '未开始'}`,
    evidenceText: 'manifests/ · metrics.json',
  })

  const t8Percent = tA > 0 ? Math.min(100, Math.round((tA / datasetTarget) * 100)) : 0
  set('T8', {
    status: t8Percent >= 100 ? 'done' : tA > 0 ? 'running' : 'pending',
    percent: t8Percent,
    detail: tA > 0 ? `T-A 结果 ${tA}/${datasetTarget} 个数据集` : 'T-A 基线未开始',
    evidenceText: 'runs/bench13/tA_summary.csv',
  })

  const t9Percent = tB > 0 ? Math.min(100, Math.round((tB / datasetTarget) * 100)) : 0
  set('T9', {
    status: t9Percent >= 100 ? 'done' : tB > 0 ? 'running' : 'pending',
    percent: t9Percent,
    detail: tB > 0 ? `T-B 结果 ${tB}/${datasetTarget} 个数据集` : 'T-B 重训未开始',
    evidenceText: 'runs/bench13/tB_summary.csv',
  })

  const t10Percent = Math.min(100, Math.round((fusionFiles.length / 3) * 100))
  set('T10', {
    status: t10Percent >= 100 ? 'done' : fusionFiles.length > 0 ? 'running' : 'pending',
    percent: t10Percent,
    detail: fusionFiles.length > 0 ? `融合证据 ${fusionFiles.length} 份` : '融合 P0 未开始',
    evidenceText: 'runs/bench13/fusion/',
  })

  set('T11', {
    status: 'pending',
    percent: 0,
    detail: '等待 T10 结论后安排 C8/C7/C10',
    evidenceText: 'runs/bench13/fusion/',
  })

  set('T12', {
    status: reportFile !== undefined ? 'done' : 'pending',
    percent: reportFile !== undefined ? 100 : 0,
    detail: reportFile !== undefined ? '汇总报告已生成' : '等待 T9/T10 结果后汇总',
    evidenceText: 'runs/bench13/report.md',
  })

  // A live process overrides the static state and turns its task into the
  // current one, so the page follows work while it runs.
  for (const process of processes) {
    const args = String(process.args ?? '')
    if (/convert_to_unified\.py/.test(args)) {
      set('T3', {
        status: 'running',
        percent: Math.min(99, Math.round((convertDatasets.length / expected) * 100)),
        detail: `正在转换 ${convertDatasets.length}/${expected} 个数据集（已运行 ${process.etime}）`,
      })
    } else if (/verify_manifest\.py/.test(args)) {
      set('T7', {
        status: 'running',
        percent: Math.min(99, Math.round((verified / datasetTarget) * 100)),
        detail: `正在校验 unified 数据（已运行 ${process.etime}）`,
      })
    } else if (/prepare_omniad\.py|make_configs\.py/.test(args)) {
      set('T7', {
        status: 'running',
        percent: Math.min(99, Math.round((manifestCount / datasetTarget) * 100)),
        detail: `正在生成 manifest / 配置（已运行 ${process.etime}）`,
      })
    } else if (/build_prototypes\.py|build_global_stats\.py|calibrate\.py|tools\/infer\.py/.test(args)) {
      const configMatch = /--config\s+(\S+)/.exec(args)
      const configName = configMatch === null ? '' : configMatch[1].split(/[\\/]/).pop()
      set('T8', {
        status: 'running',
        percent: tA > 0 ? Math.min(95, Math.round((tA / datasetTarget) * 100)) : null,
        detail: `T-A 原型/校准运行中${configName === '' ? '' : `（${configName}）`} · 已运行 ${process.etime}`,
      })
    } else if (/tools\/train\.py/.test(args)) {
      set('T9', { status: 'running', percent: 5, detail: `训练进程运行中（${process.etime}）` })
    } else if (/tools\/evaluate\.py|run_suite/.test(args)) {
      set('T8', { status: 'running', percent: tA > 0 ? Math.min(95, Math.round((tA / datasetTarget) * 100)) : null, detail: `T-A 批量运行/评测中（已运行 ${process.etime}）` })
    }
  }

  const done = rows.filter(row => row.status === 'done').length
  const runningItem = rows.find(row => row.status === 'running') ?? null
  const nextItem = rows.find(row => row.status !== 'done' && row.status !== 'running') ?? null
  if (nextItem !== null) nextItem.next = true
  const percent = Math.round(rows.reduce((sum, row) => sum + (typeof row.percent === 'number' ? row.percent : 0), 0) / Math.max(1, rows.length))

  return {
    plan: 'NEXT_TASKS_20261018',
    items: rows.map(row => ({
      id: `task:${row.id}`,
      kind: 'task',
      name: `${row.id} · ${row.title}`,
      status: row.status,
      mtime: 0,
      detail: row.detail,
      task: {
        id: row.id,
        type: row.type,
        estimate: row.estimate,
        percent: row.percent,
        next: row.next === true,
        evidence: row.evidenceText,
      },
    })),
    done,
    total: rows.length,
    percent,
    current: runningItem === null ? null : runningItem.id,
    next: nextItem === null ? null : nextItem.id,
    running: runningItem !== null,
    datasets: { converted, verified, manifests: manifestCount, expected },
    bench: { tA, tB, fusion: fusionFiles.length, report: reportFile !== undefined },
  }
}

/** Send one command to the remote host through dsh-ssh's loopback exec route. */

async function execRemote(origin, alias, command, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs + 8000)
  try {
    const response = await fetch(`${origin}/api/dsh-ssh/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias, command, timeoutMs }),
      signal: controller.signal,
    })
    if (!response.ok) {
      let detail = ''
      try {
        const failure = await response.json()
        if (failure !== null && typeof failure === 'object' && typeof failure.error === 'string') detail = `: ${failure.error}`
      } catch {
        detail = ''
      }
      throw new Error(`dsh-ssh exec failed (HTTP ${response.status})${detail}`.slice(0, 300))
    }
    const body = await response.json()
    const result = body !== null && typeof body === 'object' ? body.result : null
    if (result === null || typeof result !== 'object') {
      const message = body !== null && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'ssh exec returned no result'
      throw new Error(message)
    }
    if (result.success !== true) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
      const reason = stderr !== '' ? stderr : result.timedOut === true ? 'remote command timed out' : 'remote command failed'
      throw new Error(reason.slice(0, 300))
    }
    return typeof result.stdout === 'string' ? result.stdout : ''
  } finally {
    clearTimeout(timer)
  }
}

/** Run the Python probe on the remote host and return its parsed payload. */
async function scanRemote(origin, options) {
  const dataBase = options.remoteDownloadRoot.replace(/\/+raw\/?$/, '')
  const homeBase = options.remoteLogRoot.replace(/\/+logs\/?$/, '')
  const config = JSON.stringify({
    downloadRoot: options.remoteDownloadRoot,
    trainingRoot: options.remoteTrainingRoot,
    logRoot: options.remoteLogRoot,
    extractLog: `${options.remoteLogRoot.replace(/\/+$/, '')}/extract.log`,
    convertLog: `${homeBase}/logs/convert_rest.log`,
    unifiedRoot: `${dataBase}/unified`,
    reportsRoot: `${homeBase}/docs/convert_reports`,
    manifestsRoot: `${homeBase}/manifests`,
    benchRoot: `${options.remoteTrainingRoot.replace(/\/+$/, '')}/bench13`,
    configRoot: `${homeBase}/configs`,
    docsRoot: `${homeBase}/docs`,
  })
  const script = PY_PROBE.replace('__CFG__', config)
  const command = `python3 - <<'PY'\n${script}\nPY`
  const stdout = await execRemote(origin, options.remoteAlias, command, 20000)
  const line = stdout.split(/\r?\n/).filter(entry => entry.startsWith('@@DINO@@')).pop()
  if (line === undefined) throw new Error('remote probe returned no payload (python3 missing?)')
  const parsed = JSON.parse(line.slice('@@DINO@@'.length))
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/** Session names that belong to one kind of background work. */
function matchesSession(name, kind) {
  if (typeof name !== 'string') return false
  if (kind === 'download') return /(^|[-_])(dl|dl_|download|aria2|wget|curl)/i.test(name)
  if (kind === 'training') return /(^|[-_])(train|finetune|fit)([-_]|$)/i.test(name)
  if (kind === 'test') return /(^|[-_])(eval|test|bench|infer)/i.test(name)
  return false
}

/** Absolute path shown when a remote item is copied. */
function remotePath(host, root, name) {
  const trimmed = String(name).replace(/\/+$/, '')
  const prefix = root.endsWith('/') ? root : `${root}/`
  return `${host === '' ? '' : `${host}:`}${prefix}${trimmed}`
}

/** Map one remote payload into the local item model. */
function mapRemote(payload, maxItems, options) {
  const sessions = Array.isArray(payload.tmux) ? payload.tmux : []
  const downloads = []
  const training = []
  const tests = []
  const second = 1000
  const host = typeof payload.host === 'string' ? payload.host : ''

  const downloadEntries = Array.isArray(payload.downloads) ? payload.downloads : []
  const extractionNames = new Set((Array.isArray(payload.extraction) ? payload.extraction : []).map(group => String(group.dataset ?? '')).filter(Boolean))
  const fileNames = new Set(downloadEntries.filter(entry => entry.dir !== true).map(entry => String(entry.p ?? '')))
  for (const entry of downloadEntries) {
    const name = String(entry.p ?? '')
    if (name === '') continue
    if (name.split('/').some(segment => segment.startsWith('.'))) continue
    if (/(^|\/)README/i.test(name) || /\.md$/i.test(name)) continue
    const isDir = entry.dir === true
    if (isDir) {
      // The extraction row below already represents this dataset directory.
      if (extractionNames.has(name.replace(/\/+$/, ''))) continue
      const prefix = name.endsWith('/') ? name : `${name}/`
      if ([...fileNames].some(file => file.startsWith(prefix))) continue
    }
    const partial = isPartialName(name)
    downloads.push(item({
      kind: isDir ? 'dir' : 'file',
      name,
      path: remotePath(host, options.remoteDownloadRoot, name),
      size: typeof entry.s === 'number' ? entry.s : 0,
      mtime: typeof entry.m === 'number' ? entry.m * second : 0,
      source: 'remote',
      status: partial ? 'running' : 'done',
      detailKey: isDir ? 'detail.remoteDirectory' : 'detail.remoteDownload',
    }))
  }
  for (const entry of Array.isArray(payload.partials) ? payload.partials : []) {
    const name = String(entry.p ?? '')
    if (name === '') continue
    downloads.push(item({
      kind: 'file',
      name,
      path: remotePath(host, options.remoteDownloadRoot, name),
      size: typeof entry.s === 'number' ? entry.s : 0,
      mtime: typeof entry.m === 'number' ? entry.m * second : 0,
      source: 'remote',
      status: 'running',
      detailKey: 'detail.remotePartial',
    }))
  }
  for (const session of sessions.filter(entry => matchesSession(entry.name, 'download'))) {
    downloads.push(item({
      kind: 'session',
      name: `tmux: ${session.name}`,
      mtime: Date.now(),
      source: 'remote',
      status: 'running',
      detail: typeof session.detail === 'string' ? session.detail : '',
      detailKey: 'detail.session',
    }))
  }

  // Extraction state per downloaded dataset: archive count, extracted size and
  // (while an extractor runs) a computed percentage.
  for (const group of Array.isArray(payload.extraction) ? payload.extraction.slice(0, 10) : []) {
    const dataset = String(group.dataset ?? '')
    if (dataset === '') continue
    const state = String(group.status ?? '')
    const running = state === 'running'
    downloads.push(item({
      kind: 'extract',
      name: `${dataset}/`,
      path: remotePath(host, options.remoteDownloadRoot, `${dataset}/extracted`),
      size: typeof group.archiveBytes === 'number' ? group.archiveBytes : 0,
      mtime: running ? Date.now() : (typeof group.mtime === 'number' ? group.mtime * second : 0),
      source: 'remote',
      status: running ? 'running' : state === 'done' ? 'done' : 'info',
      detailKey: running ? 'detail.extracting' : state === 'done' ? 'detail.extracted' : state === 'partial' ? 'detail.extractPartial' : 'detail.extractPending',
      extract: {
        state,
        percent: typeof group.percent === 'number' ? Math.max(0, Math.min(100, Math.round(group.percent))) : null,
        bytes: typeof group.extractedBytes === 'number' ? group.extractedBytes : 0,
        files: typeof group.extractedFiles === 'number' ? group.extractedFiles : 0,
        archives: typeof group.archives === 'number' ? group.archives : 0,
        index: typeof group.currentIndex === 'number' ? group.currentIndex : null,
        total: typeof group.totalJobs === 'number' ? group.totalJobs : null,
        current: typeof group.currentArchive === 'string' ? group.currentArchive : '',
      },
    }))
  }

  for (const entry of Array.isArray(payload.training) ? payload.training : []) {
    const name = String(entry.p ?? '')
    if (name === '' || name.startsWith('.')) continue
    const kids = Array.isArray(entry.kids) ? entry.kids.map(String) : []
    const isDir = entry.dir === true
    training.push(item({
      kind: isDir ? 'run' : 'file',
      name,
      path: remotePath(host, options.remoteTrainingRoot, name),
      size: typeof entry.s === 'number' ? entry.s : 0,
      mtime: typeof entry.m === 'number' ? entry.m * second : 0,
      source: 'remote',
      status: kids.length > 0 ? 'done' : 'info',
      artifacts: kids,
      fileCount: typeof entry.count === 'number' ? entry.count : 0,
      detailKey: kids.length > 0 ? 'detail.remoteRun' : 'detail.remoteRunEmpty',
    }))
  }
  for (const session of sessions.filter(entry => matchesSession(entry.name, 'training'))) {
    training.push(item({
      kind: 'session',
      name: `tmux: ${session.name}`,
      mtime: Date.now(),
      source: 'remote',
      status: 'running',
      detail: typeof session.detail === 'string' ? session.detail : '',
      detailKey: 'detail.session',
    }))
  }

  // One pytest result per remote directory: the newest log, so a superseded
  // failure does not survive as the state of a directory that later passed.
  const remoteResults = Array.isArray(payload.results) ? payload.results : []
  const pytestByDir = new Map()
  const otherResults = []
  for (const entry of remoteResults) {
    const name = String(entry.p ?? '')
    if (name === '' || name.startsWith('.')) continue
    if (/pytest/i.test(name)) {
      const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
      const previous = pytestByDir.get(dir)
      if (previous === undefined || (typeof entry.m === 'number' ? entry.m : 0) > (typeof previous.m === 'number' ? previous.m : 0)) {
        pytestByDir.set(dir, entry)
      }
    } else {
      otherResults.push(entry)
    }
  }
  for (const entry of [...otherResults, ...pytestByDir.values()]) {
    const name = String(entry.p ?? '')
    if (name === '' || name.startsWith('.')) continue
    const counts = parsePytestTail(entry.tail)
    const tailSummary = pytestSummaryLine(entry.tail)
    tests.push(item({
      kind: name.toLowerCase().includes('pytest') ? 'pytest' : 'result',
      name,
      path: remotePath(host, options.remoteTrainingRoot, name),
      size: typeof entry.s === 'number' ? entry.s : 0,
      mtime: typeof entry.m === 'number' ? entry.m * second : 0,
      source: 'remote',
      status: counts === null ? 'info' : counts.failed > 0 ? 'failed' : 'passed',
      counts: counts ?? undefined,
      detail: tailSummary,
      detailKey: name.toLowerCase().includes('pytest') ? 'detail.pytest' : 'detail.resultFile',
    }))
  }
  for (const session of sessions.filter(entry => matchesSession(entry.name, 'test'))) {
    tests.push(item({
      kind: 'session',
      name: `tmux: ${session.name}`,
      mtime: Date.now(),
      source: 'remote',
      status: 'running',
      detail: typeof session.detail === 'string' ? session.detail : '',
      detailKey: 'detail.session',
    }))
  }

  return {
    host: typeof payload.host === 'string' ? payload.host : '',
    gpu: Array.isArray(payload.gpu) ? payload.gpu : [],
    downloads: downloads.slice(0, maxItems),
    training: training.slice(0, maxItems),
    tests: tests.slice(0, maxItems),
  }
}

/** Sort by recency and keep at most `maxItems`. */
function newest(items, maxItems) {
  return items.slice().sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0)).slice(0, maxItems)
}

/**
 * Newest training runs, but always keep the newest run of every local root.
 */
function selectTraining(items, maxItems) {
  const pinned = items.filter(entry => entry.pinned === true)
  const rest = items.filter(entry => entry.pinned !== true)
  const room = Math.max(0, maxItems - pinned.length)
  return newest([...pinned, ...newest(rest, room)], maxItems + pinned.length)
}

/**
 * Newest test records, but never drop a failed run or the fixed evaluation
 * anchors (workspace suite, evaluation metrics, reproduce directories).
 */
function selectTests(items, maxItems) {
  const pinned = items.filter(entry => entry.pinned === true)
  const rest = items.filter(entry => entry.pinned !== true)
  const room = Math.max(0, maxItems - pinned.length)
  const picked = newest(rest, room)
  const failed = newest(rest.filter(entry => entry.status === 'failed'), 1)
  if (failed.length > 0 && !picked.includes(failed[0])) {
    if (picked.length >= room && picked.length > 0) picked.pop()
    picked.push(failed[0])
  }
  return newest([...pinned, ...picked], maxItems + pinned.length)
}

/** Sum up one section for the client's summary row. */
function summarize(items) {
  const summary = { count: items.length, bytes: 0, running: 0, passed: 0, failed: 0 }
  for (const entry of items) {
    if (typeof entry.size === 'number' && entry.size > 0 && entry.kind !== 'session' && entry.kind !== 'extract') summary.bytes += entry.size
    if (entry.status === 'running') summary.running += 1
    if (entry.status === 'passed') summary.passed += 1
    if (entry.status === 'failed') summary.failed += 1
  }
  return summary
}

/** Build the transfer tab payload from a staging snapshot and remote processes. */
function buildTransferItems(staging, remoteTransfers) {
  const stagingActive = staging.active.map(entry => item({
    id: `transfer:staging:${entry.name}`,
    kind: 'transfer',
    name: entry.direction === 'upload' ? 'DSH 上传' : 'DSH 下载',
    status: 'running',
    source: 'local',
    size: entry.size,
    mtime: entry.mtime,
    transfer: {
      direction: entry.direction,
      phase: entry.phase,
      rate: entry.rate,
      elapsedMs: entry.elapsedMs,
      file: entry.name,
    },
  }))
  const stagingCompleted = staging.completed.map(entry => item({
    id: `transfer:done:${entry.name}:${entry.endedAt}`,
    kind: 'transfer',
    name: entry.direction === 'upload' ? 'DSH 上传' : 'DSH 下载',
    status: 'done',
    source: 'local',
    size: entry.bytes,
    mtime: entry.endedAt,
    transfer: {
      direction: entry.direction,
      phase: 'done',
      durationMs: entry.durationMs,
      file: entry.name,
    },
  }))
  const remoteTransferItems = remoteTransfers.map(process => {
    const command = String(process.args ?? '')
    const program = command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop() ?? 'transfer'
    return item({
      id: `transfer:remote:${process.alias}:${process.pid}`,
      kind: 'transfer',
      name: program,
      status: 'running',
      source: 'remote',
      mtime: Date.now(),
      transfer: {
        direction: process.direction ?? 'unknown',
        phase: 'process',
        sourcePath: process.source ?? '',
        destPath: process.dest ?? '',
        alias: process.alias,
        pid: process.pid,
        etime: process.etime ?? '',
        command,
      },
    })
  })
  return {
    active: [...stagingActive, ...remoteTransferItems],
    completed: stagingCompleted,
    stagingDir: staging.dir,
  }
}

/**
 * Build one full snapshot. Local and remote failures are reported per side so a
 * down server never hides the local project state (and the reverse).
 */
async function buildSnapshot(webServer, options) {
  const startedAt = Date.now()
  const maxItems = LIMITS.maxItemsPerSection
  const snapshot = {
    generatedAt: startedAt,
    tookMs: 0,
    refreshMs: options.refreshSeconds * 1000,
    local: { enabled: options.showLocal, root: options.localRoot, ok: false, error: null },
    remote: {
      enabled: options.showRemote && Array.isArray(options.remoteAliases) && options.remoteAliases.length > 0,
      alias: options.remoteAlias,
      ok: false,
      error: null,
      host: '',
    },
    downloads: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
    training: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
    tests: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
    transfers: { active: [], completed: [], stagingDir: '' },
    gpu: {
      local: { available: false, error: null, gpus: [], system: null },
      remotes: [],
      remote: { available: false, error: null, gpus: [] },
    },
    tasks: null,
  }

  let local = { downloads: [], training: [], tests: [] }
  if (options.showLocal) {
    try {
      local = await scanLocal(options.localRoot)
      snapshot.local.ok = true
    } catch (error) {
      snapshot.local.error = error instanceof Error ? error.message : String(error)
    }
  }

  let remote = null
  let remotePayload = null
  const remotes = []
  const remoteTransfers = []
  if (snapshot.remote.enabled) {
    for (const alias of options.remoteAliases) {
      const aliasOptions = { ...options, remoteAlias: alias }
      try {
        const payload = await scanRemote(webServer.getOrigin(), aliasOptions)
        remotes.push({
          alias,
          host: typeof payload.host === 'string' ? payload.host : '',
          primary: alias === options.remoteAlias,
          available: true,
          error: null,
          gpus: decorateGpus(Array.isArray(payload.gpu) ? payload.gpu : [], `remote:${alias}`),
          system: readRemoteSystem(payload, alias),
        })
        for (const transfer of Array.isArray(payload.transfers) ? payload.transfers : []) {
          remoteTransfers.push({ ...transfer, alias })
        }
        if (alias === options.remoteAlias) {
          remotePayload = payload
          remote = mapRemote(payload, maxItems, aliasOptions)
          snapshot.remote.ok = true
          snapshot.remote.host = remote.host
        }
      } catch (error) {
        remotes.push({
          alias,
          host: '',
          primary: alias === options.remoteAlias,
          available: false,
          error: error instanceof Error ? error.message : String(error),
          gpus: [],
          system: null,
        })
        if (alias === options.remoteAlias) snapshot.remote.error = error instanceof Error ? error.message : String(error)
      }
    }
  }

  const localGpu = options.showLocal ? await readLocalGpu() : { available: false, error: 'local scan disabled', gpus: [] }
  const primaryRemote = remotes.find(entry => entry.primary === true)
  snapshot.gpu = {
    local: { ...localGpu, gpus: decorateGpus(localGpu.gpus, 'local'), system: options.showLocal ? readLocalSystem() : null },
    remotes,
    remote: {
      available: snapshot.remote.ok,
      error: snapshot.remote.error,
      gpus: primaryRemote?.gpus ?? [],
    },
  }
  snapshot.tasks = buildTasks(await scanTaskEvidence(options.localRoot), remotePayload)

  latestRemoteTransfers = remoteTransfers
  if (latestStaging === null) latestStaging = await readStagingTransfers()
  snapshot.transfers = buildTransferItems(latestStaging, remoteTransfers)

  const downloads = newest([...local.downloads, ...(remote?.downloads ?? [])], maxItems)
  const training = selectTraining([...local.training, ...(remote?.training ?? [])], maxItems)
  const tests = selectTests([...local.tests, ...(remote?.tests ?? [])], maxItems)

  snapshot.downloads = { items: downloads, ...summarize(downloads) }
  snapshot.training = { items: training, ...summarize(training) }
  snapshot.tests = { items: tests, ...summarize(tests) }
  snapshot.tookMs = Date.now() - startedAt
  return snapshot
}

/**
 * Mount the dashboard routes and their cache.
 * @param ctx - host plugin context carrying the web server.
 * @param config - row config from the bundle patch.
 */
export function apply(ctx, config) {
  const options = normalizeConfig(config)
  if (options.localRoot === '') {
    let fallback = ''
    try {
      fallback = ctx.get('workingDirectory')?.defaultDirectory ?? ''
    } catch {
      fallback = ''
    }
    options.localRoot = fallback !== '' ? fallback : process.cwd()
  }
  let snapshot = null
  let inflight = null
  let inflightAt = 0

  const refresh = (force) => {
    const fresh = snapshot !== null && Date.now() - snapshot.generatedAt < options.refreshSeconds * 1000
    if (!force && fresh) return Promise.resolve(snapshot)
    if (inflight !== null) return inflight
    inflightAt = Date.now()
    inflight = buildSnapshot(ctx.webServer, options)
      .then(result => {
        snapshot = result
        return result
      })
      .catch(error => {
        const fallback = snapshot ?? {
          generatedAt: Date.now(),
          tookMs: 0,
          refreshMs: options.refreshSeconds * 1000,
          local: { enabled: options.showLocal, root: options.localRoot, ok: false, error: 'snapshot failed' },
          remote: { enabled: false, alias: options.remoteAlias, ok: false, error: null, host: '' },
          downloads: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
          training: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
          tests: { items: [], count: 0, bytes: 0, running: 0, passed: 0, failed: 0 },
          transfers: { active: [], completed: [], stagingDir: '' },
          gpu: {
            local: { available: false, error: null, gpus: [], system: null },
            remotes: [],
            remote: { available: false, error: null, gpus: [] },
          },
          tasks: null,
        }
        fallback.lastError = error instanceof Error ? error.message : String(error)
        return fallback
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  const state = {
    kind: 'exact',
    path: '/api/dino-dashboard/state',
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'forbidden: loopback-only' })
      if (request.method !== 'GET') return writeJson(response, 405, { error: 'method not allowed' })
      try {
        return writeJson(response, 200, await refresh(false))
      } catch (error) {
        return writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const force = {
    kind: 'exact',
    path: '/api/dino-dashboard/refresh',
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'forbidden: loopback-only' })
      if (request.method !== 'POST' && request.method !== 'GET') return writeJson(response, 405, { error: 'method not allowed' })
      try {
        return writeJson(response, 200, await refresh(true))
      } catch (error) {
        return writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const transfers = {
    kind: 'exact',
    path: '/api/dino-dashboard/transfers',
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'forbidden: loopback-only' })
      if (request.method !== 'GET') return writeJson(response, 405, { error: 'method not allowed' })
      try {
        if (latestStaging === null) latestStaging = await readStagingTransfers()
        return writeJson(response, 200, buildTransferItems(latestStaging, latestRemoteTransfers))
      } catch (error) {
        return writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const clearTransfers = {
    kind: 'exact',
    path: '/api/dino-dashboard/transfers/clear',
    handler: async (request, response) => {
      if (!isLoopbackRequest(request)) return writeJson(response, 403, { error: 'forbidden: loopback-only' })
      if (request.method !== 'POST') return writeJson(response, 405, { error: 'method not allowed' })
      completedTransfers.length = 0
      if (latestStaging === null) latestStaging = await readStagingTransfers()
      return writeJson(response, 200, buildTransferItems(latestStaging, latestRemoteTransfers))
    },
  }

  const refreshStaging = () => {
    readStagingTransfers().then(value => { latestStaging = value }).catch(() => {})
  }
  refreshStaging()
  ctx.effect(() => {
    const timer = setInterval(refreshStaging, 2000)
    return () => clearInterval(timer)
  }, 'dino-dashboard: transfer tracker')

  ctx.effect(() => {
    const disposers = [state, force, transfers, clearTransfers].map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dino-dashboard: routes')
}
