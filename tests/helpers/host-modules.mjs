// Host 纯逻辑模块加载器。
//
// 契约：docs/architecture/contract.md §11.1 —— lib/host/*.mjs 被 node:test 直接 import。
// lib/** 由 backend 并行实现，可能尚未落地：缺失时返回 { missing: true }，测试据此 skip；
// 文件存在但导入失败时返回 { missing: false, ok: false }，测试必须失败（这是真实缺陷，不允许 skip）。
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOST_DIR } from './paths.mjs'

const cache = new Map()

/**
 * @param {string} name lib/host/<name>.mjs 的短名
 * @returns {Promise<{ok:true, mod:any, file:string} | {ok:false, missing:boolean, reason:string, file:string, error?:Error}>}
 */
export async function loadHostModule(name) {
  if (cache.has(name)) return cache.get(name)
  const file = join(HOST_DIR, `${name}.mjs`)
  try {
    await access(file)
  } catch {
    const r = { ok: false, missing: true, reason: `lib/host/${name}.mjs 尚未实现（T3 backend 进行中）`, file }
    cache.set(name, r)
    return r
  }
  try {
    const mod = await import(pathToFileURL(file).href)
    const r = { ok: true, mod, file }
    cache.set(name, r)
    return r
  } catch (error) {
    const r = { ok: false, missing: false, reason: `lib/host/${name}.mjs 导入失败：${error.message}`, file, error }
    cache.set(name, r)
    return r
  }
}

/**
 * 测试体开头调用：缺失 → 返回 skip 原因字符串；存在但坏了 → 抛错；正常 → null。
 * 用法：test('x', { skip: gate(m) }, () => { ... })
 */
export function gate(m) {
  if (m.ok) return false
  if (m.missing) return m.reason
  throw new Error(m.reason)
}

/** 取模块导出；缺失或类型不符直接抛错（契约违例，必须失败）。 */
export function fnOf(m, name) {
  if (!m.ok) throw new Error(m.reason)
  const v = m.mod[name]
  if (typeof v !== 'function') {
    throw new Error(`${m.file} 缺少导出函数 ${name}（契约 §11.1）`)
  }
  return v
}

/** Host 入口 lib/index.js（装配测试用） */
export async function loadHostEntry() {
  const { HOST_ENTRY } = await import('./paths.mjs')
  try {
    await access(HOST_ENTRY)
  } catch {
    return { ok: false, missing: true, reason: 'lib/index.js 尚未实现（T3 backend 进行中）', file: HOST_ENTRY }
  }
  try {
    const mod = await import(pathToFileURL(HOST_ENTRY).href)
    return { ok: true, mod, file: HOST_ENTRY }
  } catch (error) {
    return { ok: false, missing: false, reason: `lib/index.js 导入失败：${error.message}`, file: HOST_ENTRY, error }
  }
}
