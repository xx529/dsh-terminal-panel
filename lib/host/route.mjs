/**
 * route.mjs — HTTP 传输层：`POST /terminal-panel/rpc`（契约 §4.1 / §4.4）。
 *
 * 这是 lib/host 里唯一的非纯逻辑模块（其余 .mjs 均可被 node:test 直接 import）。
 * 职责：
 *  - 方法/Content-Type/请求体上限/认证栅栏的 HTTP 语义；
 *  - 自家 JSON 信封 `{ method, params } → { ok, value } | { ok:false, error }`；
 *  - 错误码到 HTTP 状态的映射（契约 §4.4）；
 *  - 响应体积兜底截断（≤256 KiB，超限帧标 `truncated:true` 并回退 nextCursors）；
 *  - handler 内部 try/catch —— 绝不把异常抛给宿主变成 HTTP 500 纯文本。
 */

/** 固定路由路径（不做配置，避免双端漂移）。 */
export const ROUTE_PATH = '/terminal-panel/rpc'
/** 请求体上限 4 KiB（契约 §4.1）。 */
export const MAX_REQUEST_BYTES = 4096
/** 单次 unary 响应上限 256 KiB（Lead 裁决；宿主对 unary 响应无明确上限）。 */
export const MAX_RESPONSE_BYTES = 262144

const JSON_TYPE = 'application/json'

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value)
  const bytes = Buffer.byteLength(body, 'utf8')
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bytes),
      'cache-control': 'no-store',
      ...headers,
    })
  } catch {
    // 头已发出（对端已断开）时忽略；调用方随后 end() 也会失败。
  }
  try {
    res.end(body)
  } catch {
    // 对端断开属于常态，不向上抛。
  }
}

/**
 * 读取并解析 JSON 请求体（带字节上限）。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 * @throws {{code:'too-large'|'bad-request'}}
 */
export async function readJsonBody(req, maxBytes) {
  const declared = Number(req.headers?.['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error('request body too large')
    error.code = 'too-large'
    throw error
  }
  const chunks = []
  let total = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        const error = new Error('request body too large')
        error.code = 'too-large'
        throw error
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error?.code === 'too-large') throw error
    const wrapped = new Error('request body read failed')
    wrapped.code = 'bad-request'
    throw wrapped
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) {
    const error = new Error('empty request body')
    error.code = 'bad-request'
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body is not valid JSON')
    error.code = 'bad-request'
    throw error
  }
}

/** 错误码 → HTTP 状态（契约 §4.4；业务错误一律 200）。 */
const STATUS_BY_CODE = Object.freeze({
  unauthorized: 401,
  forbidden: 403,
  method: 405,
  'too-large': 413,
  internal: 500,
})

/**
 * 按上限裁剪响应值。只处理带 `runs` 的 poll 帧：从尾部整条丢弃 Run，
 * 并把被丢弃 Run 的 nextCursors 回退为客户端上一轮游标（保证不越读到未交付字节）。
 * @param {unknown} value
 * @param {number} maxBytes
 * @param {Record<string, object>|undefined} previousCursors
 * @returns {unknown}
 */
export function boundResponseValue(value, maxBytes, previousCursors) {
  if (value === null || typeof value !== 'object') return value
  let json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return value
  if (!Array.isArray(value.runs)) {
    // 非 poll 形状：无法裁剪，交给调用方按错误处理。
    return value
  }
  const runs = [...value.runs]
  let truncated = value.truncated === true
  const nextCursors = value.nextCursors !== null && typeof value.nextCursors === 'object'
    ? { ...value.nextCursors }
    : {}
  while (runs.length > 0) {
    runs.pop()
    truncated = true
    json = JSON.stringify({ ...value, runs, truncated, nextCursors })
    if (Buffer.byteLength(json, 'utf8') <= maxBytes) break
  }
  // 被丢弃的 Run 不再出现在本帧：其游标回退到客户端上一轮值（不回退则客户端会跳过未读字节）。
  const kept = new Set(runs.map((run) => run?.runId))
  for (const [runId, cursor] of Object.entries(nextCursors)) {
    if (kept.has(runId)) continue
    if (previousCursors !== null && typeof previousCursors === 'object' && previousCursors[runId] !== undefined) {
      nextCursors[runId] = previousCursors[runId]
    } else {
      delete nextCursors[runId]
    }
  }
  return { ...value, runs, truncated, nextCursors }
}

