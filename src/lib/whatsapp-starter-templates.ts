/**
 * en_GB WhatsApp starter templates submitted to Meta during onboarding.
 *
 * These objects are the create payload for POST /{waba-id}/message_templates.
 * Bodies that use {{1}}, {{2}}, … include example.body_text as an array of
 * sample rows, which is the shape the Graph API requires.
 *
 * missed_call_followup was rejected with no rejected_reason. The previous
 * ending "How can we help you today?" opens a new conversation, and a missed
 * voice call is not a request to continue on WhatsApp, so it reads as
 * marketing rather than utility. The replacement is a callback notice.
 * appointment_reminder is a utility reminder; the previous sentence packed
 * four variables into very little fixed text, and it also had no samples.
 * booking_link was not in the rejection notice. Its wording is unchanged.
 * It still ends on {{3}}, which Meta can reject as INVALID_FORMAT; only the
 * missing sample values are added here.
 */

export interface WhatsAppTemplateBodyComponent {
  type: 'BODY';
  text: string;
  example?: {
    body_text: string[][];
  };
}

export interface WhatsAppStarterTemplate {
  name: string;
  category: 'UTILITY';
  language: 'en_GB';
  parameter_format: 'POSITIONAL';
  components: WhatsAppTemplateBodyComponent[];
}

export const RESUBMIT_STARTER_TEMPLATE_NAMES = [
  'missed_call_followup',
  'appointment_reminder',
] as const;

export const STARTER_TEMPLATES_EN_GB: WhatsAppStarterTemplate[] = [
  {
    name: 'appointment_reminder',
    category: 'UTILITY',
    language: 'en_GB',
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, this is a reminder of your appointment with {{2}} on {{3}} at {{4}}. Please reply YES to confirm the appointment, or reply to this message if you need to reschedule.',
        example: {
          body_text: [['Sarah', 'StyleFlo', '12 November 2026', '10:00']],
        },
      },
    ],
  },
  {
    name: 'booking_link',
    category: 'UTILITY',
    language: 'en_GB',
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, thanks for reaching out to {{2}}! You can view our services and book online anytime here: {{3}}',
        example: {
          body_text: [['Sarah', 'StyleFlo', 'https://styleflo.ai/book']],
        },
      },
    ],
  },
  {
    name: 'missed_call_followup',
    category: 'UTILITY',
    language: 'en_GB',
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, this is {{2}}. We were unable to take your call at {{3}}. We have noted your missed call and will call you back as soon as we can.',
        example: {
          body_text: [['Sarah', 'StyleFlo', '10:15']],
        },
      },
    ],
  },
];

export interface MissedCallFollowupSendInput {
  customerName: string;
  businessName: string;
  callTime: string;
}

/**
 * Body parameters for sending missed_call_followup, in template order:
 * {{1}} customer name, {{2}} business name, {{3}} call time.
 */
export function buildMissedCallFollowupSendComponents(input: MissedCallFollowupSendInput) {
  const template = STARTER_TEMPLATES_EN_GB.find((item) => item.name === 'missed_call_followup');
  const text = template?.components.find((item) => item.type === 'BODY')?.text ?? '';
  const indexes = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const expected = indexes.length > 0 ? Math.max(...indexes) : 0;
  const values = [input.customerName, input.businessName, input.callTime].map((value) => value.trim());

  if (values.length !== expected || values.some((value) => value.length === 0)) {
    throw new Error(`missed_call_followup requires ${expected} non-empty body parameters`);
  }

  return [
    {
      type: 'body' as const,
      parameters: values.map((textValue) => ({ type: 'text' as const, text: textValue })),
    },
  ];
}

/**
 * Account fields safe to return to the dashboard. Drops encrypted credentials.
 */
export function publicWhatsAppAccount<T extends object>(
  account: T,
  starterTemplateStatuses: Record<string, string> | null,
) {
  const rest: Record<string, unknown> = { ...(account as Record<string, unknown>) };
  delete rest.business_token_enc;
  delete rest.pin_enc;
  return {
    ...rest,
    starter_template_statuses: starterTemplateStatuses,
  };
}
