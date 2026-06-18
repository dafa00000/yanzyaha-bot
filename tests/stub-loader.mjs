// tests/stub-loader.mjs — module loader that swaps heavy handlers with stubs
// Resolves paths relative to CWD (project root) since that's where Node runs from.
import { pathToFileURL } from 'node:url'

const STUBS = new Map([
  ['./handler-download.js', './tests/stubs/handler-download.js'],
  ['./handler-autoclip.js', './tests/stubs/handler-autoclip.js'],
])

export async function resolve(specifier, context, nextResolve) {
  if (STUBS.has(specifier)) {
    return nextResolve(pathToFileURL(STUBS.get(specifier)).href, context)
  }
  return nextResolve(specifier, context)
}
