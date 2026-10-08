import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM for source tokens at rest. The key comes from TOKEN_ENC_KEY (32 bytes, base64)
// and lives outside the database; back it up separately.
// Stored format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.

const VERSION = 'v1'
const IV_BYTES = 12

export function loadKey(raw = process.env.TOKEN_ENC_KEY): Buffer {
  if (!raw) throw new Error('TOKEN_ENC_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64 encoded')
  return key
}

export function encrypt(plaintext: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map(p => typeof p === 'string' ? p : p.toString('base64url')).join('.')
}

// Throws on a wrong key or a tampered value; never returns garbage.
export function decrypt(payload: string, key: Buffer = loadKey()): string {
  const [version, iv, tag, ciphertext] = payload.split('.')
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognized encrypted token format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
