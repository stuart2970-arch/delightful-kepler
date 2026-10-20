import { test, expect } from '@playwright/test';
import {
  formatAllowanceRange,
  buildCheckoutLineDescription,
  validateAddonText,
} from '../src/lib/addon-text';

test.describe('STYL-177: Pure helper unit tests (formatAllowanceRange, buildCheckoutLineDescription, validateAddonText)', () => {
  test('formatAllowanceRange generates dynamic range without hardcoded numbers', () => {
    // Sliding voice pack
    expect(
      formatAllowanceRange({
        category: 'voice_pack',
        is_sliding: true,
        included_voice_minutes: 30,
        max_voice_minutes: 130,
      })
    ).toBe('30–130 voice minutes');

    // Non-sliding voice pack
    expect(
      formatAllowanceRange({
        category: 'voice_pack',
        is_sliding: false,
        included_voice_minutes: 50,
      })
    ).toBe('50 voice minutes');

    // Sliding SMS pack
    expect(
      formatAllowanceRange({
        category: 'sms_pack',
        is_sliding: true,
        included_sms: 100,
        max_sms: 550,
      })
    ).toBe('100–550 texts');

    // Sliding landline
    expect(
      formatAllowanceRange({
        category: 'landline',
        is_sliding: true,
        included_voice_minutes: 10,
        max_voice_minutes: 30,
      })
    ).toBe('10–30 voice minutes');

    // Sliding mobile
    expect(
      formatAllowanceRange({
        category: 'mobile',
        is_sliding: true,
        included_sms: 50,
        max_sms: 250,
      })
    ).toBe('50–250 texts');

    // Data pack
    expect(
      formatAllowanceRange({
        category: 'data_pack',
        included_data_chunks: 500,
      })
    ).toBe('500 knowledge items');

    // WhatsApp
    expect(
      formatAllowanceRange({
        category: 'whatsapp',
        included_messages: 500,
      })
    ).toBe('500 WhatsApp messages');

    // Calendar
    expect(
      formatAllowanceRange({
        category: 'google_calendar',
      })
    ).toBe('1 calendar integration');
  });

  test('buildCheckoutLineDescription enforces clean wording, zero £, zero VAT, 3-month expiry for packs', () => {
    // Voice pack
    const vpDesc = buildCheckoutLineDescription(
      { category: 'voice_pack', included_voice_minutes: 30 },
      { voiceMinutes: 70 }
    );
    expect(vpDesc).toContain('One-off pack of 70 voice minutes.');
    expect(vpDesc).toContain('Expires 3 months after purchase.');
    expect(vpDesc).not.toContain('£');
    expect(vpDesc.toLowerCase()).not.toContain('vat');
    expect(vpDesc.toLowerCase()).not.toContain('per month');
    expect(vpDesc.toLowerCase()).not.toContain('roll over');
    expect(vpDesc.toLowerCase()).not.toContain('rollover');

    // SMS pack
    const smsDesc = buildCheckoutLineDescription(
      { category: 'sms_pack', included_sms: 100 },
      { sms: 250 }
    );
    expect(smsDesc).toContain('One-off pack of 250 texts.');
    expect(smsDesc).toContain('Expires 3 months after purchase.');
    expect(smsDesc).not.toContain('£');
    expect(smsDesc.toLowerCase()).not.toContain('vat');
    expect(smsDesc.toLowerCase()).not.toContain('per month');
    expect(smsDesc.toLowerCase()).not.toContain('roll over');
    expect(smsDesc.toLowerCase()).not.toContain('rollover');

    // Landline
    const landlineDesc = buildCheckoutLineDescription(
      { category: 'landline', included_voice_minutes: 10 },
      { voiceMinutes: 20 }
    );
    expect(landlineDesc).toContain('Includes dedicated local landline number and 20 shared voice minutes a month.');
    expect(landlineDesc).not.toContain('£');
    expect(landlineDesc.toLowerCase()).not.toContain('vat');

    // Mobile
    const mobileDesc = buildCheckoutLineDescription(
      { category: 'mobile', included_sms: 50 },
      { sms: 150 }
    );
    expect(mobileDesc).toContain('Includes dedicated UK mobile number (07) for WhatsApp and 150 texts.');
    expect(mobileDesc).not.toContain('£');
    expect(mobileDesc.toLowerCase()).not.toContain('vat');
  });

  test('validateAddonText accepts valid names and descriptions', () => {
    const res = validateAddonText({
      name: 'Voice Minutes Pack',
      description: 'A one-off pack of extra shared voice minutes. Minutes expire 3 months after purchase.',
    });
    expect(res.valid).toBe(true);
  });

  test('validateAddonText rejects names < 3 chars or > 60 chars', () => {
    expect(validateAddonText({ name: 'ab' }).valid).toBe(false);
    expect(validateAddonText({ name: 'a'.repeat(61) }).valid).toBe(false);
  });

  test('validateAddonText rejects descriptions > 300 chars', () => {
    expect(validateAddonText({ description: 'd'.repeat(301) }).valid).toBe(false);
  });

  test('validateAddonText rejects HTML tags (< or >)', () => {
    const res1 = validateAddonText({ name: '<b>Voice Pack</b>' });
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('HTML tags are not permitted');

    const res2 = validateAddonText({ description: 'Includes <script>alert(1)</script>' });
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('HTML tags are not permitted');
  });

  test('validateAddonText rejects £ amounts followed by digits', () => {
    const res1 = validateAddonText({ name: 'Voice Pack £12' });
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain("Prices come from the price fields, so please don't type £ amounts");

    const res2 = validateAddonText({ description: 'Only £ 9.99 per month' });
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain("Prices come from the price fields, so please don't type £ amounts");
  });

  test('validateAddonText rejects VAT wording', () => {
    const res1 = validateAddonText({ name: 'Voice Pack with no VAT' });
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('VAT wording is not permitted');

    const res2 = validateAddonText({ description: 'Excludes VAT for UK businesses' });
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('VAT wording is not permitted');
  });
});
