// Host 半端测试桩：假 ShellExecution / fake ctx / fake jobs / fake terminals / fake webServer / req / res。
// 全部只实现契约 §2.2（F8–F15）与 §5.2 声明的方法面，不依赖 DSH 运行时。
import { Readable } from 'node:stream'

/* ------------------------------------------------------------------ *
 * 假 ShellExecution（契约 F9）
 *   status / exitCode / signal / done / observed.stdout|stderr.readFrom(fromByte) / kill()
 * 只实现只读旁路 readFrom；readOutput() 是消费式的，本插件禁止使用（§5.2）。
 * ------------------------------------------------------------------ */
export function createFakeShellExecution({ command = '', stdout = '', stderr = '' } = {}) {
  const buffers = {
    stdout: { data: Buffer.from(stdout, 'utf8'), evicted: 0, total: Buffer.byteLength(stdout, 'utf8') },
    stderr: { data: Buffer.from(stderr, 'utf8'), evicted: 0, total: Buffer.byteLength(stderr, 'utf8') },
  }
  const state = { status: 'running', exitCode: null, signal: null }
  const readCalls = []
  let resolveDone
  let settled = false
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })

  function readFrom(channel, fromByte) {
    const from = Number(fromByte)
    if (!Number.isFinite(from) || from < 0) throw new RangeError(`readFrom 游标非法: ${fromByte}`)
    const buf = buffers[channel]
    const absoluteFrom = from + buf.evicted
    const lossy = from < buf.evicted
    const start = Math.max(0, from - buf.evicted)
    const text = buf.data.subarray(start).toString('utf8')
    readCalls.push({ channel, fromByte: from, nextOffset: buf.total, lossy })
    return { text, nextOffset: buf.total, lossy }
  }

  function append(channel, text) {
    const buf = buffers[channel]
    const bytes = Buffer.from(text, 'utf8')
    buf.data = Buffer.concat([buf.data, bytes])
    buf.total += bytes.length
    return buf.total
  }

  function evict(channel, retainBytes) {
    const buf = buffers[channel]
    const drop = buf.data.length - retainBytes
    if (drop <= 0) return buf.evicted
    buf.data = buf.data.subarray(drop)
    buf.evicted += drop
    return buf.evicted
  }

  function settle({ status = 'completed', exitCode = 0, signal = null } = {}) {
    state.status = status
    state.exitCode = exitCode
    state.signal = signal
    if (!settled) {
      settled = true
      resolveDone({ status, exitCode, signal })
    }
  }

  const execution = {
    command,
    get status() {
      return state.status
    },
    get exitCode() {
      return state.exitCode
    },
    get signal() {
      return state.signal
    },
    done,
    observed: {
      stdout: { readFrom: (from) => readFrom('stdout', from) },
      stderr: { readFrom: (from) => readFrom('stderr', from) },
    },
    kill(reason) {
      state.status = 'killed'
      state.signal = state.signal ?? 'SIGTERM'
      settle({ status: 'killed', exitCode: null, signal: state.signal })
      return { outcome: 'requested', reason }
    },
    readOutput() {
      throw new Error('测试桩拒绝 readOutput()：契约 §5.2 要求只用 observed.*.readFrom（消费式游标会丢帧）')
    },
    // —— 测试控制面（不属于 ShellExecution 契约）——
    append,
    evict,
    settle,
    setExit(status, exitCode, signal = null) {
      settle({ status, exitCode, signal })
    },
    get readings() {
      return readCalls.slice()
    },
    get emittedBytes() {
      return { stdout: buffers.stdout.total, stderr: buffers.stderr.total }
    },
  }
  return execution
}

/* ------------------------------------------------------------------ *
 * 假 jobs 服务（契约 F8）
 *   list(caller?) / get(id, caller?) / readAt(id, from, caller?) / kill(id, caller?, reason?)
 * ------------------------------------------------------------------ */
