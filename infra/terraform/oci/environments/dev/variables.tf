variable "tenancy_ocid" {
  description = "OCI tenancy OCID."
  type        = string
}

variable "compartment_ocid" {
  description = "OCI compartment OCID for the development environment."
  type        = string
}

variable "user_ocid" {
  description = "Optional OCI user OCID for API-key authentication. May be supplied through OCI environment configuration."
  type        = string
  default     = null
  nullable    = true
}

variable "fingerprint" {
  description = "Optional API signing-key fingerprint."
  type        = string
  default     = null
  nullable    = true
}

variable "private_key_path" {
  description = "Optional local path to the API signing private key. Never place the private key value in Terraform variables."
  type        = string
  default     = null
  nullable    = true
}

variable "region" {
  description = "OCI region for development resources."
  type        = string
  default     = "ap-singapore-1"
}

variable "project_name" {
  description = "Project name used in OCI display names."
  type        = string
  default     = "hotel-app"
}

variable "environment" {
  description = "Environment name used in OCI display names."
  type        = string
  default     = "dev"
}

variable "availability_domain" {
  description = "Optional explicit availability-domain name. The first domain is used when null."
  type        = string
  default     = null
  nullable    = true
}

variable "availability_domain_index" {
  description = "Availability-domain index used when availability_domain is null."
  type        = number
  default     = 0
}

variable "image_ocid" {
  description = "Optional ARM64 Ubuntu image OCID. The newest matching Ubuntu 24.04 image is selected when null."
  type        = string
  default     = null
  nullable    = true
}

variable "vcn_cidr" {
  description = "Development VCN CIDR."
  type        = string
  default     = "10.40.0.0/16"
}

variable "subnet_cidr" {
  description = "Public application subnet CIDR."
  type        = string
  default     = "10.40.10.0/24"
}

variable "ssh_ingress_cidrs" {
  description = "CIDRs permitted to reach SSH."
  type        = set(string)
  default     = []
}

variable "web_ingress_cidrs" {
  description = "CIDRs permitted to reach ports 80, 443, and the optional development API port."
  type        = set(string)
  default     = ["0.0.0.0/0"]
}

variable "expose_backend_port" {
  description = "Expose port 3030 for the current frontend build-time API origin."
  type        = bool
  default     = true
}

variable "shape" {
  description = "OCI compute shape. This slice supports only Ampere A1 Flex."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "A1 Flex OCPUs."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "A1 Flex memory in GB."
  type        = number
  default     = 12
}

variable "boot_volume_size_in_gbs" {
  description = "Boot volume size in GB."
  type        = number
  default     = 50
}

variable "boot_volume_vpus_per_gb" {
  description = "Boot volume performance units per GB."
  type        = number
  default     = 10
}

variable "create_data_volume" {
  description = "Create an optional block volume for Docker data."
  type        = bool
  default     = false
}

variable "data_volume_size_in_gbs" {
  description = "Optional data block volume size in GB."
  type        = number
  default     = 100
}

variable "data_volume_vpus_per_gb" {
  description = "Optional data block volume performance units per GB."
  type        = number
  default     = 10
}

variable "data_volume_device" {
  description = "Requested Linux device path for the optional block volume."
  type        = string
  default     = "/dev/oracleoci/oraclevdb"
}

variable "data_volume_mount_path" {
  description = "Mount point used as Docker's data root when a data volume is enabled."
  type        = string
  default     = "/mnt/hotel-data"
}

variable "use_reserved_public_ip" {
  description = "Use a reserved regional public IP instead of an ephemeral address."
  type        = bool
  default     = false
}

variable "ssh_public_keys" {
  description = "SSH public keys installed on the VM."
  type        = list(string)
}

variable "repository_url" {
  description = "Git repository cloned by cloud-init."
  type        = string
  default     = "https://github.com/siewong007/hotel-app.git"
}

variable "repository_ref" {
  description = "Git branch, tag, or commit checked out by cloud-init."
  type        = string
  default     = "master"
}

variable "postgres_password_secret_ocid" {
  description = "OCI Vault secret OCID containing only the PostgreSQL password. The secret value never enters Terraform."
  type        = string
}

variable "jwt_secret_ocid" {
  description = "OCI Vault secret OCID containing only the JWT signing secret. The secret value never enters Terraform."
  type        = string
}

variable "frontend_origin" {
  description = "Optional public frontend origin. Cloud-init derives an HTTP origin from the public IP when empty."
  type        = string
  default     = ""
}

variable "api_url" {
  description = "Optional frontend build-time API URL. Cloud-init appends port 3030 to the frontend origin when empty."
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Optional comma-separated CORS origins. Defaults to the resolved frontend origin."
  type        = string
  default     = ""
}

variable "passkey_rp_id" {
  description = "Optional passkey relying-party ID. Defaults to the resolved frontend hostname."
  type        = string
  default     = ""
}

variable "trust_proxy_headers" {
  description = "Trust proxy headers only when a pre-compose hook installs a trusted reverse proxy."
  type        = bool
  default     = false
}

variable "enable_pg19_beta_tuning" {
  description = "Enable the development-only PostgreSQL 19 Beta Compose tuning override."
  type        = bool
  default     = false
}

variable "pre_compose_script" {
  description = "Non-secret root script run immediately before Docker Compose starts."
  type        = string
  default     = "#!/usr/bin/env bash\nset -euo pipefail\n"
}

variable "post_compose_script" {
  description = "Non-secret root script run immediately after Docker Compose starts."
  type        = string
  default     = "#!/usr/bin/env bash\nset -euo pipefail\n"
}

variable "freeform_tags" {
  description = "Additional OCI free-form tags."
  type        = map(string)
  default     = {}
}

