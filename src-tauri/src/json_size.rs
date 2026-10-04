//! Count UTF-8 JSON bytes without allocating another complete notebook buffer.
use serde::Serialize;
use std::io::{self, Write};
struct Counter {
    bytes: usize,
    limit: usize,
}
impl Write for Counter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes = self
            .bytes
            .checked_add(buffer.len())
            .filter(|n| *n <= self.limit)
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Document exceeds its byte limit",
                )
            })?;
        Ok(buffer.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(crate) fn measure(value: &impl Serialize, limit: usize) -> Result<usize, serde_json::Error> {
    let mut counter = Counter { bytes: 0, limit };
    serde_json::to_writer(&mut counter, value)?;
    Ok(counter.bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_json_escaping_and_unicode_exactly_and_enforces_limit() {
        let value =
            serde_json::json!({"content":"日本語 ✓\n\"quoted\" \\ ","notes":[null,true,42]});
        let expected = serde_json::to_vec(&value).unwrap().len();
        assert_eq!(measure(&value, expected).unwrap(), expected);
        assert!(measure(&value, expected - 1).is_err());
    }
}
