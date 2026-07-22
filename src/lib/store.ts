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
  };
  created_at: string;
}

export interface Conversation {
  id: string;
  chatbot_id: string;
  user_session_id: string;
  created_at: string;
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

export type ActiveTab = 'chatbots' | 'crawler' | 'conversations' | 'scheduling' | 'integrations' | 'settings' | 'billing';

export interface DashboardState {
  // User/Tenant Data
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userName: string;
  isSuperAdmin: boolean;
  
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
  isGoogleConnected: boolean;
  setIsGoogleConnected: (connected: boolean) => void;

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
  
  businessAddress: '',
  setBusinessAddress: (addr) => set({ businessAddress: addr }),
  postcode: '',
  setPostcode: (postcode) => set({ postcode }),
  
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
  isGoogleConnected: false,
  setIsGoogleConnected: (isGoogleConnected) => set({ isGoogleConnected }),

  billingData: null,
  superadminData: null,

  domain: '',
  setDomain: (domain) => set({ domain }),
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
