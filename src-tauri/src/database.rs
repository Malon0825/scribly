//! Local PostgreSQL ownership and compare-and-swap notebook persistence.
use crate::{attachments, files, workspace::validate_workspace, workspace_delta};
use postgres::{Client, NoTls};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
#[derive(Serialize, Deserialize)]
struct LocalConfig {
    password: String,
    port: u16,
}

impl LocalConfig {
    fn load_or_create(root: &Path) -> Result<Self, String> {
        let path = root.join("local-database.json");
        let config: Self = match files::read_bounded(&path, 8192) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
                format!(
                    "Local database configuration could not be read. Preserve the data folder: {e}"
                )
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if root.join("database").exists() {
                    return Err("Database credentials are missing. Restore local-database.json from a backup; the existing notebook was preserved.".into());
                }
                let config = Self {
                    password: format!(
                        "{}{}",
                        uuid::Uuid::new_v4().simple(),
                        uuid::Uuid::new_v4().simple()
                    ),
                    port: free_port()?,
                };
                config.persist(&path)?;
                config
            }
            Err(e) => {
                return Err(format!(
                    "Local database configuration could not be read. Preserve the data folder: {e}"
                ))
            }
        };
        if config.port == 0
            || config.password.is_empty()
            || config.password.len() > 1024
            || config.password.contains(['\r', '\n', '\0'])
        {
            return Err("Invalid local database configuration. Restore a valid backup; the notebook was preserved.".into());
        }
        Ok(config)
    }
    fn persist(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        files::replace(path, &bytes).map_err(|e| format!("Database configuration could not be saved. Existing credentials were retained: {e}"))
    }
}

// Own the server as soon as it is started/reused, including connection/schema
// failures before Database has been constructed. Drop is a fallback; normal
// shutdown calls close explicitly so errors can be logged.
struct PostgresServer {
    data: PathBuf,
    runtime: PathBuf,
    closed: bool,
}
impl PostgresServer {
    fn close(&mut self) -> Result<(), String> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        run_pg(
            &self.runtime,
            &[
                "-D",
                &self.data.to_string_lossy(),
                "-m",
                "fast",
                "-w",
                "-t",
                "15",
                "stop",
            ],
        )
    }
}
impl Drop for PostgresServer {
    fn drop(&mut self) {
        if let Err(error) = self.close() {
            eprintln!("Notebook database shutdown failed: {error}");
        }
    }
}

pub(crate) struct Database {
    client: Client,
    pub(crate) root: PathBuf,
    server: PostgresServer,
}
pub(crate) struct DatabaseState(pub(crate) Mutex<Option<Database>>);

const CONFLICT: &str = "This notebook changed elsewhere. Export your unsaved notes as a backup before restarting the app.";
const MAX_REVISION: i64 = 9_007_199_254_740_991;
fn validate_revision(revision: i64) -> Result<(), String> {
    if !(0..MAX_REVISION).contains(&revision) {
        return Err("Invalid notebook revision. Preserve a backup before retrying.".into());
    }
    Ok(())
}
fn database_error(error: postgres::Error) -> String {
    if let Some(details) = error.as_db_error() {
        if matches!(details.code().code(), "55P03" | "57014") {
            return "The notebook database is busy. Keep this window open and retry saving.".into();
        }
        return format!("Notebook database error: {}", details.message());
    }
    format!("Notebook database could not be reached. Keep this window open and preserve a backup: {error}")
}

