/**
 * tree.mjs — 会话树归并（root + 子代理 + Agent Team 队友）→ SessionScope[]。
 *
 * 契约：docs/architecture/contract.md §5.1 `SessionScope`、§5.2 归属规则、§11.1。
 * 纯函数：不读 DSH 服务，只把 `subagents.listDescendants()` 与
 * `agentTeams.listMembers()` 的返回值归一。
 *
 * 归属规则：
 *  - root 恒在首位（depth 0，accent 'none'）；
 *  - 同一 id 同时是「队友」与「子代理」时**队友优先**（信息更全，见 §5.2）；
 *  - `kind:'diagnostic'` 行没有 activity 字段 → 跳过，只把树标成降级；
 *  - 输出按 depth 升序、同 depth 保持输入顺序（稳定排序）。
 */

/** @typedef {'root'|'lead'|'subagent'|'teammate'} ScopeRole */
/** @typedef {'none'|'subagent'|'teammate'} Accent */

/**
 * 归并会话树。
 * @param {{
 *   rootSessionId: string,
 *   rootName?: string,
 *   descendants?: Array<object>,
 *   members?: Array<object>,
 * }} input
 * @returns {object[]} SessionScope[]
 */
export function mergeSessionTree(input) {
  const rootSessionId = typeof input?.rootSessionId === 'string' ? input.rootSessionId : ''
  const descendants = Array.isArray(input?.descendants) ? input.descendants : []
  const members = Array.isArray(input?.members) ? input.members : []
  const rootName = typeof input?.rootName === 'string' && input.rootName.length > 0
    ? input.rootName
    : '当前会话'

  /** @type {Map<string, {scope: object, order: number}>} */
  const byId = new Map()
  const rootScope = {
    sessionId: rootSessionId,
    displayName: rootName,
    role: 'root',
    depth: 0,
    accent: 'none',
    hasActivity: false,
  }
  byId.set(rootSessionId, { scope: rootScope, order: 0 })
  let order = 0

  // 队友：TeamMemberView { id, name, role:'lead'|'teammate', status, ... }
  for (const member of members) {
    if (member === null || typeof member !== 'object') continue
    if (typeof member.id !== 'string' || member.id.length === 0) continue
    order += 1
    if (member.id === rootSessionId) continue
    byId.set(member.id, {
      order,
      scope: {
        sessionId: member.id,
        displayName: typeof member.name === 'string' && member.name.length > 0 ? member.name : member.id,
        role: member.role === 'lead' ? 'lead' : 'teammate',
        parentSessionId: rootSessionId,
        depth: 1,
        accent: 'teammate',
        hasActivity: false,
      },
    })
  }

  // 子代理：Subagent descendant 行
  for (const entry of descendants) {
    if (entry === null || typeof entry !== 'object') continue
    // diagnostic 行没有 activity，直接跳过（scout §11.9 的坑）。
    if (entry.kind !== 'child') continue
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    order += 1
    if (byId.has(entry.id)) continue // 队友优先
    const parentId = typeof entry.parentId === 'string' ? entry.parentId : rootSessionId
    const depth = Number.isSafeInteger(entry.depth) && entry.depth > 0 ? entry.depth : 1
    byId.set(entry.id, {
      order,
      scope: {
        sessionId: entry.id,
        displayName: friendlyLabel(entry.label) ?? entry.id,
        role: 'subagent',
        parentSessionId: parentId,
        depth,
        accent: 'subagent',
        hasActivity: entry.activity === 'running',
      },
    })
  }

  const scopes = [...byId.values()]
    .filter((item) => item.scope.sessionId.length > 0)
    .sort((left, right) => {
      if (left.scope.depth !== right.scope.depth) return left.scope.depth - right.scope.depth
      return left.order - right.order
    })
    .map((item) => item.scope)
  return scopes
}

/**
 * 子代理 label 兜底：空串/非字符串 → undefined。
 * @param {unknown} label
 * @returns {string|undefined}
 */
function friendlyLabel(label) {
  if (typeof label !== 'string') return undefined
  const trimmed = label.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * 查找某 session 的 scope。
 * @param {object[]} sessions
 * @param {string} sessionId
 * @returns {object|undefined}
 */
export function scopeOf(sessions, sessionId) {
  if (!Array.isArray(sessions)) return undefined
  return sessions.find((scope) => scope.sessionId === sessionId)
}

/**
 * 标记「有命令行活动」的会话（ui-spec §4：筛选列表只显示有活动的会话）。
 * @param {object[]} sessions
 * @param {Iterable<string>} ownerSessionIds
 * @returns {object[]} 新数组（不改变入参）
 */
export function markActivity(sessions, ownerSessionIds) {
  const active = new Set(ownerSessionIds)
  return (Array.isArray(sessions) ? sessions : []).map((scope) => ({
    ...scope,
    hasActivity: scope.hasActivity === true || active.has(scope.sessionId),
  }))
}

/**
 * 树是否完整（有 diagnostic 行长说明某分支读失败 → 契约 §8 的 tree 降级）。
 * @param {Array<object>} descendants
 * @returns {{healthy: boolean, diagnostics: number}}
 */
export function treeHealth(descendants) {
  const list = Array.isArray(descendants) ? descendants : []
  const diagnostics = list.filter((entry) => entry?.kind === 'diagnostic').length
  return { healthy: diagnostics === 0, diagnostics }
}
