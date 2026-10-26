/**
 * store.mjs — 进程内 Run 注册表（纯数据结构，无 DSH / React 依赖）。
 *
 * 职责：
 *  - 维护 Run 元信息（契约 §5.1 `Run` 去掉 output 后的部分）；
 *  - 维护每通道「尚未交付给客户端的增量」（pending），由采集器写入、帧组装消费；
 *  - 维护服务端已知的客户端游标（runId → RunCursor）与 terminal 行窗口状态；
 *  - 维护终态 Run 的保留窗口与 removed 列表（契约 §4.2.5）；
 *  - 单调状态机：进入终态后不回到 running（契约 §6.1）。
 *
 * 纯逻辑约束：时间一律由调用方传入 `now`（缺省 Date.now），方便 node:test 冻结时间。
 */

import { isTerminalStatus } from './status.mjs'

/** @typedef {{stdout?: object, stderr?: object, job?: object, terminal?: object}} OutputMap */

const RUN_ORDER_KIND = { bash: 0, job: 1, terminal: 2 }

/**
 * createRunStore — 创建一张 Run 注册表。
 * @param {{completedLimit?: number, retainCompletedMs?: number, now?: () => number}} [options]
 */
export function createRunStore(options = {}) {
  const completedLimit = Number.isSafeInteger(options.completedLimit) && options.completedLimit > 0
    ? options.completedLimit
    : 50
  const retainCompletedMs = Number.isFinite(options.retainCompletedMs) && options.retainCompletedMs > 0
    ? options.retainCompletedMs
    : 300_000
  const clock = typeof options.now === 'function' ? options.now : () => Date.now()

  /** @type {Map<string, object>} runId → 记录（含内部字段） */
  const records = new Map()
  /** @type {Map<string, OutputMap>} runId → 未交付增量 */
  const pending = new Map()
  /** @type {Map<string, object>} runId → 非序列化的活句柄 / 采集器私有状态 */
  const live = new Map()
  /** @type {Map<string, object>} runId → 服务端已知游标 */
  const cursors = new Map()
  /** @type {Map<string, object>} runId → terminal 行窗口 */
  const windows = new Map()
  /** @type {string[]} 已移除、待下一帧告知客户端的 runId */
  let removed = []
  let revision = 0

  /** 记录 Run 元信息发生变化（下一帧必带）。 */
  function touch(record) {
    record.metaDirty = true
  }

  /**
   * 新增或更新一个 Run。
   * @param {object} input 见下方字段
   * @returns {object} 记录
   */
  function upsert(input) {
    const runId = input.runId
    if (typeof runId !== 'string' || runId.length === 0) throw new Error('store.upsert: runId is required')
    const now = Number.isFinite(input.now) ? input.now : clock()
    let record = records.get(runId)
    if (record === undefined) {
      record = {
        runId,
        kind: input.kind,
        ownerSessionId: input.ownerSessionId,
        agent: input.agent,
        title: input.title ?? input.kind,
        command: input.command,
        cwd: input.cwd,
        status: input.status ?? 'running',
        stopping: input.stopping === true,
        startedAt: Number.isFinite(input.startedAt) ? input.startedAt : now,
        finishedAt: Number.isFinite(input.finishedAt) ? input.finishedAt : undefined,
        exitCode: input.exitCode ?? null,
        signal: input.signal ?? null,
        progress: input.progress,
        detail: input.detail,
        handle: input.handle ?? {},
        stoppable: input.stoppable === true,
        totals: input.totals ?? {},
        lastOutputAt: now,
        finalOnly: input.finalOnly === true,
        outputMode: input.outputMode ?? (input.finalOnly === true ? 'final-only' : 'live'),
        absorbedBy: undefined,
        createdAt: now,
        metaDirty: true,
      }
      records.set(runId, record)
      return record
    }

    // 来源字段：只覆盖调用方明确给出的值，避免把已有信息抹掉。
    // 只有**真的变化**才标 metaDirty —— 否则每轮 poll 都会把全部 Run 重发一遍。
    let changed = false
    const assign = (key, value) => {
      if (record[key] !== value) {
        record[key] = value
        changed = true
      }
    }
    const assignOptional = (key, value, skipWhenUndefined = true) => {
      if (skipWhenUndefined && value === undefined) return
      assign(key, value)
    }

    if (input.kind !== undefined) assign('kind', input.kind)
    if (input.ownerSessionId !== undefined) assign('ownerSessionId', input.ownerSessionId)
    if (input.agent !== undefined) {
      const next = input.agent
      const previous = record.agent
      if (previous === undefined || next === null || typeof next !== 'object'
        || previous.id !== next.id || previous.name !== next.name || previous.role !== next.role) {
        record.agent = next
        changed = true
      }
    }
    assignOptional('title', input.title)
    assignOptional('command', input.command)
    assignOptional('cwd', input.cwd)
    assignOptional('progress', input.progress)
    if (input.detail !== undefined) assign('detail', input.detail === null ? undefined : input.detail)
    if (input.stoppable !== undefined) assign('stoppable', input.stoppable === true)
    if (input.finalOnly !== undefined) assign('finalOnly', input.finalOnly === true)
    if (input.outputMode !== undefined) assign('outputMode', input.outputMode)
    if (input.absorbedBy !== undefined) assign('absorbedBy', input.absorbedBy)
    if (input.handle !== undefined) {
      const merged = { ...record.handle, ...input.handle }
      if (JSON.stringify(merged) !== JSON.stringify(record.handle)) {
        record.handle = merged
        changed = true
      }
    }
    if (input.totals !== undefined) {
      const merged = { ...record.totals, ...input.totals }
      if (JSON.stringify(merged) !== JSON.stringify(record.totals)) {
        record.totals = merged
        changed = true
      }
    }
    if (input.exitCode !== undefined && record.exitCode !== input.exitCode) {
      record.exitCode = input.exitCode
      changed = true
    }
    if (input.signal !== undefined && record.signal !== input.signal) {
      record.signal = input.signal
      changed = true
    }

    const previousStatus = record.status
    // 单调：终态不回 running。终态后仍可更新输出（后台任务恢复）但状态不变。
    if (!isTerminalStatus(previousStatus)) {
      if (input.status !== undefined && record.status !== input.status) {
        record.status = input.status
        changed = true
      }
      const nextStopping = input.stopping === undefined ? record.stopping : input.stopping === true
      if (record.stopping !== nextStopping) {
        record.stopping = nextStopping
        changed = true
      }
    }
    if (isTerminalStatus(record.status) && !isTerminalStatus(previousStatus)) {
      const finishedAt = Number.isFinite(input.finishedAt) ? input.finishedAt : now
      if (record.finishedAt !== finishedAt) {
        record.finishedAt = finishedAt
        changed = true
      }
      if (record.stopping !== false) {
        record.stopping = false
        changed = true
      }
    } else if (Number.isFinite(input.finishedAt) && record.finishedAt !== input.finishedAt) {
      record.finishedAt = input.finishedAt
      changed = true
    }
    if (input.startedAt !== undefined && Number.isFinite(input.startedAt)
      && previousStatus === 'running' && record.startedAt !== input.startedAt) {
      record.startedAt = input.startedAt
      changed = true
    }
    if (changed) touch(record)
    return record
  }

  /** @param {string} runId */
  function get(runId) {
    return records.get(runId)
  }

  /** @returns {object[]} */
  function all() {
    return [...records.values()]
  }

  /** @param {string} runId */
  function remove(runId) {
    if (!records.has(runId)) return false
    records.delete(runId)
    pending.delete(runId)
    live.delete(runId)
    cursors.delete(runId)
    windows.delete(runId)
    if (!removed.includes(runId)) removed.push(runId)
    return true
  }

  /** @param {string} runId @param {object} value */
  function setLive(runId, value) {
    live.set(runId, value)
  }

  /** @param {string} runId */
  function liveOf(runId) {
    return live.get(runId)
  }

  /** @param {string} runId @param {object} value */
  function setWindow(runId, value) {
    windows.set(runId, value)
  }

  /** @param {string} runId */
  function windowOf(runId) {
    return windows.get(runId)
  }

  /**
   * 写入某通道的未交付增量。同通道多帧累加；terminal 用 text 累加。
   * @param {string} runId
   * @param {'stdout'|'stderr'|'job'|'terminal'} channel
   * @param {object} delta
   */
  function setOutput(runId, channel, delta) {
    if (delta === undefined || delta === null) return
    const record = records.get(runId)
    if (record === undefined) return
    let bucket = pending.get(runId)
    if (bucket === undefined) {
      bucket = {}
      pending.set(runId, bucket)
    }
    const previous = bucket[channel]
    if (channel === 'terminal') {
      const text = (previous?.text ?? '') + (delta.text ?? '')
      bucket.terminal = {
        text,
        chunks: [...(previous?.chunks ?? []), ...(delta.chunks ?? [])],
        totalLines: delta.totalLines ?? previous?.totalLines ?? 0,
        lineBegin: delta.lineBegin ?? previous?.lineBegin ?? 0,
        lineEnd: delta.lineEnd ?? previous?.lineEnd ?? 0,
        nextCursor: delta.nextCursor ?? previous?.nextCursor ?? 0,
        truncated: delta.truncated === true || previous?.truncated === true,
        lossy: delta.lossy === true || previous?.lossy === true,
        gapBefore: previous?.gapBefore === true || delta.gapBefore === true,
      }
      if (text.length > 0) {
        record.lastOutputAt = clock()
        record.totals = { ...record.totals, terminal: (record.totals?.terminal ?? 0) + text.length }
      }
      return
    }
    bucket[channel] = previous === undefined
      ? {
          chunks: [...(delta.chunks ?? [])],
          nextCursor: delta.nextCursor ?? 0,
          lossy: delta.lossy === true,
          gapBefore: delta.gapBefore === true,
          truncated: delta.truncated === true,
        }
      : {
          chunks: [...previous.chunks, ...(delta.chunks ?? [])],
          nextCursor: delta.nextCursor ?? previous.nextCursor,
          lossy: previous.lossy || delta.lossy === true,
          gapBefore: previous.gapBefore || delta.gapBefore === true,
          truncated: delta.truncated === true || previous.truncated === true,
        }
    if ((delta.chunks?.length ?? 0) > 0) {
      record.lastOutputAt = clock()
      const added = (delta.chunks ?? []).reduce((sum, chunk) => sum + textBytes(chunk.text ?? ''), 0)
      record.totals = { ...record.totals, [channel]: (record.totals?.[channel] ?? 0) + added }
    }
  }

  /** 清空某 run 的未交付增量（帧已发出且未被退回时由调用方决定）。 */
  function clearOutput(runId) {
    pending.delete(runId)
  }

  /** @param {string} runId */
  function pendingOf(runId) {
    return pending.get(runId)
  }

  /** @param {string} runId @param {'stdout'|'stderr'|'job'|'terminal'} channel @param {number} value */
  function setCursor(runId, channel, value) {
    const current = cursors.get(runId) ?? {}
    current[channel] = value
    cursors.set(runId, current)
  }

  /** @param {string} runId @returns {object} */
  function cursorOf(runId) {
    return cursors.get(runId) ?? {}
  }

  /**
   * 下一次读取应从哪个游标继续。
   *
   * 优先用「已排队但尚未被帧消费」的 delta.nextCursor，避免同一段字节被读取两次；
   * 帧被退回（restore）时 cursor 不推进，因此仍会重读——保证不丢字节。
   * @param {string} runId
   * @param {'stdout'|'stderr'|'job'|'terminal'} channel
   * @returns {number|undefined}
   */
  function nextReadCursor(runId, channel) {
    const queued = pending.get(runId)?.[channel]
    if (queued !== undefined && Number.isFinite(queued.nextCursor)) return queued.nextCursor
    const committed = cursors.get(runId)?.[channel]
    return Number.isFinite(committed) ? committed : undefined
  }

  /**
   * 帧成功发出后提交游标（只有真正交付给客户端的字节才推进）。
   * @param {Array<{run: object, output: object}>} entries
   */
  function commitCursors(entries) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const runId = entry?.run?.runId
      if (typeof runId !== 'string') continue
      for (const [channel, delta] of Object.entries(entry?.output ?? {})) {
        if (delta !== null && typeof delta === 'object' && Number.isFinite(delta.nextCursor)) {
          setCursor(runId, channel, delta.nextCursor)
        }
      }
    }
  }

  /**
   * 客户端提交的游标合并进服务端视图（客户端游标优先，用于进程内重启/续读对齐）。
   * @param {Record<string, object>|undefined} incoming
   */
  function mergeClientCursors(incoming) {
    if (incoming === null || typeof incoming !== 'object') return
    for (const [runId, value] of Object.entries(incoming)) {
      if (value === null || typeof value !== 'object') continue
      const merged = { ...(cursors.get(runId) ?? {}) }
      for (const channel of ['stdout', 'stderr', 'job', 'terminal']) {
        if (Number.isFinite(value[channel])) merged[channel] = value[channel]
      }
      cursors.set(runId, merged)
    }
  }

  /**
   * 取出本帧要发的 entries（只含元信息变化或有增量的 Run）。
   * 取走后 pending 从注册表移除；如需退回用 restore()。
   * @param {{includeCompleted?: boolean, maxRuns?: number, focusRunId?: string, now?: number}} [options]
   * @returns {Array<{run: object, output: OutputMap}>}
   */
  function takeEntries(options = {}) {
    const includeCompleted = options.includeCompleted !== false
    const maxRuns = Number.isSafeInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : 32
    const now = Number.isFinite(options.now) ? options.now : clock()
    const focusRunId = typeof options.focusRunId === 'string' ? options.focusRunId : undefined

    const candidates = []
    for (const record of records.values()) {
      if (record.absorbedBy !== undefined) continue
      const hasPending = pending.has(record.runId)
      if (!hasPending && record.metaDirty !== true) continue
      if (isTerminalStatus(record.status) && !includeCompleted) {
        // 终态信息变化（刚结束）仍需告知客户端一次，但输出增量不在此开关内丢弃。
        if (!record.metaDirty) continue
      }
      candidates.push(record)
    }

    const running = candidates.filter((record) => !isTerminalStatus(record.status))
    running.sort((left, right) => left.startedAt - right.startedAt)
    const limitedRunning = running.length > maxRuns ? running.slice(running.length - maxRuns) : running
    const completed = candidates.filter((record) => isTerminalStatus(record.status))
    completed.sort((left, right) => (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt))
    const limitedCompleted = completed.slice(0, completedLimit)

    let selected = [...limitedRunning, ...limitedCompleted]
    if (focusRunId !== undefined) {
      const focused = selected.filter((record) => record.runId === focusRunId)
      selected = [...focused, ...selected.filter((record) => record.runId !== focusRunId)]
    }

    /** @type {Array<{run: object, output: OutputMap}>} */
    const entries = []
    for (const record of selected) {
      const output = pending.get(record.runId) ?? {}
      pending.delete(record.runId)
      record.metaDirty = false
      entries.push({ run: serializeRun(record, now), output, record })
    }
    return entries
  }

  /**
   * 把 entries 退回注册表（帧预算裁剪时使用），下次 takeEntries 会重新带上。
   * @param {Array<{run: object, output: OutputMap}>} entries
   */
  function restore(entries) {
    for (const entry of entries) {
      const runId = entry.run.runId
      const record = records.get(runId)
      if (record === undefined) continue
      record.metaDirty = true
      if (entry.output === undefined) continue
      const existing = pending.get(runId) ?? {}
      for (const [channel, delta] of Object.entries(entry.output)) {
        const previous = existing[channel]
        if (delta === undefined || delta === null) continue
        if (channel === 'terminal') {
          existing.terminal = {
            ...delta,
            text: (delta.text ?? '') + (previous?.text ?? ''),
            chunks: [...(delta.chunks ?? []), ...(previous?.chunks ?? [])],
          }
          continue
        }
        existing[channel] = previous === undefined
          ? delta
          : {
              chunks: [...(delta.chunks ?? []), ...previous.chunks],
              nextCursor: previous.nextCursor,
              lossy: previous.lossy || delta.lossy === true,
              gapBefore: delta.gapBefore === true || previous.gapBefore === true,
              truncated: delta.truncated === true || previous.truncated === true,
            }
      }
      pending.set(runId, existing)
    }
  }

  /**
   * 淘汰过期终态 Run（契约 §4.2.5：保留 completedLimit 条 + retainCompletedMs）。
   * @param {number} [now]
   * @returns {string[]} 本次移除的 runId
   */
  function prune(now = clock()) {
    const terminalRecords = [...records.values()].filter((record) => isTerminalStatus(record.status))
    terminalRecords.sort((left, right) => (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt))
    const victims = []
    terminalRecords.forEach((record, index) => {
      const expired = now - (record.finishedAt ?? record.startedAt) > retainCompletedMs
      if (index >= completedLimit || expired) victims.push(record.runId)
    })
    for (const runId of victims) remove(runId)
    return victims
  }

  /** @returns {string[]} */
  function drainRemoved() {
    const drained = removed
    removed = []
    return drained
  }

  /** @returns {number} */
  function bumpRevision() {
    revision += 1
    return revision
  }

  return {
    upsert,
    get,
    all,
    remove,
    setLive,
    liveOf,
    setWindow,
    windowOf,
    setOutput,
    clearOutput,
    pendingOf,
    setCursor,
    cursorOf,
    nextReadCursor,
    commitCursors,
    mergeClientCursors,
    takeEntries,
    restore,
    prune,
    drainRemoved,
    bumpRevision,
    get revision() {
      return revision
    },
    get size() {
      return records.size
    },
    completedLimit,
    retainCompletedMs,
  }
}

