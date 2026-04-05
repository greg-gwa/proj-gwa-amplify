# ------------------------------------------------------------------
# Org Policy Override — allow allUsers for Cloud Run webhooks
# ------------------------------------------------------------------
resource "google_project_organization_policy" "allow_all_members" {
  project    = google_project.amplify.project_id
  constraint = "iam.allowedPolicyMemberDomains"

  list_policy {
    allow {
      all = true
    }
  }
}
