# =========================================================================
# PROVIDERS & REQURED SERVICES
# =========================================================================
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Enable GCP API Services (GDPR audit trail requirement)
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "cloudtasks.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com"
  ])
  service            = each.key
  disable_on_destroy = false
}

# =========================================================================
# Artifact Registry (Container Storage)
# =========================================================================
resource "google_artifact_registry_repository" "registry" {
  depends_on    = [google_project_service.services]
  location      = var.region
  repository_id = "${var.app_name}-repo"
  description   = "Docker Artifact Registry for StyleFlo Next.js App"
  format        = "DOCKER"
  
  cleanup_policies {
    id     = "keep-last-3"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
}

# =========================================================================
# Cloud Storage Bucket (File/Document Store)
# =========================================================================
resource "google_storage_bucket" "store" {
  depends_on                  = [google_project_service.services]
  name                        = "${var.app_name}-store-${var.project_id}"
  location                    = var.region
  storage_class               = "REGIONAL"
  force_destroy               = false
  uniform_bucket_level_access = true

  # GDPR Compliance: Prevent leakage and support backups/restores
  versioning {
    enabled = true
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 90 # Auto-expire scratch temp assets after 90 days
    }
  }
}

# =========================================================================
# Cloud Tasks Queue (Ingestion Queues)
# =========================================================================
resource "google_cloud_tasks_queue" "tasks" {
  depends_on = [google_project_service.services]
  name       = "${var.app_name}-tasks-queue"
  location   = var.region

  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5
  }

  retry_config {
    max_attempts       = 3
    max_backoff        = "3600s"
    min_backoff        = "5s"
    max_doublings      = 4
  }
}

# =========================================================================
# Cloud SQL PostgreSQL (Database with pgvector support)
# =========================================================================
resource "google_sql_database_instance" "db_instance" {
  depends_on       = [google_project_service.services]
  name             = "${var.app_name}-db-instance"
  database_version = "POSTGRES_15" # Postgres 15+ has native pgvector support on Cloud SQL
  region           = var.region
  
  settings {
    tier = "db-f1-micro" # Lightweight tier, scale up in variables if needed
    
    ip_configuration {
      ipv4_enabled = true # Supports connecting securely via Cloud Run Auth Proxy
      ssl_mode     = "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    }

    # GDPR requirement: Enable automated daily backups with point-in-time recovery
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
    }
  }
  
  deletion_protection = false # Set to true in prod to prevent accidental deletion
}

resource "google_sql_database" "db" {
  name     = "${var.app_name}_db"
  instance = google_sql_database_instance.db_instance.name
}

resource "google_sql_user" "db_user" {
  name     = "styleflo_admin"
  instance = google_sql_database_instance.db_instance.name
  password = var.db_password
}

# =========================================================================
# Secret Manager (Secure Credentials Store)
# =========================================================================
resource "google_secret_manager_secret" "gemini_key" {
  depends_on = [google_project_service.services]
  secret_id  = "gemini-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "gemini_key_version" {
  secret      = google_secret_manager_secret.gemini_key.id
  secret_data = var.gemini_api_key
}

resource "google_secret_manager_secret" "supabase_service_key" {
  depends_on = [google_project_service.services]
  secret_id  = "supabase-service-role-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "supabase_service_key_version" {
  secret      = google_secret_manager_secret.supabase_service_key.id
  secret_data = var.supabase_service_role_key
}

resource "google_secret_manager_secret" "db_url" {
  depends_on = [google_project_service.services]
  secret_id  = "database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_url_version" {
  secret      = google_secret_manager_secret.db_url.id
  # Formats the internal PostgreSQL connection URL through the unix socket Cloud Run utilizes
  secret_data = "postgresql://styleflo_admin:${var.db_password}@localhost/${google_sql_database.db.name}?host=/cloudsql/${google_sql_database_instance.db_instance.connection_name}"
}

# =========================================================================
# Service Account & IAM Settings
# =========================================================================
resource "google_service_account" "cloud_run_sa" {
  depends_on   = [google_project_service.services]
  account_id   = "${var.app_name}-run-sa"
  display_name = "Cloud Run Execution Service Account for ${var.app_name}"
}

# 1. Grant Service Account Access to read our secrets
resource "google_secret_manager_secret_iam_member" "access_gemini_key" {
  secret_id = google_secret_manager_secret.gemini_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "access_supabase_key" {
  secret_id = google_secret_manager_secret.supabase_service_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "access_db_url" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# 2. Grant Service Account Cloud SQL Client privileges
resource "google_project_iam_member" "db_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# 3. Grant Service Account GCS bucket read/write permissions
resource "google_storage_bucket_iam_member" "storage_admin" {
  bucket = google_storage_bucket.store.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# =========================================================================
# Cloud Run Service (Production Serverless App)
# =========================================================================
resource "google_cloud_run_v2_service" "app" {
  depends_on = [
    google_project_service.services,
    google_sql_database_instance.db_instance
  ]
  name     = "${var.app_name}-app"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email
    timeout         = "300s"

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.registry.repository_id}/styleflo-app:latest"
      
      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      # Standard Public Variables
      env {
        name  = "NEXT_PUBLIC_SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        value = var.supabase_anon_key
      }

      # Secure Secrets reference from Secrets Manager
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SUPABASE_SERVICE_ROLE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.supabase_service_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }

      # Mount Unix socket for Cloud SQL connection
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db_instance.connection_name]
      }
    }

    scaling {
      max_instance_count = 5
      min_instance_count = 0
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Enable public unauthenticated access (allUsers) to our Cloud Run service
resource "google_cloud_run_v2_service_iam_member" "public" {
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.viewer"
  member   = "allUsers"
}

# =========================================================================
# OUTPUTS
# =========================================================================
output "artifact_registry_uri" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.registry.repository_id}/styleflo-app"
  description = "Target Docker image repository path"
}

output "cloud_run_uri" {
  value       = google_cloud_run_v2_service.app.uri
  description = "Public URL of the deployed Cloud Run application"
}

output "db_connection_name" {
  value       = google_sql_database_instance.db_instance.connection_name
  description = "GCP Cloud SQL connection socket address string"
}
