import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, loadKey } from '../server/lib/crypto'

const key = randomBytes(32)

describe('token encryption', () => {
  it('round trips', () => {
    const token = 'access-token-ü-🔑'
    const enc = encrypt(token, key)
    expect(enc).not.toContain(token)
    expect(decrypt(enc, key)).toBe(token)
  })

  it('uses a fresh IV each time', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key))
  })

  it('fails with the wrong key', () => {
    const enc = encrypt('secret', key)
    expect(() => decrypt(enc, randomBytes(32))).toThrow()
  })

  it('fails on a tampered value', () => {
    const [v, iv, tag, ct] = encrypt('secret', key).split('.')
    const flipped = Buffer.from(ct!, 'base64url')
    flipped[0]! ^= 1
    expect(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), key)).toThrow()
  })

  it('rejects a missing or wrong-length key', () => {
    expect(() => loadKey('')).toThrow('not set')
    expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow('32 bytes')
    expect(loadKey(key.toString('base64'))).toEqual(key)
  })
})
