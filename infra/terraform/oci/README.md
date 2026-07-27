# Hotel App on OCI Always Free

This Terraform slice creates a development deployment on one Oracle Cloud Infrastructure Ampere A1 Flex VM. Cloud-init installs Docker, checks out this repository, reads runtime secrets through an instance principal, and starts the existing root `docker-compose.yml` stack.

It is deliberately a development design. It does not use OCI Database because OCI Always Free does not provide a managed PostgreSQL service suitable for this stack. PostgreSQL therefore runs in Docker on the VM alongside the backend and frontend.

## What it creates

- One VCN, internet gateway, public route table, public subnet, and application security list.
- One `VM.Standard.A1.Flex` instance using a region-compatible ARM64 Ubuntu 24.04 image.
- An ephemeral public IP by default, or an optional regional reserved public IP.
- A boot volume and an optional paravirtualized block volume.
- A dynamic group and compartment policy that let only this instance read the two named OCI Vault secret bundles.
- Cloud-init bootstrap scripts and a systemd service for the Docker Compose stack.

The development security list permits HTTP on port 80, reserves port 443 for a later TLS proxy, and exposes the backend on port 3030 because the frontend currently embeds its API URL at build time. SSH is closed unless `ssh_ingress_cidrs` is explicitly populated. PostgreSQL port 5432 is not allowed through the OCI security list.

The infrastructure Compose override adds persistent Docker volumes for `/app/private_uploads` and `/app/uploads/public`, supplies the URL-encoded database connection string, and keeps proxy-header trust disabled by default.

## Layout

```text
infra/terraform/oci/
  backend.dev.hcl.example
  modules/
    instance/
    network/
  templates/
    bootstrap.sh.tftpl
    docker-compose.infrastructure.yml
    docker-compose.pg19-tuning.yml
  environments/
    dev/
```

## Always Free caveats

Always Free eligibility and capacity are account-, region-, and availability-domain-dependent. The commonly advertised tenancy allowance is up to four Ampere A1 OCPUs, 24 GB of A1 memory, and 200 GB total boot/block volume capacity, but Oracle can change service limits and available shapes. Confirm the current limits and the console's Always Free eligibility before applying.

An eligible limit is not a capacity reservation. A1 launches frequently fail with an out-of-host-capacity response in busy availability domains. Try another availability domain or region rather than changing the stack to a paid shape unintentionally. Terraform cannot guarantee capacity and this repository does not retry paid alternatives.

The defaults request two OCPUs, 12 GB memory, and a 50 GB boot volume. The module rejects allocations above the common A1 and 200 GB storage ceilings, but those checks do not prove that the tenancy has unused free quota. A reserved public IP and Object Storage state bucket also consume tenancy resources; verify their current pricing and free eligibility.

There is no SLA, horizontal redundancy, managed database failover, or automatic VM replacement in this slice. Treat all data as disposable unless backups have been tested.

## PostgreSQL 19 Beta boundary

The repository's root Compose stack currently uses `postgres:19beta2`. This infrastructure preserves that choice only for development. Do not promote the VM or its database volume to production, and do not assume an in-place upgrade path from a beta database cluster.

`enable_pg19_beta_tuning` is false by default. When enabled, cloud-init adds `docker-compose.pg19-tuning.yml` with conservative memory, WAL, checkpoint, and storage-cost settings sized for the default 12 GB VM. They are hypotheses, not universal improvements. Benchmark query latency, throughput, memory pressure, checkpoints, and recovery behavior before retaining them. Adjustments can be made through the non-secret `pre_compose_script` hook or by changing the tracked override in a reviewed change.

The opt-in path also composes the repository's `docker-compose.pg19-tuned.yml`,
which enables the PostgreSQL 19 AIO/autovacuum profile and runs the reversible
schema-level tuning script before the backend starts. The OCI override repeats
the complete server command so Compose's command replacement keeps those PG19
settings while adding the 12 GB VM sizing assumptions.

There is no per-boot database bootstrap service. PostgreSQL's entrypoint applies
the V1 baseline and `seed.sql` once when it initializes a new empty
volume. Existing V1 volumes are left unchanged on later boots.

## Prerequisites

- Terraform 1.5.7 or a newer Terraform 1.x release.
- OCI API-key authentication configured through environment variables or the optional provider metadata variables.
- A compartment where the Terraform principal can manage networking, instances, volumes, dynamic groups, and policies.
- Two existing OCI Vault secrets in the target compartment:
  - `postgres_password_secret_ocid`: one non-empty, single-line PostgreSQL password.
  - `jwt_secret_ocid`: one single-line random value of at least 32 characters.
