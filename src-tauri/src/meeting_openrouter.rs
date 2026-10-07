//! Text-only meeting analysis through the explicitly selected free endpoint.
use crate::meeting_auth;
use serde_json::{json, Value};

pub(crate) const MODEL: &str = "nvidia/nemotron-3.5-lightning:free";
const COMPLETION_LIMIT: u32 = 65_000;

pub(crate) struct Failure {
    pub message: String,
    pub token_limit: bool,
}
impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            token_limit: false,
        }
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

fn error_message(status: u16, operation: &str, value: &Value, key: &str) -> String {
    let detail = value["error"]["message"]
        .as_str()
        .unwrap_or("OpenRouter did not provide a readable error reason.");
    let detail = if key.is_empty() {
        detail.to_string()
    } else {
        detail.replace(key, "[redacted]")
    };
    let detail: String = detail
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(1200)
        .collect();
    let hint = match status {
        401 => " Reconnect your OpenRouter API key in Meeting AI settings.",
        402 => " Check your account balance and the API key's credit limit, even for free models.",
        429 => " Free requests are limited. Wait for your quota to reset before trying again.",
        _ => "",
    };
    format!("{operation} failed (OpenRouter HTTP {status}). {detail}{hint} No automatic retry or paid fallback was made.")
}

pub(crate) async fn json_response(
    mut response: reqwest::Response,
    operation: &str,
    key: &str,
) -> Result<Value, String> {
    let status = response.status();
    let limit = if status.is_success() {
        12 * 1024 * 1024
    } else {
        64 * 1024
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        format!("{operation} response was interrupted; previous results were retained.")
    })? {
        if bytes.len() + chunk.len() > limit {
            return Err(if status.is_success() {
                format!("{operation} response exceeded the supported size")
            } else {
                error_message(status.as_u16(), operation, &Value::Null, key)
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice::<Value>(&bytes);
    if !status.is_success() {
        return Err(error_message(
            status.as_u16(),
            operation,
            &value.unwrap_or(Value::Null),
            key,
        ));
    }
    let value = value.map_err(|_| format!("{operation} returned invalid JSON"))?;
    // Some upstream failures are returned inside an otherwise successful HTTP response.
    if value.get("error").is_some() {
        let code = value["error"]["code"]
            .as_u64()
            .and_then(|code| u16::try_from(code).ok())
            .unwrap_or(status.as_u16());
        return Err(error_message(code, operation, &value, key));
    }
    Ok(value)
}

#[derive(Default)]
struct EventStream {
    pending: Vec<u8>,
    data: String,
    text: String,
    finish_reason: Option<String>,
    completion_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    done: bool,
}
impl EventStream {
    fn feed(&mut self, bytes: &[u8], key: &str, operation: &str) -> Result<(), String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > 4 * 1024 * 1024 {
            return Err("OpenRouter event exceeded the supported size".into());
        }
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "Invalid OpenRouter event encoding")?
                .trim_end_matches(['\r', '\n']);
            if !line.is_empty() {
                if let Some(data) = line.strip_prefix("data:") {
                    self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                    self.data.push('\n');
                    if self.data.len() > 4 * 1024 * 1024 {
                        return Err("OpenRouter event exceeded the supported size".into());
                    }
                }
                continue;
            }
            let data = std::mem::take(&mut self.data);
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                self.done = true;
                continue;
            }
            let value: Value =
                serde_json::from_str(data).map_err(|_| "Invalid OpenRouter event")?;
            if value.get("error").is_some() {
                let code = value["error"]["code"]
                    .as_u64()
                    .and_then(|code| u16::try_from(code).ok())
                    .unwrap_or(200);
                return Err(error_message(code, operation, &value, key));
            }
            if let Some(tokens) = value["usage"]["completion_tokens"].as_u64() {
                self.completion_tokens = Some(tokens);
            }
            if let Some(tokens) =
                value["usage"]["completion_tokens_details"]["reasoning_tokens"].as_u64()
            {
                self.reasoning_tokens = Some(tokens);
            }
            let choice = &value["choices"][0];
            if let Some(delta) = choice["delta"]["content"].as_str() {
                self.text.push_str(delta);
                if self.text.len() > 4 * 1024 * 1024 {
                    return Err("Nemotron result exceeded the supported size".into());
                }
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                // Wait for the terminal usage frame. Never let a repeated stop frame
                // conceal an earlier incomplete completion.
                if self
                    .finish_reason
                    .as_deref()
                    .is_none_or(|previous| previous == "stop")
                {
                    self.finish_reason = Some(
                        reason
                            .chars()
                            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                            .take(40)
                            .collect(),
                    );
                }
            }
        }
        Ok(())
    }

    fn completion_error(&self, operation: &str) -> Option<Failure> {
        let reason = self.finish_reason.as_deref().unwrap_or("missing");
        let detail = match reason {
            "length" => format!("The {COMPLETION_LIMIT}-token generation limit was reached before completion. Reasoning and answer text share this budget."),
            "content_filter" => "The provider's content filter stopped generation.".into(),
            "tool_calls" => "The provider returned a tool call instead of the requested meeting result.".into(),
            "error" => "The provider ended generation with an error.".into(),
            "stop" if !self.done => "The connection ended before the stream's completion marker.".into(),
            "stop" if self.text.trim().is_empty() => "The provider finished without returning any answer text.".into(),
            "stop" => return None,
            _ => "The provider did not report a complete answer.".into(),
        };
        let usage = match (self.completion_tokens, self.reasoning_tokens) {
            (Some(total), Some(reasoning)) => {
                format!(" Reported generation tokens: {total}; reasoning: {reasoning}.")
            }
            (Some(total), None) => format!(" Reported generation tokens: {total}."),
            _ => String::new(),
        };
        Some(Failure { message: format!("{operation} did not complete (finish reason: {reason}). {detail}{usage} Previous results were retained; no paid fallback was made."), token_limit: reason == "length" })
    }
}

