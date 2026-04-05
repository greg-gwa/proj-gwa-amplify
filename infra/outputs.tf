output "project_id" {
  value = google_project.amplify.project_id
}

output "ingest_url" {
  value = google_cloud_run_v2_service.ingest.uri
}

output "deploy_sa_email" {
  value = google_service_account.deploy.email
}

output "ingest_sa_email" {
  value = google_service_account.ingest_runtime.email
}

output "raw_emails_bucket" {
  value = google_storage_bucket.raw_emails.name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.amplify.connection_name
}

output "ops_console_url" {
  value = google_cloud_run_v2_service.ops_console.uri
}
