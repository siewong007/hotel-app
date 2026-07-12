terraform {
  required_providers {
    oci = {
      source = "oracle/oci"
    }
  }
}

variable "compartment_ocid" {
  description = "OCI compartment OCID for compute and storage resources."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used for compute and storage resource names."
  type        = string
}

variable "availability_domain" {
  description = "Availability domain selected for the instance and optional block volume."
  type        = string
}

variable "subnet_ocid" {
  description = "Public subnet OCID for the primary VNIC."
  type        = string
}

variable "image_ocid" {
  description = "ARM64-compatible platform image OCID."
  type        = string
}

variable "shape" {
  description = "Compute shape. The development stack targets the Always Free Ampere A1 Flex shape."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "Ampere A1 OCPUs allocated to the VM."
  type        = number
  default     = 2

  validation {
    condition     = var.ocpus >= 1 && var.ocpus <= 4
    error_message = "Always Free-shaped A1 development instances must use between 1 and 4 OCPUs."
  }
}

variable "memory_in_gbs" {
  description = "Memory allocated to the Ampere A1 VM."
  type        = number
  default     = 12

  validation {
    condition     = var.memory_in_gbs >= 6 && var.memory_in_gbs <= 24
    error_message = "Always Free-shaped A1 development instances must use between 6 and 24 GB of memory."
  }
}

variable "boot_volume_size_in_gbs" {
  description = "Boot volume size. OCI Always Free storage limits apply across boot and block volumes."
  type        = number
  default     = 50

  validation {
    condition     = var.boot_volume_size_in_gbs >= 50 && var.boot_volume_size_in_gbs <= 200
    error_message = "boot_volume_size_in_gbs must be between 50 and 200."
  }
}

variable "boot_volume_vpus_per_gb" {
  description = "Boot volume performance units per GB."
  type        = number
  default     = 10
}

variable "create_data_volume" {
  description = "Create and attach an optional block volume for Docker data."
  type        = bool
  default     = false
}

variable "data_volume_size_in_gbs" {
  description = "Optional data volume size. Total boot and block allocation must remain within tenancy limits."
  type        = number
  default     = 100

  validation {
    condition     = var.data_volume_size_in_gbs >= 50 && var.data_volume_size_in_gbs <= 200
    error_message = "data_volume_size_in_gbs must be between 50 and 200."
  }
}

variable "data_volume_vpus_per_gb" {
  description = "Optional data volume performance units per GB."
  type        = number
  default     = 10
}

variable "data_volume_device" {
  description = "Requested device path for the optional paravirtualized data volume."
  type        = string
  default     = "/dev/oracleoci/oraclevdb"
}

variable "use_reserved_public_ip" {
  description = "Attach a regional reserved public IP instead of an ephemeral public IP."
  type        = bool
  default     = false
}

variable "ssh_public_keys" {
  description = "SSH public keys installed for the image's default user."
  type        = list(string)

  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "At least one SSH public key is required."
  }
}

variable "cloud_init" {
  description = "Cloud-init user data used to bootstrap Docker Compose."
  type        = string
}

variable "freeform_tags" {
  description = "Free-form tags applied to OCI resources."
  type        = map(string)
  default     = {}
}

resource "oci_core_instance" "this" {
  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "${var.name_prefix}-app"
  shape               = var.shape
  freeform_tags       = var.freeform_tags

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  create_vnic_details {
    assign_public_ip       = !var.use_reserved_public_ip
    display_name           = "${var.name_prefix}-primary"
    hostname_label         = "hotelapp"
    skip_source_dest_check = false
    subnet_id              = var.subnet_ocid
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_ocid
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
    boot_volume_vpus_per_gb = var.boot_volume_vpus_per_gb
  }

  metadata = {
    ssh_authorized_keys = join("\n", var.ssh_public_keys)
    user_data           = base64encode(var.cloud_init)
  }

  preserve_boot_volume = false

  lifecycle {
    precondition {
      condition     = var.shape == "VM.Standard.A1.Flex"
      error_message = "This Always Free development module supports only VM.Standard.A1.Flex."
    }

    precondition {
      condition     = var.memory_in_gbs <= var.ocpus * 6
      error_message = "Keep the Always Free allocation at no more than 6 GB of memory per A1 OCPU."
    }

    precondition {
      condition     = var.boot_volume_size_in_gbs + (var.create_data_volume ? var.data_volume_size_in_gbs : 0) <= 200
      error_message = "The requested boot and data volumes exceed the common 200 GB Always Free block-storage allocation."
    }
  }
}

data "oci_core_vnic_attachments" "this" {
  compartment_id = var.compartment_ocid
  instance_id    = oci_core_instance.this.id
}

data "oci_core_vnic" "primary" {
  vnic_id = data.oci_core_vnic_attachments.this.vnic_attachments[0].vnic_id
}

data "oci_core_private_ips" "primary" {
  vnic_id = data.oci_core_vnic.primary.id
}

resource "oci_core_public_ip" "reserved" {
  count = var.use_reserved_public_ip ? 1 : 0

  compartment_id = var.compartment_ocid
  display_name   = "${var.name_prefix}-public-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.primary.private_ips[0].id
  freeform_tags  = var.freeform_tags
}

resource "oci_core_volume" "data" {
  count = var.create_data_volume ? 1 : 0

  availability_domain = var.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "${var.name_prefix}-data"
  size_in_gbs         = var.data_volume_size_in_gbs
  vpus_per_gb         = var.data_volume_vpus_per_gb
  freeform_tags       = var.freeform_tags
}

resource "oci_core_volume_attachment" "data" {
  count = var.create_data_volume ? 1 : 0

  attachment_type = "paravirtualized"
  device          = var.data_volume_device
  display_name    = "${var.name_prefix}-data"
  instance_id     = oci_core_instance.this.id
  volume_id       = oci_core_volume.data[0].id
  is_read_only    = false
  is_shareable    = false
}

output "instance_id" {
  description = "Compute instance OCID."
  value       = oci_core_instance.this.id
}

output "private_ip" {
  description = "Primary private IP address."
  value       = data.oci_core_vnic.primary.private_ip_address
}

output "public_ip" {
  description = "Reserved or ephemeral public IP address."
  value       = var.use_reserved_public_ip ? oci_core_public_ip.reserved[0].ip_address : data.oci_core_vnic.primary.public_ip_address
}

output "data_volume_id" {
  description = "Optional data block volume OCID."
  value       = try(oci_core_volume.data[0].id, null)
}
