//! Retained outgoing versions; transactionally recorded with notebook saves.
use postgres::Transaction;
use serde_json::{json, Value};

pub(crate) fn body_changed(before: &Value, after: &Value) -> bool {
    ["title", "content", "kind", "board"]
        .iter()
        .any(|key| before[*key] != after[*key])
}
pub(crate) fn capture(
    transaction: &mut Transaction<'_>,
    note: &Value,
    force: bool,
) -> Result<(), String> {
    let id = note["id"].as_str().ok_or("Invalid history item")?;
    let bytes = serde_json::to_vec(note).map_err(|e| e.to_string())?.len() as i64;
    if bytes > 64 * 1024 * 1024 {
        if force {
            return Err("This current version exceeds the history budget. Export a notebook backup before changing it.".into());
        }
        return Ok(());
    }
    if !force && transaction.query_opt("SELECT id FROM still_history WHERE item_id=$1 AND created_at>now()-interval '5 minutes' LIMIT 1", &[&id]).map_err(|e| e.to_string())?.is_some() { return Ok(()); }
    let version = uuid::Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO still_history(id,item_id,document,bytes) VALUES($1,$2,$3,$4)",
            &[&version, &id, &note, &bytes],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn retain(transaction: &mut Transaction<'_>) -> Result<(), String> {
    transaction.batch_execute("DELETE FROM still_history WHERE created_at<now()-interval '30 days'; DELETE FROM still_history WHERE id IN (SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY item_id ORDER BY created_at DESC,id DESC) AS ordinal FROM still_history) ranked WHERE ordinal>20); DELETE FROM still_history WHERE id IN (SELECT id FROM (SELECT id,sum(bytes) OVER(ORDER BY created_at DESC,id DESC) AS total FROM still_history) sized WHERE total>67108864);").map_err(|e| e.to_string())
}
pub(crate) fn entry(row: &postgres::Row) -> Value {
    json!({"id":row.get::<_,String>(0),"itemId":row.get::<_,String>(1),"time":row.get::<_,String>(2),"title":row.get::<_,String>(3),"kind":row.get::<_,String>(4),"bytes":row.get::<_,i64>(5)})
}
