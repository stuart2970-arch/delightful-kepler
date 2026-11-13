import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PREVIEW_BOOKING_DISABLED_MESSAGE,
  canUseReceptionistPreview,
  previewBlocksBooking,
  previewBlocksCustomerNotifications,
  previewSessionId,
} from '../src/lib/chat-preview';

/**
 * STYL-247: owners can test the receptionist in the dashboard.
 * Preview uses the text chat path, blocks bookings, and does not notify customers.
 */

const root = process.cwd();

test.describe('STYL-247 receptionist preview', () => {
  test('only the salon owner, an admin, or a superadmin can open the preview', () => {
    expect(canUseReceptionistPreview({ tenant_id: 'salon', role: 'owner' }, 'salon')).toBe(true);
    expect(canUseReceptionistPreview({ tenant_id: 'salon', role: 'admin' }, 'salon')).toBe(true);
    expect(canUseReceptionistPreview({ tenant_id: 'salon', role: 'member' }, 'salon')).toBe(false);
    expect(canUseReceptionistPreview({ tenant_id: 'other', role: 'owner' }, 'salon')).toBe(false);
    expect(canUseReceptionistPreview({ tenant_id: 'other', role: 'member', is_super_admin: true }, 'salon')).toBe(true);
    expect(canUseReceptionistPreview(null, 'salon')).toBe(false);
  });

  test('preview blocks bookings and customer notifications', () => {
    expect(previewBlocksBooking(true)).toBe(true);
    expect(previewBlocksCustomerNotifications(true)).toBe(true);
    expect(previewBlocksBooking(false)).toBe(false);
    expect(previewBlocksCustomerNotifications(false)).toBe(false);
    expect(PREVIEW_BOOKING_DISABLED_MESSAGE).toContain('Booking is turned off');
    expect(PREVIEW_BOOKING_DISABLED_MESSAGE.toLowerCase()).toContain('no appointment');
    expect(previewSessionId('user-1', 'abc')).toBe('preview-user-1-abc');
    expect(previewSessionId('user-1', 'preview-user-1-abc')).toBe('preview-user-1-abc');
  });

  test('the dashboard preview is text only and the chat route honours it', () => {
    const preview = readFileSync(join(root, 'src/components/dashboard-views/ReceptionistPreview.tsx'), 'utf8');
    const manager = readFileSync(join(root, 'src/components/dashboard-views/ChatbotManagerView.tsx'), 'utf8');
    const route = readFileSync(join(root, 'src/app/api/chat/stream/route.ts'), 'utf8');

    expect(preview).toContain('Test your receptionist');
    expect(preview).toContain('data-testid="receptionist-preview"');
    expect(preview).toContain('preview: true');
    expect(preview).toContain("'/api/chat/stream'");
    expect(preview.toLowerCase()).not.toContain('vapi');
    expect(preview).not.toContain('Voice Call');
    expect(preview).not.toContain('getUserMedia');
    expect(manager).toContain('<ReceptionistPreview />');

    expect(route).toContain('previewBlocksBooking(isPreview)');
    expect(route).toContain('previewBlocksCustomerNotifications(isPreview)');
    expect(route).toContain('PREVIEW_BOOKING_DISABLED_MESSAGE');
    expect(route).toContain('canUseReceptionistPreview');
    expect(route).toContain('formatOpeningHoursForPrompt');
  });
});
