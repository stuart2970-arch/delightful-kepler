/**
 * Visitor privacy notice. DRAFT, copied from the solicitor template updated
 * 1 November 2026. Not legal advice and not checked for publication.
 * Plain [TBC] gaps stay visible. Reviewer notes are not included.
 */

export const VISITOR_PRIVACY_VERSION = '1.0-draft'
export const VISITOR_PRIVACY_EFFECTIVE_DATE = '1 November 2026'
export const VISITOR_PRIVACY_STATUS = 'DRAFT' as const

export const VISITOR_PRIVACY_BODY = `# Privacy notice: {{business_name}}'s AI assistant

Version {{version}} · Effective {{effective_date}}

This notice explains how your information is used when you chat with, talk to
{{#if phone_enabled}}or call {{/if}}{{#if sms_enabled}}or text {{/if}}the AI assistant
on {{business_name}}'s website. StyleFlo publishes it on {{business_name}}'s behalf.
{{#if business_privacy_url}}You can also read [{{business_name}}'s own privacy
policy]({{business_privacy_url}}).{{/if}}

## 1. Who is responsible for your information
**{{business_name}}** is responsible for your information (the "controller").
{{#if business_legal_name}}{{business_legal_name}}, company number {{business_crn}}.{{/if}}
{{#if business_address}}Address: {{business_address}}.{{/if}}
Contact: {{business_contact_email}}{{#if business_phone}} · {{business_phone}}{{/if}}.

The assistant is provided by **StyleFlo** (WP-123 T/A STYLEFLO LTD, company
number 17459342, Level One Basecamp Liverpool, 49 Jamaica St, Liverpool,
L1 0AH). StyleFlo handles your information for {{business_name}}, on its
instructions (StyleFlo is its "processor").

## 2. What information is used
- **Your details:** your name, and your email address or phone number if you
  give them.
- **Your messages:** what you write in the chat{{#if sms_enabled}} or by text{{/if}}.
{{#if voice_enabled}}- **Voice conversations{{#if phone_enabled}} and calls{{/if}}:** what you say is turned
  into a written transcript as you speak. Calls aren't recorded: StyleFlo's
  speech-to-text suppliers process the audio live, only to produce the
  transcript, and it isn't stored. Only the transcript is kept.{{/if}}
{{#if phone_enabled}}- **Call details:** your phone number, and the time and length of the call.{{/if}}
- **Booking details:** if you ask about or make a booking.
- **Technical information:** such as your IP address and the result of an
  automatic check that you're not a bot.

## 3. Why it is used, and the legal basis
| Why | Legal basis |
|---|---|
| To answer your enquiry and pass it to {{business_name}} | {{business_name}}'s legitimate interests in responding to people who contact it |
| To help you make or change a booking | Taking steps you've asked for before entering into a contract, or performing a contract you have with {{business_name}} |
| So {{business_name}} can follow up on your enquiry or booking | {{business_name}}'s legitimate interests, or performing your contract |
| To keep the assistant secure and stop misuse | Legitimate interests (of {{business_name}} and StyleFlo) in keeping the service safe (see section 5) |
{{#if marketing_enabled}}| To send you marketing, only if you choose to receive it | Your consent, which you can withdraw at any time |{{/if}}

You don't have to give your details, but without a name and a way to reach you,
{{business_name}} may not be able to reply.

{{#if is_clinic}}
## 3A. Health information
Please **don't share medical details** (such as conditions, medication or
reactions) with the assistant. {{business_name}} will discuss them with you
directly. If you share them anyway, they will appear in the transcript. In that
case {{business_name}} relies on {{special_category_basis}}. It keeps
transcripts for a shorter period (section 6) and you can ask it to delete them.
{{/if}}

## 4. Automated decisions
The assistant uses AI to reply to you, but it doesn't make decisions about you
that have legal or similarly significant effects. Any decision about you, such
as whether to accept a booking, is made by {{business_name}} or its booking
system.

## 5. Who receives your information
- **{{business_name}}** and its staff.
- **StyleFlo**, which provides the assistant as {{business_name}}'s processor.
- **StyleFlo's suppliers (sub-processors)**, such as AI, transcription,
  telephony and hosting providers, only to run the assistant. The current list,
  with what each does and where, is here: [Sub-processor list]({{subprocessor_list_url}}).
- StyleFlo also uses limited technical information (such as IP address, bot
  checks and records of misuse) for its own purpose of keeping the assistant
  secure and enforcing its [terms of use]({{visitor_terms_url}}). For that, StyleFlo
  is responsible, as explained in [StyleFlo's privacy policy]({{styleflo_privacy_url}}).
- Others only where the law requires it.

Your information isn't sold, and it isn't used to train AI models for anyone else.

## 6. Where it is stored and international transfers
Transcripts and messages are stored on Google Cloud servers in London.
{{transfers_summary}}
[Placeholder: some suppliers process information outside the UK. For each one,
the sub-processor list says whether UK adequacy regulations apply or which UK
safeguard is used (the UK International Data Transfer Agreement or the UK
Addendum). Text TBC from the list.]

## 7. How long it is kept
{{business_name}} keeps transcripts and messages for
**{{transcript_retention_days}} days** after the conversation, unless it deletes
them sooner. They are then deleted automatically. Calls aren't recorded (section 2).
Technical security records are kept for [period TBC].

## 8. Information stored on your device
The assistant stores a little information in your browser on this website.
| What | Why | How long |
|---|---|---|
| Chat session details | So the chat works and is secure | About 1 hour |
| A note that you've seen the notice | So it isn't shown again during this visit | Until you close the tab |
| Bot check (Cloudflare Turnstile) | To protect the assistant from bots and abuse | Set by Cloudflare |
| Your name and email | So you don't have to type them again next time | Until you press **Forget me** or clear your browser data [expiry TBC] |
The first three are needed for the assistant to work. You can remove your saved
name and email at any time with the **Forget me** link in the chat.

## 9. Your rights
You can ask {{business_name}} to:
- give you a copy of your information;
- correct it;
- delete it;
- restrict how it's used;
- stop using it where it relies on legitimate interests (you can object); and
- give it to you in a format you can reuse, where that applies.

Contact {{business_name}} using the details in section 1. If you contact
StyleFlo instead, we will pass your request to {{business_name}}.

## 10. Children
The assistant isn't designed for children. If you're under 13, please ask a
parent or guardian to contact {{business_name}} for you.

## 11. Complaints
If you're unhappy with how your information is used, please **complain to
{{business_name}} first** (section 1). It must deal with your complaint.
If you're still unhappy, you can complain to the **Information Commission**,
the UK data protection regulator: [web address TBC; ico.org.uk until the new
address is confirmed] · 0303 123 1113.

## 12. Changes
This notice may be updated. The version and date are shown at the top.
`
