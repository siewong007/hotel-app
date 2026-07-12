locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = merge(var.freeform_tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  })
}

data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}

locals {
  selected_availability_domain = var.availability_domain != null ? var.availability_domain : data.oci_identity_availability_domains.available.availability_domains[var.availability_domain_index].name
}

data "oci_core_images" "ubuntu_arm64" {
  count = var.image_ocid == null ? 1 : 0

  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  state                    = "AVAILABLE"
}

locals {
  selected_image_ocid = var.image_ocid != null ? var.image_ocid : data.oci_core_images.ubuntu_arm64[0].images[0].id

  cloud_init = templatefile("${path.module}/../../templates/bootstrap.sh.tftpl", {
    repository_url_b64                = base64encode(var.repository_url)
    repository_ref_b64                = base64encode(var.repository_ref)
    postgres_password_secret_ocid_b64 = base64encode(var.postgres_password_secret_ocid)
    jwt_secret_ocid_b64               = base64encode(var.jwt_secret_ocid)
    frontend_origin_b64               = base64encode(var.frontend_origin)
    api_url_b64                       = base64encode(var.api_url)
    allowed_origins_b64               = base64encode(var.allowed_origins)
    passkey_rp_id_b64                 = base64encode(var.passkey_rp_id)
    trust_proxy_headers               = tostring(var.trust_proxy_headers)
    enable_pg19_beta_tuning           = tostring(var.enable_pg19_beta_tuning)
    create_data_volume                = tostring(var.create_data_volume)
    data_volume_device_b64            = base64encode(var.data_volume_device)
    data_volume_mount_path_b64        = base64encode(var.data_volume_mount_path)
    infrastructure_override_b64       = base64encode(file("${path.module}/../../templates/docker-compose.infrastructure.yml"))
    pg19_tuning_override_b64          = base64encode(file("${path.module}/../../templates/docker-compose.pg19-tuning.yml"))
    pre_compose_script_b64            = base64encode(var.pre_compose_script)
    post_compose_script_b64           = base64encode(var.post_compose_script)
  })
}

module "network" {
  source = "../../modules/network"

  compartment_ocid    = var.compartment_ocid
  name_prefix         = local.name_prefix
  vcn_cidr            = var.vcn_cidr
  subnet_cidr         = var.subnet_cidr
  ssh_ingress_cidrs   = var.ssh_ingress_cidrs
  web_ingress_cidrs   = var.web_ingress_cidrs
  expose_backend_port = var.expose_backend_port
  freeform_tags       = local.common_tags
}

module "instance" {
  source = "../../modules/instance"

  compartment_ocid        = var.compartment_ocid
  name_prefix             = local.name_prefix
  availability_domain     = local.selected_availability_domain
  subnet_ocid             = module.network.public_subnet_id
  image_ocid              = local.selected_image_ocid
  shape                   = var.shape
  ocpus                   = var.ocpus
  memory_in_gbs           = var.memory_in_gbs
  boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  boot_volume_vpus_per_gb = var.boot_volume_vpus_per_gb
  create_data_volume      = var.create_data_volume
  data_volume_size_in_gbs = var.data_volume_size_in_gbs
  data_volume_vpus_per_gb = var.data_volume_vpus_per_gb
  data_volume_device      = var.data_volume_device
  use_reserved_public_ip  = var.use_reserved_public_ip
  ssh_public_keys         = var.ssh_public_keys
  cloud_init              = local.cloud_init
  freeform_tags           = local.common_tags
}

resource "oci_identity_dynamic_group" "application" {
  compartment_id = var.tenancy_ocid
  name           = replace("${local.name_prefix}-instance", "-", "_")
  description    = "Hotel app development instance principal"
  matching_rule  = "ALL {instance.id = '${module.instance.instance_id}'}"
  freeform_tags  = local.common_tags
}

resource "oci_identity_policy" "vault_read" {
  compartment_id = var.compartment_ocid
  name           = replace("${local.name_prefix}-vault-read", "-", "_")
  description    = "Allow the development instance to read only its two runtime secret bundles"
  freeform_tags  = local.common_tags
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.application.name} to read secret-bundles in compartment id ${var.compartment_ocid} where any {target.secret.id = '${var.postgres_password_secret_ocid}', target.secret.id = '${var.jwt_secret_ocid}'}"
  ]
}
