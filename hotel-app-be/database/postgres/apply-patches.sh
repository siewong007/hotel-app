#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

usage() {
    printf 'usage: %s [--check | --container <name> --user <role> --database <db>]\n' "${0##*/}" >&2
    exit 2
}

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 -- "$1" | awk '{print $1}'
    else
        fail 'neither sha256sum nor shasum is available'
    fi
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
catalog_dir_input=${PATCH_CATALOG_DIR:-"$script_dir/patches"}
catalog_dir=$(cd -- "$catalog_dir_input" 2>/dev/null && pwd -P) \
    || fail "patch catalog directory is unavailable: $catalog_dir_input"

check_mode=false
saw_deployment_option=false
container=''
database_user=''
database_name=''
while (($#)); do
    case $1 in
        --check)
            "$check_mode" && usage
            check_mode=true
            shift
            ;;
        --container|--user|--database)
            (($# >= 2)) || usage
            [[ -n $2 && $2 != --* ]] || usage
            saw_deployment_option=true
            case $1 in
                --container)
                    [[ -z $container ]] || usage
                    container=$2
                    ;;
                --user)
                    [[ -z $database_user ]] || usage
                    database_user=$2
                    ;;
                --database)
                    [[ -z $database_name ]] || usage
                    database_name=$2
                    ;;
            esac
            shift 2
            ;;
        *) usage ;;
    esac
done

if "$check_mode" && "$saw_deployment_option"; then
    fail '--check cannot be combined with deployment transport options'
fi

[[ -f "$catalog_dir/manifest.tsv" && ! -L "$catalog_dir/manifest.tsv" ]] \
    || fail 'patch manifest is unavailable'
[[ -f "$catalog_dir/_begin.sql" && ! -L "$catalog_dir/_begin.sql" ]] \
    || fail 'patch begin control is unavailable'
[[ -f "$catalog_dir/_end.sql" && ! -L "$catalog_dir/_end.sql" ]] \
    || fail 'patch end control is unavailable'

umask 077
snapshot_dir=$(mktemp -d "${TMPDIR:-/tmp}/hotel-app-patch.XXXXXX") \
    || fail 'private patch snapshot directory cannot be created'
trap 'rm -rf -- "$snapshot_dir"' EXIT

generations=()
versions=()
names=()
checksums=()
input_snapshots=()
previous_version=0
line_number=0
while IFS= read -r line || [[ -n $line ]]; do
    ((line_number += 1))
    [[ -z $line || $line == \#* ]] && continue

    tabs=${line//[!$'\t']/}
    [[ ${#tabs} -eq 4 ]] || fail "manifest line $line_number must have exactly five tab-separated fields"
    IFS=$'\t' read -r generation version name checksum file <<< "$line"
    [[ $generation =~ ^[1-9][0-9]*$ ]] || fail "invalid generation on manifest line $line_number"
    [[ $version =~ ^[1-9][0-9]*$ ]] || fail "invalid version on manifest line $line_number"
    [[ $name =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || fail "invalid name on manifest line $line_number"
    [[ $checksum =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid checksum on manifest line $line_number"
    [[ $file =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]] || fail "invalid file on manifest line $line_number"
    [[ $generation == 1 ]] || fail "unsupported generation on manifest line $line_number"

    if ((${#versions[@]} == 0)); then
        [[ $version == 2 ]] || fail 'the first patch version must be 2'
    else
        ((version > previous_version)) || fail "duplicate or non-increasing patch version: $version"
        ((version == previous_version + 1)) || fail "patch versions must be contiguous: expected $((previous_version + 1)), found $version"
    fi

    candidate_dir=$(cd -- "$(dirname -- "$catalog_dir/$file")" && pwd -P)
    [[ $candidate_dir == "$catalog_dir" ]] || fail "patch file escapes catalog directory: $file"
    patch_path="$candidate_dir/$file"
    [[ -f $patch_path && ! -L $patch_path ]] || fail "patch file is unavailable: $file"
    snapshot_index=${#versions[@]}
    patch_snapshot="$snapshot_dir/patch-$snapshot_index.sql"
    cp "$patch_path" "$patch_snapshot" || fail "patch snapshot cannot be created: $file"
    [[ -f $patch_snapshot && ! -L $patch_snapshot ]] || fail "patch snapshot is unavailable: $file"
    actual_checksum="sha256:$(sha256_file "$patch_snapshot")"
    [[ $actual_checksum == "$checksum" ]] || fail "checksum mismatch for $file"
    input_snapshot="$snapshot_dir/input-$snapshot_index.sql"
    if ! cat -- "$catalog_dir/_begin.sql" "$patch_snapshot" "$catalog_dir/_end.sql" > "$input_snapshot"; then
        fail "patch input snapshot cannot be constructed: $file"
    fi
    [[ -f $input_snapshot && ! -L $input_snapshot ]] || fail "patch input snapshot is unavailable: $file"

    generations+=("$generation")
    versions+=("$version")
    names+=("$name")
    checksums+=("$checksum")
    input_snapshots+=("$input_snapshot")
    previous_version=$version
done < "$catalog_dir/manifest.tsv"

((${#versions[@]} > 0)) || fail 'patch manifest contains no patch rows'
"$check_mode" && exit 0

if [[ -n $container || -n $database_user || -n $database_name ]]; then
    [[ -n $container && -n $database_user && -n $database_name ]] \
        || fail 'deployment mode requires --container, --user, and --database'
    deployment_mode=true
else
    [[ -n ${DATABASE_URL:-} ]] || fail 'DATABASE_URL is required for local mode'
    deployment_mode=false
fi

run_psql() {
    if "$deployment_mode"; then
        docker exec -i "$container" psql -X -U "$database_user" -d "$database_name" -v ON_ERROR_STOP=1 "$@"
    else
        psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@"
    fi
}

for ((index = 0; index < ${#versions[@]}; index += 1)); do
    run_psql \
        --set="patch_generation=${generations[index]}" \
        --set="patch_version=${versions[index]}" \
        --set="patch_name=${names[index]}" \
        --set="patch_checksum=${checksums[index]}" \
        < "${input_snapshots[index]}"
done

printf '%s\n' \
    'SELECT generation, version, name, checksum, applied_at, app_build' \
    'FROM public.hotel_schema_revisions' \
    'WHERE generation = 1' \
    'ORDER BY version;' |
    run_psql