/**
 * 创建 RPC handler。
 * @param {{
 *   dispatch: (method: string, params: any) => Promise<{ok: true, value: any}|{ok: false, error: {code: string, message?: string, details?: any}}>,
 *   authReject?: (req: import('node:http').IncomingMessage) => number|undefined,
 *   maxBodyBytes?: number,
 *   maxResponseBytes?: number,
 *   logger?: {warn?: (...args: any[]) => void},
 * }} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createRpcHandler(options) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_REQUEST_BYTES
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  const authReject = typeof options.authReject === 'function' ? options.authReject : () => undefined
  const logger = options.logger ?? {}

  return async function terminalPanelRpcHandler(req, res) {
    try {
      // 1) 认证栅栏：与 @local/dsh-popout-window 同款（F21）。
      let rejection
      try {
        rejection = authReject(req)
      } catch (error) {
        logger.warn?.('[terminal-panel] auth check failed:', error?.message ?? error)
        rejection = 403
      }
      if (rejection !== undefined && rejection !== null) {
        const status = typeof rejection === 'number' ? rejection : 401
        const code = status === 401 ? 'unauthorized' : 'forbidden'
        sendJson(res, status, { ok: false, error: { code, message: 'request rejected by the host connection fence' } })
        return
      }
      // 2) 方法
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method', message: 'only POST is supported' } }, { allow: 'POST' })
        return
      }
      // 3) Content-Type
      const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
      if (!contentType.startsWith(JSON_TYPE)) {
        sendJson(res, 415, { ok: false, error: { code: 'bad-request', message: 'content-type must be application/json' } })
        return
      }
      // 4) 请求体
      let body
      try {
        body = await readJsonBody(req, maxBodyBytes)
      } catch (error) {
        const code = error?.code === 'too-large' ? 'too-large' : 'bad-request'
        sendJson(res, code === 'too-large' ? 413 : 400, {
          ok: false,
          error: { code, message: error?.message ?? 'invalid request body' },
        })
        return
      }
      const method = body !== null && typeof body === 'object' ? body.method : undefined
      if (typeof method !== 'string' || method.length === 0) {
        sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'method is required' } })
        return
      }
      const params = body !== null && typeof body === 'object' && body.params !== null && typeof body.params === 'object'
        ? body.params
        : {}
      // 5) 业务分派：任何异常都收敛成 internal 帧，绝不 500 纯文本。
      let result
      try {
        result = await options.dispatch(method, params)
      } catch (error) {
        logger.warn?.(`[terminal-panel] ${method} failed:`, error?.message ?? error)
        sendJson(res, 500, {
          ok: false,
          error: { code: 'internal', message: 'unexpected host-side failure' },
        })
        return
      }
      if (result === null || typeof result !== 'object') {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'handler returned no result' } })
        return
      }
      if (result.ok !== true) {
        const error = result.error !== null && typeof result.error === 'object' ? result.error : { code: 'internal' }
        const code = typeof error.code === 'string' && error.code.length > 0 ? error.code : 'internal'
        const status = STATUS_BY_CODE[code] ?? 200
        sendJson(res, status, { ok: false, error })
        return
      }
      const bounded = boundResponseValue(result.value, maxResponseBytes, params.cursors)
      sendJson(res, 200, { ok: true, value: bounded })
    } catch (error) {
      // 兜底：连错误帧都无法发送时的最后一道防线。
      logger.warn?.('[terminal-panel] rpc handler crashed:', error?.message ?? error)
      try {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'internal transport failure' } })
      } catch {
        // 忽略：对端已断开。
      }
    }
  }
}
