// 测试夹具：严格照 docs/architecture/contract.md §5 的数据模型构造 JSON。
// 不依赖实现，便于在 lib/** 就绪前后复用同一批夹具。

let seq = 0
export function nextId(prefix = 'run') {
  seq += 1
  return `${prefix}-${seq}`
}

/** §5.1 SessionScope */
export function makeScope(overrides = {}) {
  return {
    sessionId: 'root',
    displayName: '当前会话',
    role: 'root',
    depth: 0,
    accent: 'none',
    hasActivity: false,
    ...overrides,
  }
}

/** §5.1 ChannelDelta（附客户端本地累积文本 text，merge 后 Run 的本地形状） */
export function makeChannelDelta({ chunks = [], nextCursor = 0, lossy = false, gapBefore = false, truncated = false } = {}) {
  // client mergePoll 会把 chunks 累积成 output[channel].text（§4.2.2 本地文本缓冲）；
  // 过滤器/搜索直接读该字段，所以夹具同时提供 chunks 与 text，贴近真实 Run 形状。
  return { chunks, text: chunks.map((c) => c.text ?? '').join(''), nextCursor, lossy, gapBefore, truncated }
}

/** §5.1 OutputChunk */
export function makeChunk(text, at = 1_700_000_000_000, channel = 'stdout') {
  return { at, text, channel }
}

/** §5.1 Run */
export function makeRun(overrides = {}) {
  const runId = overrides.runId ?? `bash:${nextId()}`
  return {
    runId,
    kind: 'bash',
    status: 'running',
    ownerSessionId: 'root',
    agent: { id: 'root', name: 'lead', role: 'lead' },
    title: 'Bash',
    command: 'npm test',
    cwd: '/repo',
    startedAt: 1_000,
    durationMs: 500,
    handle: {},
    stoppable: true,
    totals: { stdout: 0, stderr: 0 },
    output: {},
    lossy: false,
    truncated: false,
    ...overrides,
  }
}

/** §5.1 PollResult */
export function makeFrame(overrides = {}) {
  const now = Date.now()
  return {
    protocol: 1,
    sessionId: 'root',
    serverTime: now,
    revision: 1,
    sessions: [makeScope()],
    runs: [],
    removed: [],
    availability: {
      bash: { available: true },
      jobs: { available: true },
      terminals: { available: true },
      tree: { available: true },
    },
    truncated: false,
    nextCursors: {},
    ...overrides,
  }
}

/** §5.3 ViewState（client mergePoll 的初始状态） */
export function makeViewState(overrides = {}) {
  return {
    sessionId: 'root',
    status: 'ready',
    revision: 0,
    sessions: [],
    runs: {},
    order: { running: [], completed: [] },
    columns: {},
    group: { completedCollapsed: true, expandedIds: [] },
    filter: { kind: 'all', sessionIds: null, search: '', autoExpandNew: true, showCompleted: true },
    availability: {
      bash: { available: true },
      jobs: { available: true },
      terminals: { available: true },
      tree: { available: true },
    },
    droppedLines: {},
    pendingFrameRevision: 0,
    ...overrides,
  }
}

/** 深遍历收集所有字符串（对未定死的本地缓冲字段做宽容断言时用） */
export function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out)
  }
  return out
}

/** 断言：本地缓冲里存在包含 needle 的字符串（跨字段形态宽容） */
export function findString(state, needle) {
  return collectStrings(state).filter((s) => s.includes(needle))
}
