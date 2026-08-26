import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const PREFIX = 'scrypt$'
const KEY_LENGTH = 32

/** `scrypt$<salt-hex>$<hash-hex>` — selbstbeschreibend, kein separates Schema nötig. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(plain, salt, KEY_LENGTH)
  return `${PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`
}

export function isHashed(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * Vergleich in konstanter Zeit. Klartextwerte werden rundheraus abgelehnt —
 * gespeichert wird ausschließlich gehasht; steht doch einmal Klartext in der
 * Tabelle, wurde sie von Hand angefasst und ist neu zu setzen, nicht zu
 * vertrauen.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!isHashed(stored)) return false

  const [, saltHex, hashHex] = stored.split('$')
  if (!saltHex || !hashHex) return false

  const expected = Buffer.from(hashHex, 'hex')
  const derived = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), expected.length)

  return expected.length === derived.length && timingSafeEqual(expected, derived)
}
