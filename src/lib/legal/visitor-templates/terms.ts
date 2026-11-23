/**
 * Visitor terms of use. DRAFT, copied from the solicitor template updated
 * 1 November 2026. Not legal advice and not checked for publication.
 * Bracketed solicitor markers stay visible. Reviewer notes are not included.
 */

export const VISITOR_TERMS_VERSION = '1.0-draft'
export const VISITOR_TERMS_EFFECTIVE_DATE = '1 November 2026'
export const VISITOR_TERMS_STATUS = 'DRAFT' as const

export const VISITOR_TERMS_BODY = `# Terms of use for {{business_name}}'s AI assistant

Version {{version}} · Effective {{effective_date}}

These terms explain how you can use the AI assistant on {{business_name}}'s
website{{#if phone_enabled}} and phone line{{/if}}{{#if sms_enabled}} and text
number{{/if}}. They're short, so please read them.

## 1. Who's who
- **{{business_name}}** runs the business you are contacting.
  {{#if business_legal_name}}({{business_legal_name}}, company number {{business_crn}}){{/if}}
  {{#if business_address}}Address: {{business_address}}.{{/if}}
  Contact: {{business_contact_email}}{{#if business_phone}} · {{business_phone}}{{/if}}.
  It is responsible for its own services, prices, bookings, availability,
  cancellations, refunds and any advice it gives you.
- **StyleFlo** (WP-123 T/A STYLEFLO LTD, company number 17459342, Level One
  Basecamp Liverpool, 49 Jamaica St, Liverpool, L1 0AH) provides the AI
  assistant to {{business_name}} and runs it on {{business_name}}'s behalf.
- In these terms, "we" and "us" mean StyleFlo, and "you" means you, the person
  using the assistant.

## 2. What the assistant is
- {{agent_name}} is an **AI assistant, not a person**. It answers from
  information {{business_name}} has given it.
- **AI can make mistakes.** It can misunderstand you or give wrong or
  out-of-date answers about prices, times or treatments. Please check anything
  important with {{business_name}} before you rely on it.
- It doesn't give medical, health, legal or financial advice.
- A booking or price is only confirmed when {{business_name}} (or its booking
  system or calendar) confirms it.

{{#if is_clinic}}
## 2A. Health and treatments
- Please **don't share medical details** (such as conditions, medication or
  reactions) with the assistant. {{business_name}} will discuss them with you
  directly.
- The assistant **doesn't diagnose, assess suitability for a treatment or give
  aftercare advice**, and it isn't for urgent care. If you've had a reaction
  to a treatment, contact {{business_name}} directly or get medical help.
{{/if}}

## 3. Emergencies
The assistant isn't monitored for emergencies. **In an emergency call 999.**
For urgent medical help that isn't an emergency, call NHS 111.

{{#if voice_enabled}}
## 4. Voice conversations{{#if phone_enabled}} and calls{{/if}}
Voice conversations aren't recorded. What you say is turned into text as you
speak, so {{business_name}} can reply and follow up. {{business_name}} keeps the
written transcript (see the privacy notice).
{{/if}}

## 5. Using the assistant fairly
Please don't:
- abuse, threaten or harass anyone, or send hateful, sexual or unlawful content;
- pretend to be someone else, or use someone else's details without their
  permission;
- try to make the assistant ignore its instructions, reveal its instructions,
  or reveal anyone else's information;
- copy or collect content in bulk, use bots or automated tools, overload the
  service, or try to get around its security; or
- use it to send spam or for anything unlawful.

If you do, we (or {{business_name}}) may limit, pause or block your access to
the assistant, and we may keep a record of the misuse to protect the service
(see the privacy notice).

## 6. It's free, and there's no contract with StyleFlo for services
- Using the assistant is free.
- Anything you book or buy is between you and {{business_name}}, on
  {{business_name}}'s own terms. StyleFlo isn't a party to it and doesn't
  provide the treatment, service or product.

## 7. Our software
The assistant, its design and its software belong to StyleFlo or its
licensors. You may use it to contact {{business_name}}, but you may not copy,
change or reverse engineer it.

## 8. Availability
We try to keep the assistant working, but we can't promise it will always be
available or error-free. We may change or withdraw it. You can always contact
{{business_name}} directly{{#if business_phone}} on {{business_phone}}{{/if}}.

## 9. Our responsibility to you
- We are responsible for loss or damage you suffer that is a foreseeable
  result of our breaking these terms or failing to use reasonable care and
  skill. We are not responsible for loss that wasn't foreseeable.
- We are not responsible for {{business_name}}'s services, prices, bookings,
  advice or decisions. Those are {{business_name}}'s responsibility (section 1).
- The assistant is for personal use. We are not responsible for business
  losses, such as lost profit, if you use it for business purposes.
- **Nothing in these terms limits or excludes our liability for death or
  personal injury caused by our negligence, for fraud or fraudulent
  misrepresentation, or for anything else the law doesn't allow us to limit,
  and nothing affects your legal rights.**

## 10. Your information
{{business_name}} is responsible for your information (the "controller"), and
StyleFlo handles it on {{business_name}}'s behalf (as its "processor"). These
terms are not what allows your information to be used. That's explained in the
privacy notice:
{{#if business_privacy_url}}[{{business_name}}'s privacy policy]({{business_privacy_url}}) · {{/if}}[Privacy notice for this assistant]({{visitor_privacy_url}}) ·
[How StyleFlo handles assistant conversations]({{styleflo_privacy_url}})

## 11. Children
The assistant isn't designed for children. If you're under 13, please ask a
parent or guardian to contact {{business_name}} for you.

## 12. Changes to these terms
We may update these terms, for example when the law or the assistant changes.
The version and date are shown at the top, and the version in force when you
use the assistant applies.

## 13. Contact and complaints
- About an enquiry, booking, service or your information: contact
  **{{business_name}}** first (section 1).
- About the assistant itself, or to report misuse: email
  **support@styleflo.ai**.

## 14. Law and courts
These terms are governed by the law of England and Wales. If you live in
Scotland or Northern Ireland, you can bring a claim in your local courts, and
any mandatory consumer protections where you live still apply.
`