// Display text is temporary. Full JSON and evidence IDs are validated before saving.
pub(crate) fn draft_texts(text: &str) -> Vec<String> {
    let Some(start) = text
        .find("\"items\"")
        .and_then(|start| text[start + 7..].find('[').map(|offset| start + 8 + offset))
    else {
        return vec![];
    };
    let mut rest = text[start..].trim_start();
    let mut texts = vec![];
    while texts.len() < 300 {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',');
        if !rest.starts_with('{') {
            break;
        }
        let mut values = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        if let Some(Ok(value)) = values.next() {
            if let Some(text) = value["text"].as_str() {
                texts.push(text.chars().take(20_000).collect());
            }
            rest = &rest[values.byte_offset()..];
            continue;
        }
        if let Some(field) = rest.find("\"text\"") {
            let value = rest[field + 6..].trim_start();
            if let Some(value) = value
                .strip_prefix(':')
                .map(str::trim_start)
                .filter(|value| value.starts_with('"'))
            {
                let mut escaped = false;
                let mut end = value.len();
                let mut closed = false;
                for (index, c) in value.char_indices().skip(1) {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    if c == '\\' {
                        escaped = true;
                    } else if c == '"' {
                        end = index + 1;
                        closed = true;
                        break;
                    }
                }
                let mut partial = value[..end].to_string();
                // A delta can end inside an escape or UTF-16 surrogate pair.
                for _ in 0..13 {
                    let candidate = if closed {
                        partial.clone()
                    } else {
                        format!("{partial}\"")
                    };
                    if let Ok(text) = serde_json::from_str::<String>(&candidate) {
                        texts.push(text.chars().take(20_000).collect());
                        break;
                    }
                    if closed || partial.len() <= 1 {
                        break;
                    }
                    partial.pop();
                }
            }
        }
        break;
    }
    texts
}

pub(crate) async fn analyze(
    key: &str,
    operation: &str,
    instructions: &str,
    input: &str,
    mut on_text: impl FnMut(&str),
) -> Result<String, Failure> {
    // This model does not advertise response_format support. The shared prompts specify
    // the JSON contract; the existing evidence parsers validate it before saving results.
    let body = json!({
        "model": MODEL,
        "messages": [{"role":"system","content":instructions},{"role":"user","content":input}],
        "stream": true,
        // Reasoning consumes the same budget as the answer. The selected free
        // endpoint advertises a 65,536-token completion maximum.
        "max_tokens": COMPLETION_LIMIT,
        "provider": {"allow_fallbacks":false,"max_price":{"prompt":0,"completion":0,"request":0}}
    });
    let response = meeting_auth::client()?
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(key)
        .header("X-OpenRouter-Title", "Scribly")
        .json(&body)
        .send()
        .await
        .map_err(|_| "OpenRouter could not be reached; previous results were retained")?;
    if !response.status().is_success() {
        return match json_response(response, operation, key).await {
            Err(error) => Err(error.into()),
            Ok(_) => Err("OpenRouter rejected meeting analysis".into()),
        };
    }
    let mut response = response;
    let mut parser = EventStream::default();
    let mut last = std::time::Instant::now();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "OpenRouter stream was interrupted; previous results were retained")?
    {
        parser.feed(&chunk, key, operation)?;
        if last.elapsed() >= std::time::Duration::from_millis(200) {
            on_text(&parser.text);
            last = std::time::Instant::now();
        }
        if parser.done {
            break;
        }
    }
    if !parser.pending.is_empty() || !parser.data.is_empty() {
        parser.feed(b"\n\n", key, operation)?;
    }
    if let Some(error) = parser.completion_error(operation) {
        return Err(error);
    }
    on_text(&parser.text);
    let text = parser.text.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .and_then(|text| text.trim().strip_suffix("```"))
        .unwrap_or(text)
        .trim();
    Ok(text.to_string())
}
