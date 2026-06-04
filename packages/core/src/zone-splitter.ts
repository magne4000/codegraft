import type { GrammarId, Zone, ZoneSplitter } from './types.js'
import { Parser } from './parser.js'
import { wrapNode } from './rich-node.js'

/**
 * Turn any target into parsed `Zone[]` — the single pipeline the rest of the
 * transform shares. A `GrammarId` becomes one synthetic zone covering the whole
 * source (`startOffset: 0`); a `ZoneSplitter` is asked to `split()` the source into
 * its sections. Either way each raw zone is parsed with its grammar and wrapped.
 *
 * Synchronous: grammar loading (and a `ZoneSplitter`'s own `init()`) happen earlier,
 * in `createTransformer.init`, so by the time we get here every grammar is ready.
 */
export function splitAndParse(source: string, target: GrammarId | ZoneSplitter): Zone[] {
  const rawZones =
    typeof target === 'string'
      ? [{ language: target, source, startOffset: 0 }]
      : target.split(source)

  return rawZones.map((zone) => ({
    language: zone.language,
    source: zone.source,
    startOffset: zone.startOffset,
    tree: wrapNode(Parser.parse(zone.source, zone.language).rootNode, zone.language, zone.startOffset),
  }))
}
