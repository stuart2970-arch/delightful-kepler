import { create } from 'zustand';

export interface Chatbot {
  id: string;
  name: string;
  primary_color: string;
  voice_enabled?: boolean;
  vapi_public_key?: string;
  vapi_assistant_id?: string;
  configuration_json: {
    welcome_message?: string;
    suggested_prompts?: string[];
    agent_name?: string;
    agent_role?: string;
    agent_avatar_url?: string;
    branding_html?: string;
    branding_url?: string;
    ordered_service_ids?: string[];
    admin_email?: string;
  };
  created_at: string;
}

export interface Conversation {
  id: string;
  chatbot_id: string;
  user_session_id: string;
  created_at: string;
  is_voice_call?: boolean;
  is_phone_call?: boolean;
  caller_phone_number?: string;
  resulted_in_booking?: boolean;
  recording_url?: string;
  transcript?: string;
}

export interface Message {
  id: string;
  sender_type: 'user' | 'bot';
  text_content: string;
  created_at: string;
}

export interface Metrics {
  chatbotsCount: number;
  chunksCount: number;
  sessionsCount: number;
  messagesCount: number;
}

export interface DailySchedule {
  unavailable: boolean;
  am: { start: string, end: string } | null;
  pm: { start: string, end: string } | null;
}

export type WeeklySchedule = {
  weekCommencingDate: string; // YYYY-MM-DD format (Monday's date)
  monday: DailySchedule;
  tuesday: DailySchedule;
  wednesday: DailySchedule;
  thursday: DailySchedule;
  friday: DailySchedule;
  saturday: DailySchedule;
  sunday: DailySchedule;
};

export interface BusinessDailySchedule {
  unavailable: boolean;
  hours: { start: string, end: string } | null;
}

export type BusinessWeeklySchedule = {
  weekCommencingDate: string; // YYYY-MM-DD format (Monday's date)
  monday: BusinessDailySchedule;
  tuesday: BusinessDailySchedule;
  wednesday: BusinessDailySchedule;
  thursday: BusinessDailySchedule;
  friday: BusinessDailySchedule;
  saturday: BusinessDailySchedule;
  sunday: BusinessDailySchedule;
};

export type ActiveTab = 'chatbots' | 'crawler' | 'conversations' | 'scheduling' | 'integrations' | 'telephony' | 'settings' | 'billing' | 'account' | 'superadmin_voices' | 'my-profile' | 'analytics' | 'openclaw-monitor';

export interface DashboardState {
  // User/Tenant Data
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userName: string;
  isSuperAdmin: boolean;
  role: 'owner' | 'admin' | 'member';
  setRole: (role: 'owner' | 'admin' | 'member') => void;
  myStaffRecord: any;
  setMyStaffRecord: (staff: any) => void;
  
  // Navigation
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (isOpen: boolean) => void;

  // Entities
  chatbots: Chatbot[];
  setChatbots: (chatbots: Chatbot[]) => void;
  conversations: Conversation[];
  setConversations: (convos: Conversation[]) => void;
  metrics: Metrics;
  setMetrics: (metrics: Metrics) => void;
  services: any[];
  setServices: (services: any[]) => void;
  staff: any[];
  setStaff: (staff: any[]) => void;
  appointments: any[];
  setAppointments: (appointments: any[]) => void;
  isGoogleConnected: boolean;
  setIsGoogleConnected: (connected: boolean) => void;
  googleConnectedEmail: string | null;
  setGoogleConnectedEmail: (email: string | null) => void;

  // Billing & Superadmin
  billingData: any;
  superadminData: any;

  // Account Settings Context
  domain: string;
  setDomain: (domain: string) => void;
  businessAddress: string;
  setBusinessAddress: (address: string) => void;
  postcode: string;
  setPostcode: (postcode: string) => void;
  twilioShadowNumber: string | null;
  setTwilioShadowNumber: (number: string | null) => void;

  // New Address Profile Fields
  tradingAddressStreet: string;
  setTradingAddressStreet: (street: string) => void;
  tradingAddressCity: string;
  setTradingAddressCity: (city: string) => void;
  tradingAddressPostcode: string;
  setTradingAddressPostcode: (postcode: string) => void;
  tradingAddressPhone: string;
  setTradingAddressPhone: (phone: string) => void;

  companyRegistrationNumber: string;
  setCompanyRegistrationNumber: (number: string) => void;
  registeredAddressStreet: string;
  setRegisteredAddressStreet: (street: string) => void;
  registeredAddressCity: string;
  setRegisteredAddressCity: (city: string) => void;
  registeredAddressPostcode: string;
  setRegisteredAddressPostcode: (postcode: string) => void;

  isRegisteredCompany: boolean;
  setIsRegisteredCompany: (isRegistered: boolean) => void;
  registeredAddressSameAsTrading: boolean;
  setRegisteredAddressSameAsTrading: (same: boolean) => void;
  rwgAddressSameAsTrading: boolean;
  setRwgAddressSameAsTrading: (same: boolean) => void;

