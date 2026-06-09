import { it, expect } from 'vitest'
import { createCodemodTransformer } from '@codegraft/core'
import { removeUnusedImports } from './remove-unused-imports.js'

// Mirror `codegraft build`: take ONLY the stringified body (as serialise.ts does), reconstruct the
// function in a scope with no access to this module, and run it. If the body referenced any
// module-scope helper/import, this throws or misbehaves — proving self-containment.
it('the body serialises self-contained (codegraft build path)', async () => {
  const body = removeUnusedImports.fn.toString()
  // eslint-disable-next-line no-new-func — exactly the trust boundary `codegraft build` relies on
  const rebuilt = new Function(`return (${body})`)() as typeof removeUnusedImports.fn
  const t = await createCodemodTransformer('tsx', rebuilt).init()
  expect(t.transform("import { foo, bar } from 'm'\nbar()", {})).toBe("import { bar } from 'm'\nbar()")
})