export function createFakeJobsService(initial = []) {
  const jobs = new Map()
  const readCalls = []

  function addJob(spec) {
    const job = {
      id: spec.id,
      kind: spec.kind ?? 'background',
      label: spec.label ?? spec.id,
      owner: spec.owner ?? 'root',
      status: spec.status ?? 'running',
      progress: spec.progress,
      detail: spec.detail,
      startedAt: spec.startedAt ?? 1_000,
      finishedAt: spec.finishedAt,
      buffer: { data: Buffer.alloc(0), evicted: 0, total: 0 },
      output: null,
    }
    jobs.set(job.id, job)
    if (spec.output) appendJobOutput(job.id, spec.output)
    job.output = { total: job.buffer.total, earliest: job.buffer.evicted }
    return job
  }

  function appendJobOutput(id, text) {
    const job = jobs.get(id)
    if (!job) throw new Error(`unknown job ${id}`)
    const bytes = Buffer.from(text, 'utf8')
    job.buffer.data = Buffer.concat([job.buffer.data, bytes])
    job.buffer.total += bytes.length
    job.output = { total: job.buffer.total, earliest: job.buffer.evicted }
  }

  function viewOf(job) {
    return {
      id: job.id,
      kind: job.kind,
      label: job.label,
      owner: job.owner,
      status: job.status,
      progress: job.progress,
      detail: job.detail,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      output: { total: job.buffer.total, earliest: job.buffer.evicted },
    }
  }

  const service = {
    list(caller) {
      return [...jobs.values()]
        .filter((j) => caller == null || j.owner === caller || j.owner === 'root')
        .map(viewOf)
    },
    get(id, caller) {
      const job = jobs.get(id)
      if (!job) return undefined
      if (caller != null && job.owner !== caller && job.owner !== 'root') return undefined
      return viewOf(job)
    },
    readAt(id, from, caller) {
      const job = jobs.get(id)
      if (!job) throw new Error(`unknown job ${id}`)
      if (caller != null && job.owner !== caller) throw new Error(`job ${id} 不属于 caller ${caller}`)
      const offset = Number(from) || 0
      const lossy = offset < job.buffer.evicted
      const start = Math.max(0, offset - job.buffer.evicted)
      const text = job.buffer.data.subarray(start).toString('utf8')
      readCalls.push({ id, from: offset, next: job.buffer.total, lossy })
      return {
        chunks: text ? [{ at: Date.now(), text, channel: 'job' }] : [],
        next: job.buffer.total,
        lossy,
      }
    },
    kill(id, caller, reason) {
      const job = jobs.get(id)
      if (!job) return 'already-finished'
      if (job.status !== 'running' && job.status !== 'stopping') return 'already-finished'
      job.status = 'killed'
      job.finishedAt = Date.now()
      job.detail = reason ?? job.detail
      return 'requested'
    },
    // 测试控制面
    addJob,
    appendJobOutput,
    finishJob(id, status, detail) {
      const job = jobs.get(id)
      job.status = status
      job.finishedAt = Date.now()
      if (detail) job.detail = detail
    },
    get jobs() {
      return jobs
    },
    get readCalls() {
      return readCalls.slice()
    },
  }
  for (const spec of initial) addJob(spec)
  return service
}

/* ------------------------------------------------------------------ *
 * 假 terminals 服务（契约 F10）
 *   list(owner) / read(owner, id, {offset,count}) / kill(owner, id, reason?) / hasOwnerActivity(owner)
 * ------------------------------------------------------------------ */
export function createFakeTerminalsService(initial = []) {
  const sessions = new Map()
  const readCalls = []

  function addTerminal(spec) {
    const lines = spec.lines ?? []
    sessions.set(spec.id, {
      id: spec.id,
      owner: spec.owner ?? 'root',
      snapshot: {
        sessionId: spec.id,
        name: spec.name ?? spec.id,
        type: spec.type ?? 'pty',
        pid: spec.pid ?? 4242,
        status: spec.status ?? { kind: 'running' },
      },
      lines,
      evicted: 0,
    })
    return sessions.get(spec.id)
  }

  function appendLines(id, lines) {
    sessions.get(id).lines.push(...lines)
  }

  const service = {
    list(owner) {
      const ownerId = owner?.id ?? owner
      return [...sessions.values()]
        .filter((s) => s.owner === ownerId)
        .map((s) => ({ ...s.snapshot }))
    },
    read(owner, id, opts = {}) {
      const ownerId = owner?.id ?? owner
      const s = sessions.get(id)
      if (!s) throw new Error(`unknown terminal ${id}`)
      if (s.owner !== ownerId) throw new Error(`terminal ${id} 不属于 owner ${ownerId}`)
      const totalLines = s.lines.length
      const count = Math.min(opts.count ?? 400, 4000)
      const start = Math.max(0, Math.min(opts.offset ?? Math.max(0, totalLines - count), totalLines))
      const slice = s.lines.slice(start, start + count)
      readCalls.push({ owner: ownerId, id, offset: start, count })
      return {
        text: slice.join('\n'),
        totalLines,
        lineBegin: start,
        lineEnd: start + slice.length,
        truncated: start > 0 || start + slice.length < totalLines,
      }
    },
    kill(owner, id, reason) {
      const s = sessions.get(id)
      if (!s) return { outcome: 'already-finished', reason }
      s.snapshot.status = { kind: 'exited', exitCode: 0, signal: null }
      return { outcome: 'requested', reason }
    },
    hasOwnerActivity(owner) {
      const ownerId = owner?.id ?? owner
      return [...sessions.values()].some((s) => s.owner === ownerId)
    },
    // 测试控制面
    addTerminal,
    appendLines,
    get readCalls() {
      return readCalls.slice()
    },
  }
  for (const spec of initial) addTerminal(spec)
  return service
}