  // RWG & Scheduling Context
  rwgConfig: any;
  setRwgConfig: (config: any) => void;
  bookingMode: string;
  setBookingMode: (mode: string) => void;
  bookingUrl: string;
  setBookingUrl: (url: string) => void;
  generalOperatingHours: any;
  setGeneralOperatingHours: (hours: any) => void;
  operatingHoursOverrides: any[];
  setOperatingHoursOverrides: (overrides: any[]) => void;
  holidaySettings: any;
  setHolidaySettings: (settings: any) => void;

  // Initialization
  initialize: (data: Partial<DashboardState>) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  tenantId: '',
  tenantName: '',
  userEmail: '',
  userName: '',
  isSuperAdmin: false,
  role: 'owner',
  setRole: (role) => set({ role }),
  myStaffRecord: null,
  setMyStaffRecord: (myStaffRecord) => set({ myStaffRecord }),
  
  businessAddress: '',
  setBusinessAddress: (addr) => set({ businessAddress: addr }),
  postcode: '',
  setPostcode: (postcode) => set({ postcode }),
  
  tradingAddressStreet: '',
  setTradingAddressStreet: (tradingAddressStreet) => set({ tradingAddressStreet }),
  tradingAddressCity: '',
  setTradingAddressCity: (tradingAddressCity) => set({ tradingAddressCity }),
  tradingAddressPostcode: '',
  setTradingAddressPostcode: (tradingAddressPostcode) => set({ tradingAddressPostcode }),
  tradingAddressPhone: '',
  setTradingAddressPhone: (tradingAddressPhone) => set({ tradingAddressPhone }),

  companyRegistrationNumber: '',
  setCompanyRegistrationNumber: (companyRegistrationNumber) => set({ companyRegistrationNumber }),
  registeredAddressStreet: '',
  setRegisteredAddressStreet: (registeredAddressStreet) => set({ registeredAddressStreet }),
  registeredAddressCity: '',
  setRegisteredAddressCity: (registeredAddressCity) => set({ registeredAddressCity }),
  registeredAddressPostcode: '',
  setRegisteredAddressPostcode: (registeredAddressPostcode) => set({ registeredAddressPostcode }),

  isRegisteredCompany: false,
  setIsRegisteredCompany: (isRegisteredCompany) => set({ isRegisteredCompany }),
  registeredAddressSameAsTrading: true,
  setRegisteredAddressSameAsTrading: (registeredAddressSameAsTrading) => set({ registeredAddressSameAsTrading }),
  rwgAddressSameAsTrading: true,
  setRwgAddressSameAsTrading: (rwgAddressSameAsTrading) => set({ rwgAddressSameAsTrading }),

  activeTab: 'chatbots',
  setActiveTab: (tab) => set({ activeTab: tab }),
  isMobileMenuOpen: false,
  setIsMobileMenuOpen: (isOpen) => set({ isMobileMenuOpen: isOpen }),

  chatbots: [],
  setChatbots: (chatbots) => set({ chatbots }),
  conversations: [],
  setConversations: (conversations) => set({ conversations }),
  metrics: { chatbotsCount: 0, chunksCount: 0, sessionsCount: 0, messagesCount: 0 },
  setMetrics: (metrics) => set({ metrics }),
  services: [],
  setServices: (services) => set({ services }),
  staff: [],
  setStaff: (staff) => set({ staff }),
  appointments: [],
  setAppointments: (appointments) => set({ appointments }),
  isGoogleConnected: false,
  setIsGoogleConnected: (isGoogleConnected) => set({ isGoogleConnected }),
  googleConnectedEmail: null,
  setGoogleConnectedEmail: (googleConnectedEmail) => set({ googleConnectedEmail }),

  billingData: null,
  superadminData: null,

  domain: '',
  setDomain: (domain) => set({ domain }),
  twilioShadowNumber: null,
  setTwilioShadowNumber: (number) => set({ twilioShadowNumber: number }),
  rwgConfig: {},
  setRwgConfig: (rwgConfig) => set({ rwgConfig }),
  bookingMode: 'single_calendar',
  setBookingMode: (mode) => set({ bookingMode: mode }),
  bookingUrl: '',
  setBookingUrl: (url) => set({ bookingUrl: url }),
  generalOperatingHours: {},
  setGeneralOperatingHours: (hours) => set({ generalOperatingHours: hours }),
  operatingHoursOverrides: [],
  setOperatingHoursOverrides: (overrides) => set({ operatingHoursOverrides: overrides }),
  holidaySettings: {},
  setHolidaySettings: (settings) => set({ holidaySettings: settings }),

  initialize: (data) => set((state) => ({ ...state, ...data })),
}));

export const useStore = useDashboardStore;
