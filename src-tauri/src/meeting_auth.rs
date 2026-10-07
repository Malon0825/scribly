//! Public-client OAuth and Windows-protected credentials. Never sent to the WebView.
use crate::meetings::{now, MeetingState};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    time::Duration,
};
use tauri::Manager;

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Credentials {
    pub host: String,
    pub deepgram: String,
    #[serde(default)]
    pub gemini: String,
    #[serde(default)]
    pub openrouter: String,
    #[serde(default)]
    pub preferences: MeetingPreferences,
    pub account: Option<Account>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingPreferences {
    pub transcription_model: String,
    pub request_provider: String,
    pub chatgpt_model: Option<String>,
}
impl Default for MeetingPreferences {
    fn default() -> Self {
        Self {
            transcription_model: "deepgram".into(),
            request_provider: "chatgpt".into(),
            chatgpt_model: None,
        }
    }
}
pub(crate) fn valid_transcription_model(model: &str) -> bool {
    matches!(
        model,
        "deepgram" | "gemini-3.5-transcribe-live" | "gemini-3.5-transcribe"
    )
}
pub(crate) async fn gemini_key(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let key = read(app)?.gemini;
    if key.is_empty() {
        return Err("Connect Gemini in Meeting AI settings first".into());
    }
    Ok(key)
}
pub(crate) async fn openrouter_key(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let key = read(app)?.openrouter;
    if key.is_empty() {
        return Err("Connect OpenRouter in Meeting AI settings first".into());
    }
    Ok(key)
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Account {
    pub client_id: String,
    pub subject: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub expires_at: u64,
    pub scopes: String,
}
pub(crate) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Scribly meeting notes")
        .build()
        .map_err(|e| e.to_string())
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = crate::commands::attachment_root(app)?.join("meeting-credentials");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("connections.bin"))
}
#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| "Credential too large")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI allocates output; copy it once and free it with LocalFree on both paths.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(
            "Windows could not protect or unlock meeting credentials. Reconnect your account."
                .into(),
        );
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(result)
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("Meeting credentials are supported in the Windows desktop app".into())
}
pub(crate) fn read(app: &tauri::AppHandle) -> Result<Credentials, String> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(Credentials::default());
    }
    serde_json::from_slice(&protect(
        &crate::files::read_bounded(&path, 128 * 1024).map_err(|e| e.to_string())?,
        false,
    )?)
    .map_err(|_| "Meeting credentials are damaged. Reconnect your accounts.".into())
}
pub(crate) fn write(app: &tauri::AppHandle, credentials: &Credentials) -> Result<(), String> {
    crate::files::replace(
        &path(app)?,
        &protect(
            &serde_json::to_vec(credentials).map_err(|e| e.to_string())?,
            true,
        )?,
    )
    .map_err(|e| e.to_string())
}
pub(crate) fn status(credentials: &Credentials) -> Value {
    json!({"deepgram": !credentials.deepgram.is_empty(), "gemini": !credentials.gemini.is_empty(), "openrouter": !credentials.openrouter.is_empty(), "preferences": credentials.preferences, "email": credentials.account.as_ref().map(|a| &a.email), "chatgpt": credentials.account.as_ref().is_some_and(|a| a.scopes.split_whitespace().any(|s| s == "chatgpt.tokens.use.direct"))})
}
#[tauri::command]
pub(crate) async fn meeting_set_preferences(
    app: tauri::AppHandle,
    preferences: MeetingPreferences,
) -> Result<Value, String> {
    if !valid_transcription_model(&preferences.transcription_model)
        || !matches!(
            preferences.request_provider.as_str(),
            "chatgpt" | "gemini" | "openrouter"
        )
        || preferences.chatgpt_model.as_ref().is_some_and(|model| {
            model.is_empty() || model.len() > 100 || !model.starts_with("gpt-")
        })
    {
        return Err("Invalid meeting provider selection".into());
    }
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(&app)?;
    credentials.preferences = preferences;
    write(&app, &credentials)?;
    Ok(status(&credentials))
}
#[tauri::command]
pub(crate) async fn meeting_set_gemini(
    app: tauri::AppHandle,
    key: String,
) -> Result<Value, String> {
    let key = key.trim().to_string();
    if key.len() > 512 || key.contains(['\r', '\n', '\0']) {
        return Err("Invalid Gemini key".into());
    }
    if !key.is_empty() {
        let response = client()?
            .get("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash")
            .header("x-goog-api-key", &key)
            .send()
            .await
            .map_err(|_| "Google could not be reached")?;
        if !response.status().is_success() {
            return Err(format!(
                "Google returned HTTP {}. Check your API key and Gemini 3.8 Flash access.",
                response.status().as_u16()
            ));
        }
    }
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(&app)?;
    credentials.gemini = key;
    write(&app, &credentials)?;
    Ok(status(&credentials))
}
#[tauri::command]
pub(crate) async fn meeting_set_openrouter(
    app: tauri::AppHandle,
    key: String,
) -> Result<Value, String> {
    let key = key.trim().to_string();
    if key.len() > 512 || key.contains(['\r', '\n', '\0']) {
        return Err("Invalid OpenRouter key".into());
    }
    if !key.is_empty() {
        let response = client()?
            .get("https://openrouter.ai/api/v1/key")
            .bearer_auth(&key)
            .send()
            .await
            .map_err(|_| "OpenRouter could not be reached")?;
        let value =
            crate::meeting_openrouter::json_response(response, "OpenRouter key check", &key)
                .await?;
        if !value["data"].is_object() {
            return Err("OpenRouter returned an invalid key status".into());
        }
    }
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(&app)?;
    credentials.openrouter = key;
    write(&app, &credentials)?;
    Ok(status(&credentials))
}
#[tauri::command]
pub(crate) async fn meeting_connections(app: tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    Ok(status(&read(&app)?))
}
#[tauri::command]
pub(crate) async fn meeting_set_deepgram(
    app: tauri::AppHandle,
    key: String,
) -> Result<Value, String> {
    let key = key.trim().to_string();
    if key.len() > 512 || key.contains(['\r', '\n', '\0']) {
        return Err("Invalid Deepgram key".into());
    }
    if !key.is_empty() {
        let response = client()?
            .get("https://api.deepgram.com/v1/projects")
            .header("Authorization", format!("Token {key}"))
            .send()
            .await
            .map_err(|_| "Deepgram could not be reached")?;
        if !response.status().is_success() {
            return Err(
                "Deepgram rejected this key. Check its permissions and account status.".into(),
            );
        }
    }
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(&app)?;
    credentials.deepgram = key;
    write(&app, &credentials)?;
    Ok(status(&credentials))
}
#[tauri::command]
pub(crate) fn meeting_cancel_signin(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(cancel) = app
        .state::<MeetingState>()
        .auth
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
    {
        cancel.cancel();
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn meeting_disconnect(app: tauri::AppHandle) -> Result<Value, String> {
    meeting_cancel_signin(app.clone())?;
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(&app)?;
    credentials.account = None;
    write(&app, &credentials)?;
    Ok(status(&credentials))
}
fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub(crate) fn callback(target: &str, expected: &str) -> Result<HashMap<String, String>, String> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Invalid sign-in callback")?;
    if url.path() != "/auth/callback" {
        return Err("Not a sign-in callback".into());
    }
    let mut values = HashMap::new();
    for (key, value) in url.query_pairs() {
        if values
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("Duplicate callback parameter".into());
        }
    }
    if values.get("state").map(String::as_str) != Some(expected) {
        return Err("Sign-in state did not match".into());
    }
    Ok(values)
}
async fn tokens(response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "OpenAI authentication failed ({}). Reconnect your account.",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "OpenAI returned an invalid token response".into())
}
#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    nonce: String,
}
async fn validate_identity(
    http: &reqwest::Client,
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
) -> Result<Claims, String> {
    let discovery: Value = http
        .get("https://auth.openai.com/.well-known/openid-configuration")
        .send()
        .await
        .map_err(|_| "Could not retrieve OpenAI identity configuration")?
        .error_for_status()
        .map_err(|_| "OpenAI identity configuration unavailable")?
        .json()
        .await
        .map_err(|_| "Invalid identity configuration")?;
    if discovery["issuer"] != "https://auth.openai.com" {
        return Err("Unexpected OpenAI identity issuer".into());
    }
    let uri = discovery["jwks_uri"]
        .as_str()
        .ok_or("Missing identity signing keys")?;
    let key_url = reqwest::Url::parse(uri).map_err(|_| "Invalid signing key URL")?;
    if key_url.scheme() != "https" || key_url.host_str() != Some("auth.openai.com") {
        return Err("Unexpected identity signing key host".into());
    }
    let keys: jsonwebtoken::jwk::JwkSet = http
        .get(uri)
        .send()
        .await
        .map_err(|_| "Could not retrieve OpenAI signing keys")?
        .error_for_status()
        .map_err(|_| "OpenAI signing keys unavailable")?
        .json()
        .await
        .map_err(|_| "Invalid signing keys")?;
    let header = jsonwebtoken::decode_header(token).map_err(|_| "Invalid identity token")?;
    if header.alg != jsonwebtoken::Algorithm::RS256 {
        return Err("Unsupported identity signature".into());
    }
    let key = keys
        .find(
            header
                .kid
                .as_deref()
                .ok_or("Identity token has no key ID")?,
        )
        .ok_or("Unknown identity signing key")?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["https://auth.openai.com"]);
    let identity = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_jwk(key).map_err(|_| "Invalid identity signing key")?,
        &validation,
    )
    .map_err(|_| "OpenAI identity validation failed")?
    .claims;
    if identity.sub.is_empty() || nonce.is_some_and(|expected| identity.nonce != expected) {
        return Err("OpenAI identity did not match the sign-in attempt".into());
    }
    Ok(identity)
}
#[tauri::command]
pub(crate) async fn meeting_signin(app: tauri::AppHandle) -> Result<Value, String> {
    let cancel = tokio_util::sync::CancellationToken::new();
    {
        let state = app.state::<MeetingState>();
        let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
        if auth.is_some() {
            return Err("A sign-in is already open".into());
        }
        *auth = Some(cancel.clone());
    }
    let result = tokio::select! { _ = cancel.cancelled() => Err("Sign-in canceled".into()), result = signin(&app) => result };
    app.state::<MeetingState>()
        .auth
        .lock()
        .map_err(|e| e.to_string())?
        .take();
    result
}
async fn signin(app: &tauri::AppHandle) -> Result<Value, String> {
    let state_owner = app.state::<MeetingState>();
    let _credential_guard = state_owner.credentials.lock().await;
    let mut credentials = read(app)?;
    if credentials.host.is_empty() {
        credentials.host = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        write(app, &credentials)?;
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Could not open the local sign-in callback")?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://127.0.0.1:{}/auth/callback",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let oauth_state = secret();
    let nonce = secret();
    let verifier = secret();
    let mut url = reqwest::Url::parse("https://auth.openai.com/api/accounts/authorize")
        .map_err(|e| e.to_string())?;
    let old = credentials.account.as_ref();
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair(
                "client_id",
                old.map_or("dynamic_agent_client", |a| &a.client_id),
            )
            .append_pair("ext_agent_host_id", &credentials.host)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair(
                "scope",
                "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            )
            .append_pair("resource", "https://api.openai.com/v1")
            .append_pair("state", &oauth_state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair(
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            );
        if let Some(account) = old {
            pairs.append_pair("id_token_hint", &account.id_token);
        } else {
            pairs.append_pair("agent_name_hint", "Scribly");
        }
    }
    crate::commands::open_external_link(url.to_string()).await?;
    let started = std::time::Instant::now();
    let values = loop {
        if started.elapsed() > Duration::from_secs(300) {
            return Err("Sign-in timed out. Continue with ChatGPT to try again.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(|e| e.to_string())?;
                let mut bytes = [0u8; 16 * 1024];
                let size = stream
                    .read(&mut bytes)
                    .map_err(|_| "Could not read sign-in callback")?;
                let request = String::from_utf8_lossy(&bytes[..size]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.strip_prefix("GET "))
                    .and_then(|line| line.split_whitespace().next())
                    .unwrap_or("");
                let parsed = callback(target, &oauth_state);
                let message = if parsed.is_ok() {
                    "Authorization received. You can return to Scribly."
                } else {
                    "Invalid callback. Return to the sign-in page."
                };
                let _ = write!(stream,"HTTP/1.1 {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",if parsed.is_ok() { "200 OK" } else { "400 Bad Request" },message.len(),message);
                if let Ok(values) = parsed {
                    break values;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(100)).await
            }
            Err(_) => return Err("The local sign-in callback failed".into()),
        }
    };
    if values.contains_key("error") {
        return Err("OpenAI sign-in was declined. Your previous connection was retained.".into());
    }
    let issued = values
        .get("client_id")
        .or_else(|| old.map(|a| &a.client_id))
        .ok_or("OpenAI did not issue a client registration")?;
    if issued == "dynamic_agent_client" || old.is_some_and(|a| a.client_id != *issued) {
        return Err("OpenAI client registration did not match".into());
    }
    let http = client()?;
    let value = tokens(
        http.post("https://auth.openai.com/api/accounts/oauth/token")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", issued.as_str()),
                (
                    "code",
                    values
                        .get("code")
                        .ok_or("Missing authorization code")?
                        .as_str(),
                ),
                ("code_verifier", &verifier),
                ("redirect_uri", &redirect),
                ("resource", "https://api.openai.com/v1"),
            ])
            .send()
            .await
            .map_err(|_| "OpenAI token exchange could not be reached")?,
    )
    .await?;
    let id_token = value["id_token"].as_str().ok_or("Missing identity token")?;
    let identity = validate_identity(&http, id_token, issued, Some(&nonce)).await?;
    if old.is_some_and(|a| a.subject != identity.sub) {
        return Err(
            "Signed-in account differs from the selected account. Disconnect first to switch."
                .into(),
        );
    }
    let scopes = value["scope"]
        .as_str()
        .ok_or("Missing granted permissions")?;
    if !scopes
        .split_whitespace()
        .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err(
            "ChatGPT plan usage was not authorized. Your prior connection was retained.".into(),
        );
    }
    credentials.account = Some(Account {
        client_id: issued.clone(),
        subject: identity.sub,
        email: identity.email,
        access_token: value["access_token"]
            .as_str()
            .ok_or("Missing access token")?
            .into(),
        refresh_token: value["refresh_token"]
            .as_str()
            .ok_or("Missing refresh token")?
            .into(),
        id_token: id_token.into(),
        expires_at: now() + value["expires_in"].as_u64().ok_or("Missing token expiry")? * 1000,
        scopes: scopes.into(),
    });
    write(app, &credentials)?;
    Ok(status(&credentials))
}
pub(crate) async fn access_token(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<MeetingState>();
    let _guard = state.credentials.lock().await;
    let mut credentials = read(app)?;
    let mut account = credentials
        .account
        .clone()
        .ok_or("Connect ChatGPT in Meeting AI settings first")?;
    if !account
        .scopes
        .split_whitespace()
        .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err("ChatGPT plan permission is missing. Reconnect.".into());
    }
    if account.expires_at <= now() + 60_000 {
        let http = client()?;
        let value = tokens(
            http.post("https://auth.openai.com/api/accounts/oauth/token")
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", account.client_id.as_str()),
                    ("refresh_token", account.refresh_token.as_str()),
                    ("resource", "https://api.openai.com/v1"),
                ])
                .send()
                .await
                .map_err(|_| "Could not refresh ChatGPT sign-in")?,
        )
        .await?;
        if let Some(token) = value["id_token"].as_str() {
            let identity = validate_identity(&http, token, &account.client_id, None).await?;
            if identity.sub != account.subject {
                return Err("Refreshed identity did not match".into());
            }
            account.id_token = token.into();
        }
        account.access_token = value["access_token"]
            .as_str()
            .ok_or("Missing refreshed token")?
            .into();
        if let Some(token) = value["refresh_token"].as_str() {
            account.refresh_token = token.into();
        }
        if let Some(scopes) = value["scope"].as_str() {
            account.scopes = scopes.into();
        }
        if !account
            .scopes
            .split_whitespace()
            .any(|s| s == "chatgpt.tokens.use.direct")
        {
            return Err("ChatGPT plan access was revoked. Reconnect.".into());
        }
        account.expires_at =
            now() + value["expires_in"].as_u64().ok_or("Missing token expiry")? * 1000;
        credentials.account = Some(account.clone());
        write(app, &credentials)?;
    }
    Ok(account.access_token)
}
#[tauri::command]
pub(crate) async fn meeting_models(app: tauri::AppHandle) -> Result<Value, String> {
    let token = access_token(&app).await?;
    let response = client()?
        .get("https://api.openai.com/v1/models")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "OpenAI models could not be reached")?;
    if !response.status().is_success() {
        return Err(
            "Available models could not be loaded. Check ChatGPT access and reconnect.".into(),
        );
    }
    let value: Value = response.json().await.map_err(|_| "Invalid model catalog")?;
    let models = value["models"]
        .as_array()
        .ok_or("OpenAI did not return a subscription model catalog")?;
    Ok(json!(models
        .iter()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| Some(json!({"id":m["slug"].as_str()?,"name":m["display_name"].as_str()?})))
        .collect::<Vec<_>>()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn older_credentials_keep_provider_defaults_and_never_expose_keys() {
        let mut credentials: Credentials = serde_json::from_value(
            json!({"host":"local","deepgram":"private-deepgram","account":null}),
        )
        .unwrap();
        assert!(credentials.gemini.is_empty());
        assert_eq!(credentials.preferences.transcription_model, "deepgram");
        credentials.gemini = "private-gemini".into();
        credentials.preferences.request_provider = "gemini".into();
        let visible = status(&credentials).to_string();
        assert!(!visible.contains("private-deepgram"));
        assert!(!visible.contains("private-gemini"));
        assert_eq!(status(&credentials)["gemini"], true);
    }
    #[test]
    fn oauth_rejects_foreign_state_and_duplicate_parameters() {
        assert!(callback("/auth/callback?state=x&code=a", "x").is_ok());
        assert!(callback("/auth/callback?state=y&code=a", "x").is_err());
        assert!(callback("/auth/callback?state=x&state=x", "x").is_err());
        assert!(callback("/other?state=x", "x").is_err());
    }
    #[cfg(windows)]
    #[test]
    fn credentials_roundtrip_uses_windows_protection() {
        let encoded = protect(b"private-meeting-token", true).unwrap();
        assert!(!encoded
            .windows(b"private-meeting-token".len())
            .any(|part| part == b"private-meeting-token"));
        assert_eq!(protect(&encoded, false).unwrap(), b"private-meeting-token");
    }
}
