variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "proj-amplify"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "org_id" {
  description = "GCP organization ID"
  type        = string
  default     = "1077871650233"
}

variable "billing_account" {
  description = "GCP billing account ID"
  type        = string
  default     = "016CB4-D090BE-CFA23C"
}

variable "anthropic_api_key" {
  description = "Anthropic API key for LLM extraction"
  type        = string
  sensitive   = true
}

variable "mailgun_api_key" {
  description = "Mailgun API key for inbound email"
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Primary domain (used for subdomain routing)"
  type        = string
  default     = "amplify.gwanalytics.ai"
}

variable "db_password" {
  description = "Cloud SQL database password (optional — uses random_password if not set)"
  type        = string
  sensitive   = true
  default     = ""
}
