export interface Staff {
  id: string;
  tenant_id?: string;
  chatbot_id?: string;
  name: string;
  role?: string;
  email?: string;
  calendar_provider: 'google' | 'microsoft';
  microsoft_calendar_id?: string | null;
  google_calendar_id?: string | null;
  working_days?: any;
  image_url?: string | null;
  specialist_product?: string | null;
  bio?: string | null;
  created_at?: string;
}

export interface Appointment {
  id: string;
  tenant_id?: string;
  chatbot_id?: string;
  staff_id?: string | null;
  service_id?: string | null;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  start_time: string;
  end_time: string;
  status?: string;
  google_event_id?: string | null;
  microsoft_event_id?: string | null;
  created_at?: string;
}

export interface Tenant {
  id: string;
  name: string;
  microsoft_refresh_token?: string | null;
  created_at?: string;
}
