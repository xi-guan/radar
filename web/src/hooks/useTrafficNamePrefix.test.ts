import { describe, it, expect } from 'vitest'
import { stripNamePrefix, normalizeStored, type TrafficNamePrefix } from './useTrafficNamePrefix'

const cfg = (patterns: string, enabled = true): TrafficNamePrefix => ({ enabled, patterns })

describe('stripNamePrefix', () => {
  it('returns the name unchanged when disabled', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('vce-service-', false))).toBe('vce-service-auth')
  })

  it('returns the name unchanged when patterns are empty', () => {
    expect(stripNamePrefix('vce-service-auth', cfg(''))).toBe('vce-service-auth')
  })

  it('strips a plain literal prefix', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('vce-service-'))).toBe('auth')
  })

  it('leaves non-matching names unchanged', () => {
    expect(stripNamePrefix('prometheus', cfg('vce-service-'))).toBe('prometheus')
  })

  it('matches * lazily so the longest tail survives', () => {
    expect(stripNamePrefix('vce-service-auth-api-gw', cfg('vce-service-*-'))).toBe('api-gw')
  })

  it('skips a wildcard pattern whose tail requirement is unmet', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('vce-service-*-'))).toBe('vce-service-auth')
  })

  it('never strips a name down to nothing', () => {
    expect(stripNamePrefix('vce-service-', cfg('vce-service-'))).toBe('vce-service-')
  })

  it('falls through to the next rule when a match would empty the name', () => {
    expect(stripNamePrefix('vce-portal', cfg('vce-portal\nvce-'))).toBe('portal')
  })

  it('applies strip rules in line order, first match wins', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('vce-service-\nvce-'))).toBe('auth')
    expect(stripNamePrefix('vce-service-auth', cfg('vce-\nvce-service-'))).toBe('service-auth')
  })

  it('keeps names matching an exclude rule unstripped', () => {
    const c = cfg('vce-service-*-\n!*-gateway')
    expect(stripNamePrefix('vce-service-auth-gateway', c)).toBe('vce-service-auth-gateway')
    expect(stripNamePrefix('vce-service-auth-api', c)).toBe('api')
  })

  it('checks excludes before strips regardless of line order', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('vce-service-\n!vce-service-auth'))).toBe(
      'vce-service-auth',
    )
  })

  it('matches excludes against the full name, anchored', () => {
    expect(stripNamePrefix('vce-service-auth-x', cfg('vce-service-\n!vce-service-auth'))).toBe(
      'auth-x',
    )
  })

  it('ignores blank lines and surrounding whitespace', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('\n  vce-service-  \n\n'))).toBe('auth')
  })

  it('treats regex metacharacters as literals', () => {
    expect(stripNamePrefix('aXb-service', cfg('a.b-'))).toBe('aXb-service')
    expect(stripNamePrefix('a.b-service', cfg('a.b-'))).toBe('service')
  })

  it('treats an all-wildcard pattern as a no-op', () => {
    expect(stripNamePrefix('vce-service-auth', cfg('*'))).toBe('vce-service-auth')
  })
})

describe('normalizeStored', () => {
  it('passes the current shape through', () => {
    expect(normalizeStored({ enabled: true, patterns: 'a-\n!b' })).toEqual({
      enabled: true,
      patterns: 'a-\n!b',
    })
  })

  it('migrates the legacy single-prefix shape', () => {
    expect(normalizeStored({ enabled: true, prefix: 'vce-service-' })).toEqual({
      enabled: true,
      patterns: 'vce-service-',
    })
  })

  it('falls back to defaults on garbage', () => {
    expect(normalizeStored(null)).toEqual({ enabled: false, patterns: '' })
    expect(normalizeStored('vce-')).toEqual({ enabled: false, patterns: '' })
    expect(normalizeStored({ enabled: 'yes', patterns: 42 })).toEqual({ enabled: false, patterns: '' })
  })
})
