//! Apply IPC deltas by moving owned notes, preserving large unchanged payloads.
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
struct Delta {
    metadata: Map<String, Value>,
    order: Vec<String>,
    changed: Vec<Value>,
}

pub(crate) fn apply(mut before: Value, delta: Value) -> Result<Value, String> {
    let Delta {
        mut metadata,
        order,
        changed,
    } = serde_json::from_value(delta).map_err(|e| format!("Invalid notebook update: {e}"))?;
    if metadata.contains_key("notes") {
        return Err("Invalid notebook metadata".into());
    }
    let Value::Array(saved) = before
        .get_mut("notes")
        .ok_or("Missing saved notebook")?
        .take()
    else {
        return Err("Missing saved notebook".into());
    };
    let mut notes = HashMap::with_capacity(saved.len());
    for note in saved {
        let id = note["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("Invalid saved note ID")?
            .to_owned();
        if notes.insert(id, note).is_some() {
            return Err("Duplicate saved note ID".into());
        }
    }
    let mut unique = HashSet::with_capacity(changed.len());
    for note in changed {
        let id = note["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("Invalid update ID")?
            .to_owned();
        if !unique.insert(id.clone()) {
            return Err("Duplicate notebook update".into());
        }
        notes.insert(id, note);
    }
    let mut ordered = Vec::with_capacity(order.len());
    for id in order {
        ordered.push(
            notes
                .remove(&id)
                .ok_or("Missing or duplicate ordered item")?,
        );
        unique.remove(&id);
    }
    if !unique.is_empty() {
        return Err("Updated item is missing from the notebook order".into());
    }
    metadata.insert("notes".into(), Value::Array(ordered));
    Ok(Value::Object(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preserves_unchanged_items_and_applies_deletion_and_order() {
        let before = json!({"notes":[{"id":"board","board":{"large":"retained"}},{"id":"note","content":"old"},{"id":"deleted"}]});
        let delta = json!({"metadata":{"theme":"dark"},"order":["note","board"],"changed":[{"id":"note","content":"new"}]});
        let after = apply(before, delta).unwrap();
        assert_eq!(after["notes"][0]["content"], "new");
        assert_eq!(after["notes"][1]["board"]["large"], "retained");
        assert_eq!(after["notes"].as_array().unwrap().len(), 2);
        assert!(apply(
            after,
            json!({"metadata":{},"order":["note","note"],"changed":[]})
        )
        .is_err());
    }
    #[test]
    fn unchanged_large_payload_keeps_its_original_allocation() {
        let before =
            json!({"notes":[{"id":"board","board":{"image":"x".repeat(5 * 1024 * 1024)}}]});
        let pointer = before["notes"][0]["board"]["image"]
            .as_str()
            .unwrap()
            .as_ptr();
        let after = apply(
            before,
            json!({"metadata":{},"order":["board"],"changed":[]}),
        )
        .unwrap();
        assert_eq!(
            after["notes"][0]["board"]["image"]
                .as_str()
                .unwrap()
                .as_ptr(),
            pointer
        );
    }
    #[test]
    fn corrupt_saved_ids_and_inconsistent_updates_are_rejected() {
        let delta = json!({"metadata":{},"order":["a"],"changed":[]});
        for notes in [
            json!([{"id":"a"},{"id":"a"}]),
            json!([{"content":"missing ID"}]),
            json!([{"id":""}]),
        ] {
            assert!(apply(json!({"notes":notes}), delta.clone()).is_err());
        }
        for invalid in [
            json!({"metadata":{"notes":[]},"order":[],"changed":[]}),
            json!({"metadata":{},"order":[42],"changed":[]}),
            json!({"metadata":{},"order":[],"changed":[{"id":"a"}]}),
            json!({"metadata":{},"order":["a"],"changed":[{"id":"a"},{"id":"a"}]}),
        ] {
            assert!(apply(json!({"notes":[]}), invalid).is_err());
        }
    }
}
