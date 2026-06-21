// tests/bridge-stub-loader.mjs — module loader that stubs handler-hermes.cjs
// Bridge test-only. Replace handler-hermes.cjs dengan fake yang return canned response.
//
// FAKE BEHAVIOR:
//   - directChat(prompt, opts) returns canned reply (no real LLM call)
//   - Includes sk-abc... in reply to test redaction

const STUB_PATH = new URL('./stubs/handler-hermes-stub.cjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './handler-hermes.cjs' || specifier.endsWith('/handler-hermes.cjs')) {
    return nextResolve(STUB_PATH, context)
  }
  return nextResolve(specifier, context)
}
