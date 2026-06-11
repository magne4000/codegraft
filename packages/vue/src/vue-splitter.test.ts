import { describe, it, expect, beforeAll } from 'vitest'
import { vueSplitter } from './vue-splitter.js'

const SFC = `<template>
  <div/>
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
  it('splits an SFC into vue / typescript / css zones', () => {
    const zones = vueSplitter.split(SFC)
    expect(zones.map((z) => z.language)).toEqual(['vue', 'typescript', 'css'])
    expect(zones[0].source.trim()).toBe('<div/>')
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
    expect(zones.map((z) => z.language)).toEqual(['vue', 'typescript'])
    expect(zones[1].source).toBe('const y = 2')
  })

  it('skips empty/absent sections', () => {
    expect(vueSplitter.split('<template><div/></template>').map((z) => z.language)).toEqual(['vue'])
  })
})

describe('vueSplitter — template expression zones (Tier 2)', () => {
  // The `typescript` zones a template alone yields (i.e. its embedded expressions), in document order.
  const exprs = (template: string): string[] =>
    vueSplitter
      .split(`<template>${template}</template>`)
      .filter((z) => z.language === 'typescript')
      .map((z) => z.source)

  it('extracts interpolation bodies', () => {
    expect(exprs('<p>{{ user.name }} and {{ count + 1 }}</p>')).toEqual([' user.name ', ' count + 1 '])
  })

  it('extracts directive values — v-bind, v-on, v-if, and custom directives', () => {
    expect(exprs('<a :href="url" @click="go(item)" v-if="ok" v-tip="msg"/>')).toEqual(['url', 'go(item)', 'ok', 'msg'])
  })

  it('v-for keeps the iterable and drops the alias (a template-local)', () => {
    expect(exprs('<li v-for="(it, i) in rows.filter(keep)" :key="it.id"/>')).toEqual(['rows.filter(keep)', 'it.id'])
  })

  it('v-slot / `#` value is a binding pattern — not emitted', () => {
    expect(exprs('<C #cell="{ value }"/>')).toEqual([])
    expect(exprs('<C v-slot:row="{ r }"/>')).toEqual([])
  })

  it('a dynamic argument `:[expr]` is itself a reference, alongside the value', () => {
    expect(exprs('<C :[key]="val"/>')).toEqual(['key', 'val'])
  })

  it('skips empty expressions', () => {
    expect(exprs('<p>{{ }}</p><a :x=""/>')).toEqual([])
  })

  it('gives each expression zone the exact document slice at its startOffset', () => {
    const sfc = `<template><b :x="a ? y : z">{{ p.q }}</b></template>`
    for (const zone of vueSplitter.split(sfc)) {
      expect(zone.source).toBe(sfc.slice(zone.startOffset, zone.startOffset + zone.source.length))
    }
  })
})
