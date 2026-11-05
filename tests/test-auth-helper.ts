import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;

const defaultTestTenantId = '10000000-0000-0000-0000-000000000002';

export interface TestUserSession {
  user: any;
  token: string;
  cleanup: () => Promise<void>;
}

export async function createTestUser(options: {
  tenantId?: string;
  role?: 'owner' | 'admin' | 'member';
  isSuperAdmin?: boolean;
} = {}): Promise<TestUserSession> {
  const tenantId = options.tenantId || defaultTestTenantId;
  const role = options.role || 'owner';
  const isSuperAdmin = options.isSuperAdmin === true;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const anonClient = createClient(supabaseUrl, anonKey);

  const email = `test-${role}-${Date.now()}-${Math.floor(Math.random() * 10000)}@test.styleflo.ai`;
  const password = 'Password123!';

  const { data: userRes, error: userErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !userRes?.user) {
    throw new Error(`Failed to create test user: ${userErr?.message}`);
  }

  const user = userRes.user;
  const { error: profErr } = await adminClient.from('profiles').upsert({
    id: user.id,
    role,
    tenant_id: tenantId,
    is_super_admin: isSuperAdmin,
  });
  if (profErr) {
    await adminClient.auth.admin.deleteUser(user.id);
    throw new Error(`Failed to provision profile: ${profErr.message}`);
  }

  const { data: loginData, error: loginErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginErr || !loginData.session) {
    await adminClient.auth.admin.deleteUser(user.id);
    throw new Error(`Failed to sign in test user: ${loginErr?.message}`);
  }

  return {
    user,
    token: loginData.session.access_token,
    cleanup: async () => {
      try {
        await adminClient.auth.admin.deleteUser(user.id);
      } catch {}
    }
  };
}

export async function createTestSuperadminUser(): Promise<TestUserSession> {
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const anonClient = createClient(supabaseUrl, anonKey);

  const email = `test-superadmin-${Date.now()}-${Math.floor(Math.random() * 10000)}@test.styleflo.ai`;
  const password = 'Password123!';

  const { data: userRes, error: userErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !userRes?.user) {
    throw new Error(`Failed to create test superadmin user: ${userErr?.message}`);
  }

  const user = userRes.user;

  // Authoritatively set is_super_admin = true via service role
  const { error: profErr } = await adminClient.from('profiles').upsert({
    id: user.id,
    role: 'owner',
    tenant_id: defaultTestTenantId,
    is_super_admin: true,
  });
  if (profErr) {
    await adminClient.auth.admin.deleteUser(user.id);
    throw new Error(`Failed to provision superadmin profile: ${profErr.message}`);
  }

  const { data: loginData, error: loginErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginErr || !loginData.session) {
    await adminClient.auth.admin.deleteUser(user.id);
    throw new Error(`Failed to sign in test superadmin: ${loginErr?.message}`);
  }

  const token = loginData.session.access_token;

  return {
    user,
    token,
    cleanup: async () => {
      try {
        await adminClient.auth.admin.deleteUser(user.id);
      } catch {}
    }
  };
}

export async function createTestNormalUser(tenantId: string = defaultTestTenantId): Promise<TestUserSession> {
  return createTestUser({ tenantId, role: 'owner', isSuperAdmin: false });
}