/**
 * 记录 → 线上 `Run`（不含 output / nextCursors；由 frame.mjs 补齐）。
 * @param {object} record
 * @param {number} now
 * @returns {object}
 */
export function serializeRun(record, now) {
  const finished = isTerminalStatus(record.status)
  const durationMs = finished
    ? Math.max(0, (record.finishedAt ?? record.startedAt) - record.startedAt)
    : Math.max(0, now - record.startedAt)
  return {
    runId: record.runId,
    kind: record.kind,
    status: record.status,
    ...(record.stopping ? { stopping: true } : {}),
    ownerSessionId: record.ownerSessionId,
    agent: record.agent ?? { id: record.ownerSessionId, name: record.ownerSessionId, role: 'unknown' },
    title: record.title ?? record.kind,
    ...(record.command !== undefined ? { command: record.command } : {}),
    ...(record.cwd !== undefined ? { cwd: record.cwd } : {}),
    startedAt: record.startedAt,
    ...(record.finishedAt !== undefined ? { finishedAt: record.finishedAt } : {}),
    durationMs,
    exitCode: record.exitCode ?? null,
    signal: record.signal ?? null,
    ...(record.progress !== undefined ? { progress: record.progress } : {}),
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
    ...(record.finalOnly ? { finalOnly: true } : {}),
    outputMode: record.outputMode ?? (record.finalOnly === true ? 'final-only' : 'live'),
    handle: record.handle ?? {},
    stoppable: record.stoppable === true,
    totals: record.totals ?? {},
    lossy: false,
    truncated: false,
  }
}

/**
 * UTF-8 字节长度（纯实现，不依赖 Buffer —— 浏览器/测试环境同样可用）。
 * @param {string} text
 * @returns {number}
 */
export function textBytes(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对 → 一个 4 字节码点；跳过低位代理
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/** 按 kind 的稳定排序权重（导出给测试/排序用）。 */
export function kindWeight(kind) {
  return RUN_ORDER_KIND[kind] ?? 9
}
