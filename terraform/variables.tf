variable "project_id" {
  description = "The Google Cloud Platform (GCP) Project ID to deploy resources into."
  type        = string
}

variable "region" {
  description = "The target GCP region for provisioning serverless and database resources (UK GDPR Compliance: europe-west2)."
  type        = string
  default     = "europe-west2"
}

variable "app_name" {
  description = "Application prefix name used for identifying resource namespaces."
  type        = string
  default     = "styleflo"
}

variable "environment" {
  description = "Deployment target environment stage."
  type        = string
  default     = "production"
}

variable "db_password" {
  description = "The administrator master password for the Cloud SQL PostgreSQL instance."
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "The API key for Google Gemini used to compute embedding vectors and stream chat completions."
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "The Supabase service role API key to bypass RLS in the RAG route."
  type        = string
  sensitive   = true
}

variable "supabase_url" {
  description = "The Supabase endpoint URL for client initialization."
  type        = string
}

variable "supabase_anon_key" {
  description = "The Supabase anonymous client API key."
  type        = string
  sensitive   = true
}
