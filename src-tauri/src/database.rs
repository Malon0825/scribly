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
    pub(crate) client: Client,
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
        db.client.batch_execute("ALTER TABLE still_workspace ADD COLUMN IF NOT EXISTS item_order TEXT[]; CREATE TABLE IF NOT EXISTS still_notes (id TEXT PRIMARY KEY, document JSONB NOT NULL);").map_err(database_error)?;
        db.migrate_items()?;
        db.client.batch_execute("CREATE TABLE IF NOT EXISTS still_history (id TEXT PRIMARY KEY,item_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),document JSONB NOT NULL,bytes BIGINT NOT NULL); CREATE INDEX IF NOT EXISTS still_history_item_time ON still_history(item_id,created_at DESC);").map_err(database_error)?;
        Ok(db)
    }
    fn migrate_items(&mut self) -> Result<(), String> {
        let mut transaction = self.client.transaction().map_err(database_error)?;
        let row = transaction
            .query_one(
                "SELECT document,item_order FROM still_workspace WHERE id=1 FOR UPDATE",
                &[],
            )
            .map_err(database_error)?;
        let order: Option<Vec<String>> = row.try_get(1).map_err(|e| e.to_string())?;
        if order.is_some() {
            return Ok(());
        }
        let document: Option<Value> = row.try_get(0).map_err(|e| e.to_string())?;
        if let Some(mut document) = document {
            validate_workspace(&document)?;
            attachments::validate(&self.root, &document)?;
            crate::sources::validate(&self.root, &document)?;
            let notes = document["notes"].take();
            let mut order = Vec::new();
            for note in notes.as_array().ok_or("Invalid legacy notebook")? {
                let id = note["id"].as_str().ok_or("Invalid legacy item ID")?;
                transaction.execute("INSERT INTO still_notes(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document", &[&id, &note]).map_err(database_error)?;
                order.push(id.to_owned());
            }
            document["notes"] = json!([]);
            // Older binaries must reject this format instead of interpreting
            // the metadata-only row as an empty notebook and overwriting it.
            document["schemaVersion"] = json!(5);
            transaction
                .execute(
                    "UPDATE still_workspace SET document=$1,item_order=$2 WHERE id=1",
                    &[&document, &order],
                )
                .map_err(database_error)?;
        } else {
            transaction
                .execute(
                    "UPDATE still_workspace SET item_order=ARRAY[]::TEXT[] WHERE id=1",
                    &[],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)
    }
    /// Confirm a capture against its indexed durable row without loading the notebook.
    pub(crate) fn capture_matches(
        &mut self,
        id: &str,
        title: &str,
        body: &str,
    ) -> Result<bool, String> {
        self.client.query_one(
            "SELECT EXISTS (SELECT 1 FROM still_notes WHERE id=$1 AND document->>'title'=$2 AND document->>'content'=$3 AND coalesce(document->>'kind','note')='note')",
            &[&id, &title, &body],
        ).map_err(database_error)?.try_get(0).map_err(|e| e.to_string())
    }
    pub(crate) fn load(&mut self) -> Result<Value, String> {
        let mut transaction = self
            .client
            .build_transaction()
            .isolation_level(postgres::IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .map_err(database_error)?;
        let row = transaction
            .query_one(
                "SELECT revision,document,item_order FROM still_workspace WHERE id=1",
                &[],
            )
            .map_err(database_error)?;
        let revision: i64 = row.try_get(0).map_err(|e| e.to_string())?;
        if !(0..=MAX_REVISION).contains(&revision) {
            return Err("Invalid saved notebook revision. Preserve the data folder.".into());
        }
        let mut document: Option<Value> = row.try_get(1).map_err(|e| e.to_string())?;
        if let Some(document) = &mut document {
            let order: Vec<String> = row.try_get(2).map_err(|e| e.to_string())?;
            let rows = transaction.query("SELECT n.document FROM unnest($1::TEXT[]) WITH ORDINALITY AS o(id,position) LEFT JOIN still_notes n ON n.id=o.id ORDER BY o.position", &[&order]).map_err(database_error)?;
            let notes: Result<Vec<Value>, String> = rows
                .into_iter()
                .map(|row| {
                    row.try_get::<_, Option<Value>>(0)
                        .map_err(|e| e.to_string())?
                        .ok_or("A saved notebook item is missing. Preserve the data folder.".into())
                })
                .collect();
            document["notes"] = Value::Array(notes?);
        }
        transaction.commit().map_err(database_error)?;
        Ok(
            json!({"revision":revision,"document":document,"dataPath":self.root.to_string_lossy(),"attachments":attachments::list(&self.root)?}),
        )
    }
    pub(crate) fn save(&mut self, mut document: Value, revision: i64) -> Result<i64, String> {
        validate_revision(revision)?;
        validate_workspace(&document)?;
        attachments::validate(&self.root, &document)?;
        crate::sources::validate(&self.root, &document)?;
        let Value::Array(notes) = document["notes"].take() else {
            return Err("Invalid notebook items".into());
        };
        document["notes"] = json!([]);
        document["schemaVersion"] = json!(5);
        let order: Vec<String> = notes
            .iter()
            .map(|note| note["id"].as_str().unwrap().to_owned())
            .collect();
        let mut transaction = self.client.transaction().map_err(database_error)?;
        let row = transaction.query_opt("UPDATE still_workspace SET document=$1,item_order=$2,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$3 RETURNING revision", &[&document, &order, &revision]).map_err(database_error)?.ok_or(CONFLICT)?;
        let next = row.try_get(0).map_err(|e| e.to_string())?;
        for row in transaction
            .query("SELECT id,document FROM still_notes", &[])
            .map_err(database_error)?
        {
            let id: String = row.get(0);
            let previous: Value = row.get(1);
            if let Some(after) = notes.iter().find(|note| note["id"] == id) {
                if crate::history::body_changed(&previous, after) {
                    crate::history::capture(&mut transaction, &previous, false)?;
                }
            } else {
                transaction
                    .execute("DELETE FROM still_history WHERE item_id=$1", &[&id])
                    .map_err(database_error)?;
            }
        }
        crate::history::retain(&mut transaction)?;
        transaction
            .execute("DELETE FROM still_notes WHERE NOT(id=ANY($1))", &[&order])
            .map_err(database_error)?;
        for note in notes {
            let id = note["id"].as_str().unwrap();
            transaction.execute("INSERT INTO still_notes(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document", &[&id, &note]).map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(next)
    }
    pub(crate) fn save_delta(&mut self, delta: Value, revision: i64) -> Result<i64, String> {
        validate_revision(revision)?;
        let changed: std::collections::HashSet<String> = delta["changed"]
            .as_array()
            .ok_or("Invalid notebook update")?
            .iter()
            .map(|note| note["id"].as_str().unwrap_or("").to_owned())
            .collect();
        let mut transaction = self.client.transaction().map_err(database_error)?;
        let row = transaction.query_opt("SELECT document,item_order FROM still_workspace WHERE id=1 AND revision=$1 FOR UPDATE", &[&revision]).map_err(database_error)?.ok_or(CONFLICT)?;
        let mut before: Value = row
            .try_get::<_, Option<Value>>(0)
            .map_err(|e| e.to_string())?
            .ok_or("Missing saved notebook")?;
        // Read only IDs/folder references. Unchanged rich text and board data
        // never cross the save path or get rewritten in PostgreSQL.
        let rows = transaction
            .query(
                "SELECT id,document->>'folderId',document->>'kind' FROM still_notes",
                &[],
            )
            .map_err(database_error)?;
        let stubs: Result<Vec<Value>, String> = rows.iter().map(|row| Ok(json!({"id": row.try_get::<_, String>(0).map_err(|e| e.to_string())?, "folderId": row.try_get::<_, Option<String>>(1).map_err(|e| e.to_string())?, "kind":row.try_get::<_, Option<String>>(2).map_err(|e| e.to_string())?}))).collect();
        before["notes"] = Value::Array(stubs?);
        let mut after = workspace_delta::apply(before, delta)?;
        let Value::Array(notes) = after["notes"].take() else {
            return Err("Invalid notebook update".into());
        };
        let folder_ids: std::collections::HashSet<&str> = after["folders"]
            .as_array()
            .ok_or("Invalid notebook folders")?
            .iter()
            .filter_map(|folder| folder["id"].as_str())
            .collect();
        if notes.iter().any(|note| {
            !note["folderId"].is_null()
                && note["folderId"]
                    .as_str()
                    .is_none_or(|id| !folder_ids.contains(id))
        }) {
            return Err("A note refers to an invalid or missing folder".into());
        }
        let order: Vec<String> = notes
            .iter()
            .map(|note| note["id"].as_str().unwrap().to_owned())
            .collect();
        let template_ids: std::collections::HashSet<String> = notes
            .iter()
            .filter(|note| note["kind"] == "template")
            .map(|note| note["id"].as_str().unwrap().to_owned())
            .collect();
        after["notes"] = Value::Array(
            notes
                .into_iter()
                .filter(|note| changed.contains(note["id"].as_str().unwrap()))
                .collect(),
        );
        crate::workspace::validate_workspace_delta(
            &after,
            &order.iter().map(String::as_str).collect(),
            &template_ids.iter().map(String::as_str).collect(),
        )?;
        attachments::validate(&self.root, &after)?;
        crate::sources::validate(&self.root, &after)?;
        let Value::Array(notes) = after["notes"].take() else {
            unreachable!();
        };
        after["notes"] = json!([]);
        after["schemaVersion"] = json!(5);
        transaction.execute("UPDATE still_workspace SET document=$1,item_order=$2,revision=revision+1,updated_at=now() WHERE id=1", &[&after, &order]).map_err(database_error)?;
        for note in &notes {
            let id = note["id"].as_str().unwrap();
            if let Some(row) = transaction
                .query_opt("SELECT document FROM still_notes WHERE id=$1", &[&id])
                .map_err(database_error)?
            {
                let previous: Value = row.get(0);
                if crate::history::body_changed(&previous, note) {
                    crate::history::capture(&mut transaction, &previous, false)?;
                }
            }
        }
        transaction.execute("DELETE FROM still_history WHERE item_id IN (SELECT id FROM still_notes WHERE NOT(id=ANY($1)))", &[&order]).map_err(database_error)?;
        crate::history::retain(&mut transaction)?;
        transaction
            .execute("DELETE FROM still_notes WHERE NOT(id=ANY($1))", &[&order])
            .map_err(database_error)?;
        for note in notes {
            let id = note["id"].as_str().unwrap();
            transaction.execute("INSERT INTO still_notes(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document", &[&id, &note]).map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(revision + 1)
    }
    pub(crate) fn close(mut self) -> Result<(), String> {
        self.server.close()
    }
    pub(crate) fn list_history(&mut self, item_id: &str) -> Result<Value, String> {
        let rows = self.client.query("SELECT id,item_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),document->>'title',coalesce(document->>'kind','note'),bytes FROM still_history WHERE item_id=$1 ORDER BY created_at DESC,id DESC", &[&item_id]).map_err(database_error)?;
        Ok(Value::Array(
            rows.iter().map(crate::history::entry).collect(),
        ))
    }
    pub(crate) fn read_history(&mut self, id: &str) -> Result<Value, String> {
        self.client
            .query_opt("SELECT document FROM still_history WHERE id=$1", &[&id])
            .map_err(database_error)?
            .map(|row| row.get(0))
            .ok_or("This version is no longer retained.".into())
    }
    pub(crate) fn checkpoint_history(
        &mut self,
        item_id: &str,
        revision: i64,
    ) -> Result<(), String> {
        let mut transaction = self.client.transaction().map_err(database_error)?;
        transaction
            .query_opt(
                "SELECT id FROM still_workspace WHERE id=1 AND revision=$1 FOR UPDATE",
                &[&revision],
            )
            .map_err(database_error)?
            .ok_or(CONFLICT)?;
        let row = transaction
            .query_opt("SELECT document FROM still_notes WHERE id=$1", &[&item_id])
            .map_err(database_error)?
            .ok_or("The item is no longer available")?;
        crate::history::capture(&mut transaction, &row.get::<_, Value>(0), true)?;
        crate::history::retain(&mut transaction)?;
        transaction.commit().map_err(database_error)
    }
    pub(crate) fn history_attachments(
        &mut self,
    ) -> Result<std::collections::HashSet<String>, String> {
        let notes: Vec<Value> = self
            .client
            .query("SELECT document FROM still_history", &[])
            .map_err(database_error)?
            .iter()
            .map(|row| row.get(0))
            .collect();
        Ok(
            attachments::references(&json!({"schemaVersion":5,"notes":notes}))?
                .into_iter()
                .collect(),
        )
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
    #[ignore = "Starts bundled PostgreSQL in an isolated temporary profile"]
    fn migrates_large_legacy_notebooks_and_delta_saves_do_not_rewrite_unchanged_items() {
        let root = std::env::temp_dir().join(format!(
            "scribly-large-notebook-test-{}",
            uuid::Uuid::new_v4()
        ));
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        let mut db = Database::open(root.clone(), runtime.clone()).unwrap();
        let template = json!({"id":"active","title":"Draft","content":"<p>Draft</p>","folderId":"work","createdAt":"now","updatedAt":"now","archived":false});
        let mut notes = vec![template.clone()];
        for index in 0..24 {
            let mut note = template.clone();
            note["id"] = json!(format!("large-{index}"));
            note["content"] = json!("x".repeat(1024 * 1024));
            notes.push(note);
        }
        let legacy = json!({"schemaVersion":3,"theme":"light","activeId":"active","referenceId":null,"folders":[{"id":"work","name":"Work"}],"notes":notes});
        db.client
            .execute(
                "UPDATE still_workspace SET document=$1,item_order=NULL,revision=7 WHERE id=1",
                &[&legacy],
            )
            .unwrap();
        db.close().unwrap();
        let mut db = Database::open(root.clone(), runtime).unwrap();
        let mut migrated = legacy.clone();
        migrated["schemaVersion"] = json!(5);
        assert_eq!(db.load().unwrap()["document"], migrated);
        let version: String = db
            .client
            .query_one("SELECT xmin::text FROM still_notes WHERE id='large-0'", &[])
            .unwrap()
            .get(0);
        let mut changed = template;
        changed["content"] = json!("<p>Small edit</p>");
        let mut metadata = legacy.clone();
        metadata.as_object_mut().unwrap().remove("notes");
        let order: Vec<String> = legacy["notes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|note| note["id"].as_str().unwrap().to_owned())
            .collect();
        let delta = json!({"metadata":metadata,"order":order,"changed":[changed]});
        assert_eq!(db.save_delta(delta.clone(), 7).unwrap(), 8);
        assert!(db
            .save_delta(delta.clone(), 7)
            .unwrap_err()
            .contains("changed elsewhere"));
        let retained: String = db
            .client
            .query_one("SELECT xmin::text FROM still_notes WHERE id='large-0'", &[])
            .unwrap()
            .get(0);
        assert_eq!(version, retained);
        let loaded = db.load().unwrap();
        assert_eq!(loaded["document"]["notes"].as_array().unwrap().len(), 25);
        assert_eq!(
            loaded["document"]["notes"][0]["content"],
            "<p>Small edit</p>"
        );
        let mut invalid = delta;
        invalid["metadata"]["folders"] = json!([]);
        assert!(db.save_delta(invalid, 8).is_err());
        assert_eq!(db.load().unwrap()["revision"], 8);
        db.close().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Starts bundled PostgreSQL in an isolated temporary profile"]
    fn connected_template_deltas_preserve_bodies_images_and_references_after_restart() {
        let root =
            std::env::temp_dir().join(format!("scribly-connected-test-{}", uuid::Uuid::new_v4()));
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        let mut db = Database::open(root.clone(), runtime.clone()).unwrap();
        let image = attachments::store(&root, b"\x89PNG template image").unwrap();
        let note = json!({"id":"n","title":"Source","content":format!("<p><a data-item-id=\"n\" href=\"#scribly-item/n\">Self</a></p><img data-notify-attachment=\"{}\">", image["id"].as_str().unwrap()),"folderId":"f","createdAt":"now","updatedAt":"now","archived":false});
        let document = json!({"schemaVersion":5,"theme":"light","activeId":"n","referenceId":null,"folders":[{"id":"f","name":"Work","copyLastNote":true}],"notes":[note.clone()],"recentIds":["n"]});
        assert_eq!(db.save(document.clone(), 0).unwrap(), 1);
        let version: String = db
            .client
            .query_one("SELECT xmin::text FROM still_notes WHERE id='n'", &[])
            .unwrap()
            .get(0);
        let mut template = note.clone();
        template["id"] = json!("t");
        template["kind"] = json!("template");
        template["folderId"] = Value::Null;
        template["template"] = json!({"titlePattern":"{{title}} {{date}}","resetChecklist":true});
        let mut metadata = document.clone();
        metadata.as_object_mut().unwrap().remove("notes");
        metadata["folders"][0]["templateId"] = json!("t");
        let delta = json!({"metadata":metadata,"order":["n","t"],"changed":[template.clone()]});
        assert_eq!(db.save_delta(delta.clone(), 1).unwrap(), 2);
        let retained: String = db
            .client
            .query_one("SELECT xmin::text FROM still_notes WHERE id='n'", &[])
            .unwrap()
            .get(0);
        assert_eq!(version, retained);
        let mut metadata_only = delta;
        metadata_only["changed"] = json!([]);
        metadata_only["metadata"]["theme"] = json!("dark");
        assert_eq!(db.save_delta(metadata_only.clone(), 2).unwrap(), 3);
        let mut invalid = metadata_only.clone();
        invalid["order"] = json!(["n"]);
        assert!(db.save_delta(invalid, 3).is_err());
        assert_eq!(db.load().unwrap()["revision"], 3);
        // Purging the source must retain the independently stored template image.
        metadata_only["order"] = json!(["t"]);
        metadata_only["metadata"]["activeId"] = json!("");
        metadata_only["metadata"]["recentIds"] = json!([]);
        assert_eq!(db.save_delta(metadata_only, 3).unwrap(), 4);
        db.close().unwrap();
        let mut db = Database::open(root.clone(), runtime).unwrap();
        let loaded = db.load().unwrap();
        assert_eq!(loaded["document"]["notes"], json!([template]));
        assert_eq!(loaded["document"]["folders"][0]["templateId"], "t");
        attachments::validate(&root, &loaded["document"]).unwrap();
        let mut metadata = loaded["document"].clone();
        metadata.as_object_mut().unwrap().remove("notes");
        metadata["folders"][0]
            .as_object_mut()
            .unwrap()
            .remove("templateId");
        assert_eq!(
            db.save_delta(json!({"metadata":metadata,"order":[],"changed":[]}), 4)
                .unwrap(),
            5
        );
        db.close().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Starts bundled PostgreSQL in an isolated temporary profile"]
    fn history_and_trash_survive_restart_and_failed_revisions_without_losing_images() {
        let root =
            std::env::temp_dir().join(format!("scribly-history-test-{}", uuid::Uuid::new_v4()));
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        let mut db = Database::open(root.clone(), runtime.clone()).unwrap();
        let image = attachments::store(&root, b"\x89PNG history image").unwrap();
        let original = json!({"id":"a","title":"Original","content":format!("<p>Original</p><img data-notify-attachment=\"{}\">",image["id"].as_str().unwrap()),"folderId":null,"createdAt":"now","updatedAt":"now","archived":false});
        let mut document = json!({"schemaVersion":4,"theme":"light","activeId":"a","referenceId":null,"folders":[],"notes":[original.clone()]});
        assert_eq!(db.save(document.clone(), 0).unwrap(), 1);
        document["notes"][0]["content"] = json!("<p>New content</p>");
        assert_eq!(db.save(document.clone(), 1).unwrap(), 2);
        let entries = db.list_history("a").unwrap();
        assert_eq!(entries.as_array().unwrap().len(), 1);
        assert_eq!(
            db.read_history(entries[0]["id"].as_str().unwrap()).unwrap(),
            original
        );
        assert!(db
            .history_attachments()
            .unwrap()
            .contains(image["id"].as_str().unwrap()));
        assert!(db.checkpoint_history("a", 1).is_err());
        assert_eq!(db.list_history("a").unwrap().as_array().unwrap().len(), 1);
        db.checkpoint_history("a", 2).unwrap();
        document["schemaVersion"] = json!(5);
        document["notes"][0]["deletedAt"] = json!("2026-10-04T00:00:00.000Z");
        document["activeId"] = json!("");
        assert_eq!(db.save(document.clone(), 2).unwrap(), 3);
        db.close().unwrap();
        let mut db = Database::open(root.clone(), runtime).unwrap();
        assert_eq!(db.load().unwrap()["document"], document);
        assert_eq!(db.list_history("a").unwrap().as_array().unwrap().len(), 2);
        document["notes"] = json!([]);
        assert_eq!(db.save(document, 3).unwrap(), 4);
        assert!(db.list_history("a").unwrap().as_array().unwrap().is_empty());
        db.close().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Starts the bundled PostgreSQL runtime in an isolated temporary profile"]
    fn native_conflicts_validation_timeouts_and_restart_preserve_the_saved_notebook() {
        let root =
            std::env::temp_dir().join(format!("scribly-postgres-test-{}", uuid::Uuid::new_v4()));
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        let doc = json!({"schemaVersion":5,"theme":"dark","folders":[],"notes":[{"id":"n","title":"日本語 ✓","content":"<p>Safe</p>","folderId":null,"createdAt":"x","updatedAt":"x","archived":false,"pinned":true}],"activeId":"n","referenceId":null,"recentIds":["n"]});
        let mut db = Database::open(root.clone(), runtime.clone()).unwrap();
        let mut revision = db.save(doc.clone(), 0).unwrap();
        let mut added = doc.clone();
        let mut second = added["notes"][0].clone();
        second["id"] = json!("m");
        added["notes"].as_array_mut().unwrap().push(second.clone());
        added["recentIds"] = json!(["m", "n"]);
        added["activeId"] = json!("m");
        let mut metadata = added.clone();
        metadata.as_object_mut().unwrap().remove("notes");
        revision = db
            .save_delta(
                json!({"metadata":metadata,"order":["n","m"],"changed":[second]}),
                revision,
            )
            .unwrap();
        assert_eq!(db.load().unwrap()["document"], added);
        added["recentIds"] = json!(["n", "m"]);
        metadata["recentIds"] = added["recentIds"].clone();
        revision = db
            .save_delta(
                json!({"metadata":metadata,"order":["n","m"],"changed":[]}),
                revision,
            )
            .unwrap();
        assert_eq!(db.load().unwrap()["document"], added);
        metadata["recentIds"] = json!(["m"]);
        assert!(db
            .save_delta(
                json!({"metadata":metadata,"order":["n"],"changed":[]}),
                revision
            )
            .is_err());
        assert_eq!(db.load().unwrap()["document"], added);
        revision = db.save(doc.clone(), revision).unwrap();
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
