import { describe, it, expect, beforeAll } from 'vitest'
import { vueSplitter } from './vue-splitter.js'

const SFC = `<template>
  <div>{{ x }}</div>
</template>

<script setup lang="ts">
const x = 1
</script>

<style scoped>
a { color: red }
</style>
`

beforeAll(async () => {
  await vueSplitter.init()
})

describe('vueSplitter', () => {
  it('splits an SFC into html / typescript / css zones', () => {
    const zones = vueSplitter.split(SFC)
    expect(zones.map((z) => z.language)).toEqual(['html', 'typescript', 'css'])
    expect(zones[1].source.trim()).toBe('const x = 1')
    expect(zones[2].source.trim()).toBe('a { color: red }')
  })

  it('gives each zone the exact source slice at its startOffset (no off-by-one)', () => {
    for (const zone of vueSplitter.split(SFC)) {
      expect(zone.source).toBe(SFC.slice(zone.startOffset, zone.startOffset + zone.source.length))
    }
  })

  it('selects the script grammar from lang (none → js, ts, tsx)', () => {
    expect(vueSplitter.split('<script>const x = 1</script>')[0].language).toBe('javascript')
    expect(vueSplitter.split('<script lang="ts">const x = 1</script>')[0].language).toBe('typescript')
    expect(vueSplitter.split('<script lang="tsx">const x = <div/></script>')[0].language).toBe('tsx')
  })

  it('is driven by the CST, not a regex — script-like template text is not a zone', () => {
    const sfc = '<template><pre>&lt;/script&gt; sample</pre></template>\n<script lang="ts">const y = 2</script>'
    const zones = vueSplitter.split(sfc)
    expect(zones.map((z) => z.language)).toEqual(['html', 'typescript'])
    expect(zones[1].source).toBe('const y = 2')
  })

  it('skips empty/absent sections', () => {
    expect(vueSplitter.split('<template><div/></template>').map((z) => z.language)).toEqual(['html'])
  })
})