- At least one SSH public key.
- Network egress from the VM to Ubuntu, Docker, Python, GitHub, and OCI endpoints during bootstrap.

Secret OCIDs are identifiers, not secret values. Terraform stores the OCIDs and rendered cloud-init in state, but it never reads or stores either secret value. Do not put secrets in `terraform.tfvars`, `pre_compose_script`, `post_compose_script`, Git URLs, or Terraform backend files.

The instance-principal policy is created only after the instance exists, so cloud-init retries Vault access while OCI identity policy changes propagate. Bootstrap can consequently take tens of minutes, especially while building the Rust backend on A1.

## Remote state in OCI Object Storage

Terraform 1.5.7 can use OCI Object Storage through its S3 compatibility endpoint. Local state is the default. To opt into remote state, create a private, versioned bucket separately, copy `environments/dev/backend.s3.tf.example` to `environments/dev/backend.tf`, copy `backend.dev.hcl.example` to `backend.dev.hcl`, and replace the bucket, namespace, endpoint, and region placeholders.

Create an OCI Customer Secret Key for a narrowly scoped state user and expose it only to the Terraform process:

```bash
export AWS_ACCESS_KEY_ID='customer-secret-key-access-key'
export AWS_SECRET_ACCESS_KEY='customer-secret-key-secret'
```

Do not commit or write those values into the backend file. OCI's S3 compatibility layer does not provide the DynamoDB locking used by AWS S3 backends, and Terraform 1.5.7 predates S3 lockfiles. Serialize all plan/apply operations in one protected CI environment and enable Object Storage versioning for recovery.

## Initialize and review development

From `infra/terraform/oci/environments/dev`:

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive ../..
terraform validate
terraform plan -out=dev.tfplan
```

For OCI Object Storage state, create the two ignored backend files described
above and initialize with `terraform init -backend-config=../../backend.dev.hcl`
instead.

Review the plan carefully for paid shapes, storage above free quotas, unexpected public ingress, and identity policy scope before applying. No cloud apply is performed by repository code.

## First boot

Cloud-init performs these steps:

1. Installs Docker Engine, Compose, Git, and the OCI CLI.
2. When `create_data_volume = true`, waits for `/dev/oracleoci/oraclevdb`, formats it only when it has no filesystem, mounts it, and configures it as Docker's data root.
3. Reads the PostgreSQL password and JWT secret through instance-principal authentication.
4. Resolves the VM public IP from OCI instance metadata unless explicit origins were supplied.
5. Writes a mode-0600 Compose environment file with a URL-encoded database password.
6. Clones the configured repository ref and installs the infrastructure and optional PostgreSQL tuning overrides.
7. Enables the `hotel-app-compose.service` systemd unit and builds/starts the stack.

Changing cloud-init inputs in Terraform does not guarantee that cloud-init reruns on an existing VM. Replace the development instance or perform the equivalent reviewed operation manually when changing repository refs, bootstrap hooks, origins, or Compose overrides.

Inspect bootstrap status with the `cloud_init_log_command` output. Useful on-instance checks are:

```bash
sudo cloud-init status --wait
sudo journalctl -u hotel-app-compose --no-pager
sudo docker compose --env-file /etc/hotel-app/runtime.env \
  -f /opt/hotel-app/docker-compose.yml \
  -f /opt/hotel-app/docker-compose.infrastructure.yml ps
```

With no origin overrides, the frontend is `http://PUBLIC_IP` and its API is `http://PUBLIC_IP:3030`. If a domain or TLS reverse proxy is added, set both `frontend_origin` and `api_url`, update exact `allowed_origins` and `passkey_rp_id`, and set `trust_proxy_headers = true` only when that proxy overwrites forwarded-client headers.

## Storage and teardown

Without a data volume, the PostgreSQL and upload Docker volumes live on the instance boot volume and disappear when Terraform destroys the instance. With `create_data_volume = true`, Docker data moves to the attached block volume, but that volume is still Terraform-managed and is deleted during a normal destroy. Add explicit backup/export and retention controls before storing anything valuable.

Do not use `terraform destroy` as a troubleshooting step when the database contains data that has not been exported and restored successfully elsewhere.
