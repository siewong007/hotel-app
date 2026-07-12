locals {
  resolved_frontend_origin = var.frontend_origin != "" ? var.frontend_origin : "http://${module.instance.public_ip}"
  resolved_api_url         = var.api_url != "" ? var.api_url : "${local.resolved_frontend_origin}:3030"
}

output "instance_ocid" {
  description = "Ampere A1 development instance OCID."
  value       = module.instance.instance_id
}

output "public_ip" {
  description = "Reserved or ephemeral public IP."
  value       = module.instance.public_ip
}

output "private_ip" {
  description = "Primary private IP."
  value       = module.instance.private_ip
}

output "frontend_url" {
  description = "Resolved frontend URL."
  value       = local.resolved_frontend_origin
}

output "backend_url" {
  description = "Resolved development API URL."
  value       = local.resolved_api_url
}

output "ssh_command" {
  description = "SSH command for the default Ubuntu image user."
  value       = "ssh ubuntu@${module.instance.public_ip}"
}

output "cloud_init_log_command" {
  description = "Command to inspect cloud-init and hotel bootstrap status."
  value       = "ssh ubuntu@${module.instance.public_ip} 'sudo cloud-init status --wait && sudo journalctl -u hotel-app-compose --no-pager'"
}

output "data_volume_ocid" {
  description = "Optional data block volume OCID."
  value       = module.instance.data_volume_id
}

output "vault_policy_ocid" {
  description = "Policy OCID granting the instance narrowly scoped secret-bundle reads."
  value       = oci_identity_policy.vault_read.id
}

