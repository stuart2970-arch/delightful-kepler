import formData from 'form-data'
import Mailgun from 'mailgun.js'
import {
  MOCK_SYSTEM_EMAIL_PROVIDER_PREFIX,
  SYSTEM_EMAIL_FROM_NAME,
  SYSTEM_EMAIL_REPLY_TO,
} from './constants'

export type OutboundSystemEmail = {
  to: string
  subject: string
  html: string
  text: string
  replyTo: string
}

export type SystemEmailTransport = (message: OutboundSystemEmail) => Promise<{ id: string }>

const testDeliveries: OutboundSystemEmail[] = []
let mailgunClientCreated = false
let transportOverride: SystemEmailTransport | null = null

export function readSystemEmailTestDeliveries(): readonly OutboundSystemEmail[] {
  return testDeliveries
}

export function wasMailgunClientCreated(): boolean {
  return mailgunClientCreated
}

/** Clears the in-process mock log. Ignored outside Playwright. */
export function resetSystemEmailTestState(): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') return
  testDeliveries.length = 0
  mailgunClientCreated = false
  transportOverride = null
}

/**
 * Test-only seam. Production ignores this and throws if it is called.
 */
export function setSystemEmailTransportForTests(transport: SystemEmailTransport | null): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') {
    throw new Error('System email transport overrides are only available during Playwright tests')
  }
  transportOverride = transport
}

function mockProviderId(): string {
  return `${MOCK_SYSTEM_EMAIL_PROVIDER_PREFIX}${crypto.randomUUID()}`
}

/**
 * Mailgun EU. Playwright never constructs the client: the mock records the
 * message and returns a fake provider id.
 */
export async function deliverSystemEmail(message: OutboundSystemEmail): Promise<{ id: string }> {
  const outbound: OutboundSystemEmail = {
    ...message,
    subject: message.subject.replace(/[\r\n]+/g, ' ').trim(),
    replyTo: SYSTEM_EMAIL_REPLY_TO,
  }

  if (transportOverride) {
    return transportOverride(outbound)
  }

  if (process.env.PLAYWRIGHT_TEST === 'true') {
    testDeliveries.push(outbound)
    return { id: mockProviderId() }
  }

  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN
  if (!apiKey || !domain) {
    throw new Error('Mailgun is not configured')
  }
  if (apiKey.startsWith('mock')) {
    throw new Error('Refusing to call Mailgun with a mock API key')
  }

  const mailgun = new Mailgun(formData)
  mailgunClientCreated = true
  const client = mailgun.client({
    username: 'api',
    key: apiKey,
    url: 'https://api.eu.mailgun.net',
  })
  const result = await client.messages.create(domain, {
    from: `${SYSTEM_EMAIL_FROM_NAME} <no-reply@${domain}>`,
    to: [outbound.to],
    subject: outbound.subject,
    text: outbound.text,
    html: outbound.html,
    'h:Reply-To': outbound.replyTo,
  })
  const id = typeof result.id === 'string' ? result.id.trim() : ''
  if (!id) {
    throw new Error('Mailgun did not return a message id')
  }
  return { id }
}

export function systemEmailReplyTo(): string {
  return SYSTEM_EMAIL_REPLY_TO
}
