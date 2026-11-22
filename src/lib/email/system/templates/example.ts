import { EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY } from '../constants'
import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailTemplate } from '../types'

/**
 * Used by tests only. The registry includes it when PLAYWRIGHT_TEST=true
 * and leaves it out of production sends.
 */
export const exampleSystemEmailTemplate: SystemEmailTemplate = {
  key: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
  sampleData: {
    recipientName: 'Alex',
    businessName: 'Example Salon',
  },
  render(data) {
    const name = data.recipientName?.trim() || 'there'
    const business = data.businessName?.trim() || 'your business'
    return renderBrandedSystemEmail({
      subject: `StyleFlo system email for ${business}`,
      title: 'StyleFlo',
      subtitle: 'System email',
      paragraphs: [
        `Hello ${name},`,
        `This is an example StyleFlo system email for ${business}. It is only used in tests.`,
      ],
    })
  },
}
