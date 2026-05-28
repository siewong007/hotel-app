use std::fs;
use std::path::{Path, PathBuf};

fn target_dir_from_out_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR")?);
    out_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

fn make_writable(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    let mut permissions = metadata.permissions();

    if permissions.readonly() {
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions)?;
    }

    Ok(())
}

fn make_tree_writable(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    make_writable(path)?;

    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            make_tree_writable(&entry?.path())?;
        }
    }

    Ok(())
}

fn remove_stale_bundled_resource(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    make_tree_writable(path)?;

    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn clean_stale_bundled_resources() {
    let Some(target_dir) = target_dir_from_out_dir() else {
        return;
    };

    for resource_dir in ["pgsql", "database"] {
        let path = target_dir.join(resource_dir);
        if let Err(error) = remove_stale_bundled_resource(&path) {
            panic!(
                "failed to clean stale bundled resource output at {}: {}. Close any running desktop app and delete this target resource folder before rebuilding.",
                path.display(),
                error
            );
        }
    }
}

fn main() {
    clean_stale_bundled_resources();
    tauri_build::build()
}
