import type { GrammarId } from './types.js'

// Canonical file-extension → grammar metadata, shared by the cli and unplugin
// front-ends (the engine itself is extension-agnostic). SFC extensions like .vue are
// handled by a ZoneSplitter, not here.
export const EXTENSION_GRAMMAR: Record<string, GrammarId> = {
  tsx: 'tsx',
  jsx: 'tsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  html: 'html',
  htm: 'html',
  css: 'css',
  yaml: 'yaml',
  yml: 'yaml',
}
