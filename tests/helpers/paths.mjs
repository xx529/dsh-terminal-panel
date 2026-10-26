// 测试公共路径：仓库根 / lib 目录。
// 注意：仅测试使用，不进入生产代码。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HELPER_DIR = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HELPER_DIR, '..', '..')
export const LIB_DIR = resolve(ROOT, 'lib')
export const HOST_DIR = resolve(LIB_DIR, 'host')
export const CLIENT_FILE = resolve(LIB_DIR, 'client.js')
export const HOST_ENTRY = resolve(LIB_DIR, 'index.js')
