import { useEffect, useState } from 'react'

// Display-only name-prefix stripping for the Live Traffic graph.
//
// Service names in a single cluster often share a long common prefix
// (e.g. `vce-service-`), which pushes the distinguishing tail off the
// end of the fixed-width node cards (CSS-truncated with an ellipsis).
// Stripping the prefix at RENDER time lets the operator read the part
// that actually differs. It never touches the underlying node id/label,
// so edge matching, tooltips, and flow lookups keep the full name.
//
// Patterns are one per line, gitignore-style:
//   - a plain line is a strip pattern matched against the START of the
//     name; `*` matches lazily (keeps the longest distinguishing tail):
//     `vce-service-*-` on `vce-service-auth-api-gw` strips to `api-gw`
//   - a `!` line is an exclude: a full-name glob (`*` greedy) that keeps
//     matching names unstripped, checked before any strip pattern
//   - strip patterns apply in line order, first match wins; a match that
//     would empty the name is skipped
// `*` is the only special character — everything else is literal, so no
// pattern is ever invalid.
//
// The patterns are a long-lived, cluster-specific constant — persisting
// them avoids re-typing every session, unlike the in-memory traffic
// filter toggles.

const STORAGE_KEY = 'radar.traffic.namePrefix'

export interface TrafficNamePrefix {
  enabled: boolean
  patterns: string
}

const DEFAULT: TrafficNamePrefix = { enabled: false, patterns: '' }

// Accepts both the current shape and the pre-wildcard `{ prefix }` one.
export function normalizeStored(raw: unknown): TrafficNamePrefix {
  if (typeof raw !== 'object' || raw === null) return DEFAULT
  const parsed = raw as { enabled?: unknown; patterns?: unknown; prefix?: unknown }
  const patterns =
    typeof parsed.patterns === 'string'
      ? parsed.patterns
      : typeof parsed.prefix === 'string'
        ? parsed.prefix
        : ''
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
    patterns,
  }
}

function readInitial(): TrafficNamePrefix {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    return normalizeStored(JSON.parse(raw))
  } catch {
    return DEFAULT
  }
}

export function useTrafficNamePrefix(): {
  namePrefix: TrafficNamePrefix
  setNamePrefix: (next: TrafficNamePrefix) => void
} {
  const [namePrefix, setNamePrefix] = useState<TrafficNamePrefix>(readInitial)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(namePrefix))
    } catch {
      // Private-mode / quota failures shouldn't break the graph — the
      // in-memory state still drives this session; we just don't persist.
    }
  }, [namePrefix])

  return { namePrefix, setNamePrefix }
}

interface NameRule {
  exclude: boolean
  re: RegExp
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePatterns(text: string): NameRule[] {
  const rules: NameRule[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const exclude = line.startsWith('!')
    const body = exclude ? line.slice(1).trim() : line
    if (!body) continue
    const parts = body.split('*').map(escapeRegex)
    const re = exclude ? new RegExp(`^${parts.join('.*')}$`) : new RegExp(`^${parts.join('.*?')}`)
    rules.push({ exclude, re })
  }
  return rules
}

// stripNamePrefix runs per node per render — cache the compiled rules for
// the (single) active pattern text instead of re-parsing every call.
let compiledForText: string | null = null
let compiledRules: NameRule[] = []

function rulesFor(text: string): NameRule[] {
  if (text !== compiledForText) {
    compiledForText = text
    compiledRules = parsePatterns(text)
  }
  return compiledRules
}

// Strip the first matching prefix pattern from a display name when enabled.
// Returns the original when disabled, no pattern matches, an exclude rule
// matches, or stripping would empty the name.
export function stripNamePrefix(name: string, cfg: TrafficNamePrefix): string {
  if (!cfg.enabled || !cfg.patterns) return name
  const rules = rulesFor(cfg.patterns)
  for (const rule of rules) {
    if (rule.exclude && rule.re.test(name)) return name
  }
  for (const rule of rules) {
    if (rule.exclude) continue
    const m = rule.re.exec(name)
    if (m && m[0].length > 0 && m[0].length < name.length) return name.slice(m[0].length)
  }
  return name
}

// Strip only real cluster workload names — Internet/addon/external nodes carry
// synthetic labels ("Internet", host names) that a workload-name prefix
// shouldn't clip.
export function stripWorkloadLabel(label: string, kind: string, cfg?: TrafficNamePrefix): string {
  if (!cfg) return label
  const synthetic =
    kind === 'Internet' || kind === 'AddonInternet' || kind === 'Addon' || kind.toLowerCase() === 'external'
  return synthetic ? label : stripNamePrefix(label, cfg)
}
