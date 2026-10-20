export const superadminRoutes = [
  {
    path: '/api/superadmin/addon-catalog',
    methods: ['GET', 'PATCH'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/tiers',
    methods: ['GET', 'PATCH'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/entitlements',
    methods: ['GET', 'PATCH'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/features',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/features/reorder',
    methods: ['PATCH'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/pricing-matrix',
    methods: ['GET', 'POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/gemini-models',
    methods: ['GET'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/gdpr',
    methods: ['POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/connected-accounts',
    methods: ['GET', 'POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/global-settings',
    methods: ['POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/impersonate/search',
    methods: ['GET'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/tenants/00000000-0000-0000-0000-000000000000',
    methods: ['DELETE'],
    auth: 'superadmin'
  },
  {
    path: '/api/superadmin/whatsapp-usage',
    methods: ['GET'],
    auth: 'superadmin'
  },
  {
    path: '/api/global-holidays',
    methods: ['GET', 'POST', 'DELETE'],
    auth: 'mixed',
    methodAuth: {
      GET: 'user',
      POST: 'superadmin',
      DELETE: 'superadmin'
    }
  },
  {
    path: '/api/voice-personas',
    methods: ['GET', 'POST'],
    auth: 'mixed',
    methodAuth: {
      GET: 'user',
      POST: 'superadmin'
    }
  },
  {
    path: '/api/voice-personas/00000000-0000-0000-0000-000000000000',
    methods: ['PATCH', 'DELETE'],
    auth: 'superadmin'
  },
  {
    path: '/api/billing/override',
    methods: ['POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/tenants/settings/sync-cache',
    methods: ['POST'],
    auth: 'superadmin'
  },
  {
    path: '/api/rwg/feeds/cron',
    methods: ['GET'],
    auth: 'cron'
  }
];

export default superadminRoutes;