/* ------------------------------------------------------------------ *
 * fake ctx（Host apply 装配用）
 * ------------------------------------------------------------------ */
export function createFakeHostCtx({ services = {}, config = {} } = {}) {
  const effects = []
  const routes = []
  const listeners = []
  // 与已安装先例 @local/dsh-popout-window 一致：register 返回 disposer **函数**。
  const webServer = services.webServer ?? {
    register(route) {
      routes.push(route)
      const dispose = () => {
        route.__disposed = true
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
      dispose.dispose = dispose
      return dispose
    },
  }
  // 契约：requestRejection 返回 undefined 放行，返回 401/403 状态码表示拒绝（popout 先例：数字）
  const connection = services.connection ?? {
    requestRejection() {
      return undefined
    },
  }

  const ctx = {
    config,
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    on(event, handler) {
      const entry = { event, handler }
      listeners.push(entry)
      // 与真实 cordis 一致：ctx.on 返回 disposer 函数（profile 内 dsh-better-sidebar 等均以 off() 调用）。
      const dispose = () => {
        const i = listeners.indexOf(entry)
        if (i >= 0) listeners.splice(i, 1)
      }
      dispose.dispose = dispose
      return dispose
    },
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'connection') return connection
      return services[name]
    },
    webServer,
    connection,
    // 可选服务：缺失时为 undefined，插件必须降级而不是抛错（契约 §8）
    jobs: services.jobs,
    shell: services.shell,
    terminals: services.terminals,
    subagents: services.subagents,
    agentTeams: services.agentTeams,
    agents: services.agents,
  }

  return {
    ctx,
    effects,
    routes,
    listeners,
    /** 模拟插件卸载 */
    async dispose() {
      for (const dispose of effects.splice(0)) {
        // cordis disposer 形状容错：函数 / {dispose} / undefined
        if (typeof dispose === 'function') await dispose()
        else if (dispose && typeof dispose.dispose === 'function') await dispose.dispose()
      }
    },
    routeOf(path) {
      return routes.find((r) => r.path === path)
    },
  }
}

export function createFakeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      const dispose = () => {
        route.__disposed = true
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
      dispose.dispose = dispose
      return dispose
    },
  }
}

/* ------------------------------------------------------------------ *
 * fake http req / res（route handler 测试用）
 * ------------------------------------------------------------------ */
export function makeReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body, 'utf8')] : [])
  stream.method = method
  stream.url = '/terminal-panel/rpc'
  stream.headers = { 'content-type': 'application/json', ...headers }
  stream.socket = { remoteAddress: '127.0.0.1' }
  return stream
}

export function makeRes() {
  const chunks = []
  const headers = {}
  let settle
  let settled = false
  const done = new Promise((resolve) => {
    settle = resolve
  })
  const res = {
    statusCode: 200,
    finished: false,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()]
    },
    writeHead(code, h) {
      this.statusCode = code
      if (h) for (const [k, v] of Object.entries(h)) this.setHeader(k, v)
      return this
    },
    write(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk))
      return true
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk))
      this.finished = true
      if (!settled) {
        settled = true
        settle()
      }
      return this
    },
    on() {
      return this
    },
    once() {
      return this
    },
    removeListener() {
      return this
    },
    get headers() {
      return headers
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
    get json() {
      try {
        return JSON.parse(this.body)
      } catch {
        return null
      }
    },
    done,
  }
  return res
}
