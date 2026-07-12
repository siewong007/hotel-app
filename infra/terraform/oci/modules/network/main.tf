terraform {
  required_providers {
    oci = {
      source = "oracle/oci"
    }
  }
}

variable "compartment_ocid" {
  description = "OCI compartment OCID for network resources."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used for network resource names."
  type        = string
}

variable "vcn_cidr" {
  description = "IPv4 CIDR for the VCN."
  type        = string
}

variable "subnet_cidr" {
  description = "IPv4 CIDR for the public development subnet."
  type        = string
}

variable "vcn_dns_label" {
  description = "DNS label for the VCN."
  type        = string
  default     = "hoteldev"
}

variable "subnet_dns_label" {
  description = "DNS label for the public subnet."
  type        = string
  default     = "app"
}

variable "ssh_ingress_cidrs" {
  description = "CIDRs permitted to connect to SSH. Keep this restricted."
  type        = set(string)
  default     = []
}

variable "web_ingress_cidrs" {
  description = "CIDRs permitted to reach the development web and API ports."
  type        = set(string)
  default     = ["0.0.0.0/0"]
}

variable "expose_backend_port" {
  description = "Expose backend port 3030 for the current two-origin Compose deployment."
  type        = bool
  default     = true
}

variable "freeform_tags" {
  description = "Free-form tags applied to OCI resources."
  type        = map(string)
  default     = {}
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "${var.name_prefix}-vcn"
  dns_label      = var.vcn_dns_label
  freeform_tags  = var.freeform_tags
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-igw"
  enabled        = true
  freeform_tags  = var.freeform_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-public-routes"
  freeform_tags  = var.freeform_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

resource "oci_core_security_list" "application" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-application"
  freeform_tags  = var.freeform_tags

  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
    stateless        = false
  }

  ingress_security_rules {
    description = "Path MTU discovery"
    protocol    = "1"
    source      = var.vcn_cidr
    source_type = "CIDR_BLOCK"
    stateless   = false

    icmp_options {
      type = 3
      code = 4
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.ssh_ingress_cidrs

    content {
      description = "Restricted SSH"
      protocol    = "6"
      source      = ingress_security_rules.value
      source_type = "CIDR_BLOCK"
      stateless   = false

      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.web_ingress_cidrs

    content {
      description = "Frontend HTTP"
      protocol    = "6"
      source      = ingress_security_rules.value
      source_type = "CIDR_BLOCK"
      stateless   = false

      tcp_options {
        min = 80
        max = 80
      }
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.web_ingress_cidrs

    content {
      description = "HTTPS reserved for a future TLS proxy"
      protocol    = "6"
      source      = ingress_security_rules.value
      source_type = "CIDR_BLOCK"
      stateless   = false

      tcp_options {
        min = 443
        max = 443
      }
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.expose_backend_port ? var.web_ingress_cidrs : toset([])

    content {
      description = "Development backend API"
      protocol    = "6"
      source      = ingress_security_rules.value
      source_type = "CIDR_BLOCK"
      stateless   = false

      tcp_options {
        min = 3030
        max = 3030
      }
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = var.subnet_cidr
  display_name               = "${var.name_prefix}-public"
  dns_label                  = var.subnet_dns_label
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.application.id]
  freeform_tags              = var.freeform_tags
}

output "vcn_id" {
  description = "VCN OCID."
  value       = oci_core_vcn.this.id
}

output "public_subnet_id" {
  description = "Public application subnet OCID."
  value       = oci_core_subnet.public.id
}

output "security_list_id" {
  description = "Application security list OCID."
  value       = oci_core_security_list.application.id
}