fn hidden_command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.stdin(Stdio::null());
    cmd
}
fn run_pg(runtime: &Path, args: &[&str]) -> Result<(), String> {
    // PostgreSQL's detached children inherit pipe handles on Windows. Waiting
    // for captured output would hang after pg_ctl itself has already exited.
    let status = hidden_command(&runtime.join("bin/pg_ctl.exe"))
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Could not run local PostgreSQL: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Local PostgreSQL command failed ({status}). See postgres.log in the notebook data folder."))
    }
}
fn free_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|s| s.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}
fn connection(config: &LocalConfig) -> postgres::Config {
    let mut c = postgres::Config::new();
    c.host("127.0.0.1")
        .port(config.port)
        .user("still")
        .password(&config.password)
        .dbname("postgres")
        .options("-c statement_timeout=15000 -c lock_timeout=5000")
        .connect_timeout(Duration::from_secs(2));
    c
}
impl Database {
    pub(crate) fn open(root: PathBuf, runtime: PathBuf) -> Result<Self, String> {
        // Tauri may resolve Windows paths with a \\?\ prefix. PostgreSQL's
        // path parser treats that prefix as a directory, so pass plain paths.
        let root = dunce::simplified(&root).to_path_buf();
        let runtime = dunce::simplified(&runtime).to_path_buf();
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        if !runtime.join("bin/postgres.exe").exists() {
            return Err("The bundled PostgreSQL runtime is missing. Reinstall Scribly; your existing notes will be preserved.".into());
        }
        let data = root.join("database");
        let config_path = root.join("local-database.json");
        let mut config = LocalConfig::load_or_create(&root)?;
        if !data.join("PG_VERSION").exists() {
            // Commit a fully initialized cluster only after initdb succeeds.
            // An interrupted first launch can safely retry in a fresh staging folder.
            let staging = root.join(format!("database-init-{}", uuid::Uuid::new_v4().simple()));
            let pw_file = root.join(".init-password");
            fs::write(&pw_file, &config.password).map_err(|e| e.to_string())?;
            let out = hidden_command(&runtime.join("bin/initdb.exe"))
                .arg("-D")
                .arg(&staging)
                .args([
                    "-U",
                    "still",
                    "--encoding=UTF8",
                    "--locale=C",
                    "--auth=scram-sha-256",
                    "--pwfile",
                ])
                .arg(&pw_file)
                .output();
            let _ = fs::remove_file(&pw_file);
            let out =
                out.map_err(|e| format!("Could not initialize your notebook database: {e}"))?;
            if !out.status.success() {
                return Err(format!(
                    "Database initialization failed: {}",
                    String::from_utf8_lossy(&out.stderr)
                ));
            }
            if data.exists() {
                return Err("A partial notebook database already exists. Preserve that folder and contact support before reinitializing it.".into());
            }
            // Windows can retain a directory handle briefly after initdb's
            // child processes exit (and antivirus scanners may open it too).
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                match fs::rename(&staging, &data) {
                    Ok(()) => break,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::PermissionDenied
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(200));
                    }
                    Err(e) => return Err(format!("Could not finish database setup: {e}")),
                }
            }
        }
        // A prior crash can leave our server alive. Only reuse it with our credentials.
        let data_str = data.to_string_lossy().to_string();
        let running = hidden_command(&runtime.join("bin/pg_ctl.exe"))
            .args(["-D", &data_str, "status"])
            .output()
            .map_err(|e| format!("Could not check the notebook database: {e}"))?
            .status;
        let running = match running.code() {
            Some(0) => true,
            Some(3) => false,
            _ => return Err(format!("Could not determine notebook database status ({running}). Preserve the data folder.")),
        };
        let mut connected = if running {
            connection(&config).connect(NoTls).ok()
        } else {
            None
        };
        if running && connected.is_none() {
            return Err("The notebook database is already running but could not be reached. Restart Windows and try again. Your notes remain on disk.".into());
        }
        let mut server = PostgresServer {
            data: data.clone(),
            runtime: runtime.clone(),
            closed: !running,
        };
        if connected.is_none() {
            config.port = free_port()?;
            config.persist(&config_path)?;
            let log = root.join("postgres.log").to_string_lossy().to_string();
            let options=format!("-h 127.0.0.1 -p {} -c max_connections=12 -c shared_buffers=32MB -c fsync=on -c synchronous_commit=on",config.port);
            server.closed = false;
            run_pg(
                &runtime,
                &[
                    "-D", &data_str, "-l", &log, "-o", &options, "-w", "-t", "30", "start",
                ],
            )?;
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match connection(&config).connect(NoTls) {
                    Ok(c) => {
                        connected = Some(c);
                        break;
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(100)),
                }
            }
        }
        let client = connected.ok_or_else(|| {
            format!(
                "Could not connect to the local database. See {}",
                root.join("postgres.log").display()
            )
        })?;
        let mut db = Self {
            client,
            root,
            server,
        };
        db.client.batch_execute("CREATE TABLE IF NOT EXISTS still_workspace (id SMALLINT PRIMARY KEY CHECK(id=1), revision BIGINT NOT NULL DEFAULT 0, document JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO still_workspace(id) VALUES(1) ON CONFLICT(id) DO NOTHING;").map_err(database_error)?;
        Ok(db)
    }
    pub(crate) fn load(&mut self) -> Result<Value, String> {
        let row = self
            .client
            .query_one(
                "SELECT revision,document FROM still_workspace WHERE id=1",
                &[],
            )
            .map_err(database_error)?;
        let revision: i64 = row.try_get(0).map_err(|e| e.to_string())?;
        if !(0..=MAX_REVISION).contains(&revision) {
            return Err("Invalid saved notebook revision. Preserve the data folder.".into());
        }
        let document: Option<Value> = row.try_get(1).map_err(|e| e.to_string())?;
        Ok(
            json!({"revision":revision,"document":document,"dataPath":self.root.to_string_lossy(),"attachments":attachments::list(&self.root)?}),
        )
    }
    pub(crate) fn save(&mut self, document: Value, revision: i64) -> Result<i64, String> {
        validate_revision(revision)?;
        let bytes = validate_workspace(&document)?;
        attachments::validate(&self.root, &document, bytes)?;
        let row=self.client.query_opt("UPDATE still_workspace SET document=$1,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision",&[&document,&revision]).map_err(database_error)?;
        row.ok_or(CONFLICT)?.try_get(0).map_err(|e| e.to_string())
    }
    pub(crate) fn save_delta(&mut self, delta: Value, revision: i64) -> Result<i64, String> {
        validate_revision(revision)?;
        crate::json_size::measure(&delta, 20 * 1024 * 1024)
            .map_err(|e| format!("Notebook update exceeds the 20 MB limit: {e}"))?;
        let row = self
            .client
            .query_opt(
                "SELECT document FROM still_workspace WHERE id=1 AND revision=$1",
                &[&revision],
            )
            .map_err(database_error)?
            .ok_or(CONFLICT)?;
        let before: Option<Value> = row.try_get(0).map_err(|e| e.to_string())?;
        self.save(
            workspace_delta::apply(before.ok_or("Missing saved notebook")?, delta)?,
            revision,
        )
    }
    pub(crate) fn close(mut self) -> Result<(), String> {
        self.server.close()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revisions_stay_within_the_frontend_safe_integer_range() {
        for revision in [-1, MAX_REVISION, i64::MAX] {
            assert!(validate_revision(revision).is_err());
        }
        assert!(validate_revision(0).is_ok());
        assert!(validate_revision(MAX_REVISION - 1).is_ok());
    }
    #[test]
    #[ignore = "Starts the bundled PostgreSQL runtime in an isolated temporary profile"]
    fn native_conflicts_validation_timeouts_and_restart_preserve_the_saved_notebook() {
        let root =
            std::env::temp_dir().join(format!("scribly-postgres-test-{}", uuid::Uuid::new_v4()));
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        let doc = json!({"schemaVersion":2,"theme":"dark","folders":[],"notes":[{"id":"n","title":"日本語 ✓","content":"<p>Safe</p>","folderId":null,"createdAt":"x","updatedAt":"x","archived":false}],"activeId":"n","referenceId":null});
        let mut db = Database::open(root.clone(), runtime.clone()).unwrap();
        let revision = db.save(doc.clone(), 0).unwrap();
        assert_eq!(db.save(doc.clone(), 0).unwrap_err(), CONFLICT);
        let mut malformed = doc.clone();
        malformed["notes"][0]["folderId"] = json!("missing");
        assert!(db.save(malformed, revision).is_err());
        assert!(db
            .save_delta(
                json!({"metadata":{},"order":[],"changed":[{"id":"n"}]}),
                revision
            )
            .is_err());
        assert!(db.save(doc.clone(), -1).is_err());
        let config = LocalConfig::load_or_create(&root).unwrap();
        let password = config.password.clone();
        let mut other = connection(&config).connect(NoTls).unwrap();
        other
            .batch_execute("BEGIN; SELECT id FROM still_workspace WHERE id=1 FOR UPDATE")
            .unwrap();
        db.client.batch_execute("SET lock_timeout='200ms'").unwrap();
        assert!(db.save(doc.clone(), revision).unwrap_err().contains("busy"));
        other.batch_execute("ROLLBACK").unwrap();
        assert_eq!(db.load().unwrap()["document"], doc);
        let next = db.save(doc.clone(), revision).unwrap();
        drop(other);
        db.close().unwrap();
        assert!(!hidden_command(&runtime.join("bin/pg_ctl.exe"))
            .arg("-D")
            .arg(root.join("database"))
            .arg("status")
            .output()
            .unwrap()
            .status
            .success());
        let mut reopened = Database::open(root.clone(), runtime).unwrap();
        let loaded = reopened.load().unwrap();
        assert_eq!(loaded["document"], doc);
        assert_eq!(loaded["revision"], next);
        assert_eq!(
            LocalConfig::load_or_create(&root).unwrap().password,
            password
        );
        reopened
            .client
            .batch_execute("ALTER TABLE still_workspace RENAME COLUMN id TO broken_id")
            .unwrap();
        reopened.close().unwrap();
        // Setup failure after starting the server must not orphan that process.
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        assert!(Database::open(root.clone(), runtime.clone()).is_err());
        assert!(!hidden_command(&runtime.join("bin/pg_ctl.exe"))
            .arg("-D")
            .arg(root.join("database"))
            .arg("status")
            .output()
            .unwrap()
            .status
            .success());
        // Only the uniquely created test profile is removed, after server exit.
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn credentials_survive_port_updates_and_invalid_or_missing_config_is_preserved() {
        let root =
            std::env::temp_dir().join(format!("scribly-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("local-database.json");
        let mut config = LocalConfig::load_or_create(&root).unwrap();
        let password = config.password.clone();
        config.port = 54321;
        config.persist(&path).unwrap();
        let saved = LocalConfig::load_or_create(&root).unwrap();
        assert_eq!(saved.password, password);
        assert_eq!(saved.port, 54321);
        for bytes in [
            b"truncated".as_slice(),
            br#"{"port":0,"password":"test"}"#,
            br#"{"port":5432,"password":""}"#,
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(LocalConfig::load_or_create(&root).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::write(&path, vec![b'x'; 8193]).unwrap();
        assert!(LocalConfig::load_or_create(&root).is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), 8193);
        fs::remove_file(&path).unwrap();
        fs::create_dir(root.join("database")).unwrap();
        assert!(LocalConfig::load_or_create(&root).is_err());
        assert!(!path.exists());
        fs::remove_dir(root.join("database")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
