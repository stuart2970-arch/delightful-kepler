import { NextResponse } from 'next/server'
import { secretsEqual } from '@/lib/security/secrets-equal'

export const RWG_BOOKING_USERNAME_ENV = 'RWG_BOOKING_SERVER_USERNAME'
export const RWG_BOOKING_PASSWORD_ENV = 'RWG_BOOKING_SERVER_PASSWORD'

const REALM = 'Basic realm="Reserve with Google"'

function unauthorized(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': REALM } },
    ),
  }
}

/**
 * Reserve with Google sends HTTP Basic auth on every Booking Server call.
 * The username and password are the ones configured on the Actions Center
 * Booking Server page. Missing configuration fails closed: no availability
 * payload is returned.
 */
export function verifyRwgBookingServerAuth(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; response: NextResponse } {
  const username = (env[RWG_BOOKING_USERNAME_ENV] || '').trim()
  const password = env[RWG_BOOKING_PASSWORD_ENV] ?? ''
  if (!username || password.length === 0) {
    console.error('[RwG] Booking server credentials are not configured.')
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 503 }),
    }
  }

  const header = request.headers.get('authorization') || ''
  const parsed = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim())
  if (!parsed) return unauthorized()

  let decoded = ''
  try {
    decoded = Buffer.from(parsed[1], 'base64').toString('utf8')
  } catch {
    return unauthorized()
  }
  const separator = decoded.indexOf(':')
  if (separator < 0) return unauthorized()

  const givenUser = decoded.slice(0, separator)
  const givenPassword = decoded.slice(separator + 1)
  const userOk = secretsEqual(givenUser, username)
  const passwordOk = secretsEqual(givenPassword, password)
  if (!userOk || !passwordOk) return unauthorized()
  return { ok: true }
}
