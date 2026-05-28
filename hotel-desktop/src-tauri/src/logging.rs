use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

struct DesktopLogWriter {
    file: Option<File>,
}

impl DesktopLogWriter {
    fn new() -> (Self, Option<PathBuf>) {
        let log_dir = crate::get_data_directory().join("logs");
        let file_path = log_dir.join(format!(
            "desktop-{}.log",
            chrono::Local::now().format("%Y-%m-%d")
        ));

        let file = match std::fs::create_dir_all(&log_dir).and_then(|_| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file_path)
        }) {
            Ok(file) => Some(file),
            Err(err) => {
                eprintln!(
                    "warning: could not open desktop log file {}: {}",
                    file_path.display(),
                    err
                );
                None
            }
        };

        let active_path = file.as_ref().map(|_| file_path);
        (Self { file }, active_path)
    }
}

impl Write for DesktopLogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let _ = std::io::stderr().write_all(buf);

        if let Some(file) = &mut self.file {
            if let Err(err) = file.write_all(buf) {
                eprintln!("warning: failed to write desktop log file: {}", err);
                self.file = None;
            }
        }

        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let _ = std::io::stderr().flush();

        if let Some(file) = &mut self.file {
            let _ = file.flush();
        }

        Ok(())
    }
}

pub fn init_logging() {
    let (writer, log_file_path) = DesktopLogWriter::new();
    let mut builder =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));

    builder
        .format_timestamp_millis()
        .target(env_logger::Target::Pipe(Box::new(writer)));

    if let Err(err) = builder.try_init() {
        eprintln!("warning: desktop logger already initialized: {}", err);
        return;
    }

    if let Some(path) = log_file_path {
        log::info!("Desktop log file: {}", path.display());
    }
}
