use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

use crate::v1_text::V1Text;
use serde::{Deserialize, Serialize};
use serde_bytes::{ByteBuf, Bytes};
use serde_json::value::RawValue;

pub const FORMAT: &str = "eval-workspace-snapshot/1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub format: String,
    pub root: String,
    pub recorded_at: String,
    pub entries: Vec<Entry>,
}

#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    #[serde(flatten)]
    pub kind: Kind,
}

#[derive(PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Kind<T = String> {
    File { size: u64, sha256: String },
    Dir,
    Symlink { target: T },
    Other,
}

impl<T> Kind<T> {
    fn name(&self) -> &'static str {
        match self {
            Self::File { .. } => "file",
            Self::Dir => "dir",
            Self::Symlink { .. } => "symlink",
            Self::Other => "other",
        }
    }
}

// The v1 recorder used JavaScript string comparison, which orders UTF-16 code units.
pub fn path_order(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

type Entries = HashMap<V1Text, Kind<V1Text>>;

struct Loaded {
    root: V1Text,
    recorded_at: V1Text,
    entries: Entries,
}

// Preserve the JSON token type (including objects with arbitrary keys) until the v1 check.
// A map also preserves JSON.parse's last-value-wins behavior for repeated object fields.
// Byte keys also let us ignore unknown fields whose names contain a lone surrogate.
#[derive(Default, Deserialize)]
#[serde(transparent)]
struct Fields<'a>(#[serde(borrow)] HashMap<ByteBuf, &'a RawValue>);

impl<'a> Fields<'a> {
    fn get(&self, key: &str) -> Option<&'a RawValue> {
        self.0.get(Bytes::new(key.as_bytes())).copied()
    }

    fn text(&self, key: &str) -> Option<String> {
        serde_json::from_str(self.get(key)?.get()).ok()
    }

    fn v1_text(&self, key: &str) -> Option<V1Text> {
        V1Text::parse(self.get(key)?)
    }
}

fn file_size(value: &RawValue) -> Option<u64> {
    // JSON.parse rounds to binary64 before Number.isSafeInteger checks the result.
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    let number: f64 = value.get().parse().ok()?;
    if (0.0..=MAX_SAFE_INTEGER).contains(&number) && number.fract() == 0.0 {
        Some(number as u64)
    } else {
        None
    }
}

fn load(file: &Path) -> Result<Loaded, String> {
    let file_name = file.display();
    let bytes = fs::read(file).map_err(|e| format!("Cannot read snapshot {file_name}: {e}"))?;
    let json = String::from_utf8_lossy(&bytes);
    let invalid_format = || format!("Not a workspace snapshot from this tool: {file_name}");
    // The byte-string decoder used for v1 keys also accepts raw control characters.
    // Validate JSON syntax before decoding keys, preserving escaped lone surrogates.
    let document: &RawValue = serde_json::from_str(&json)
        .map_err(|e| format!("Cannot read snapshot {file_name}: {e}"))?;
    let data: Fields = serde_json::from_str(document.get()).map_err(|e| {
        if e.is_data() {
            invalid_format()
        } else {
            format!("Cannot read snapshot {file_name}: {e}")
        }
    })?;
    if data.text("format").as_deref() != Some(FORMAT) {
        return Err(invalid_format());
    }
    let root = data.v1_text("root").ok_or_else(invalid_format)?;
    let recorded_at = data.v1_text("recordedAt").ok_or_else(invalid_format)?;
    let entries: Vec<&RawValue> = data
        .get("entries")
        .and_then(|value| serde_json::from_str(value.get()).ok())
        .ok_or_else(invalid_format)?;

    let mut by_path = HashMap::with_capacity(entries.len());
    for raw in entries {
        let entry: Fields = serde_json::from_str(raw.get()).unwrap_or_default();
        let path = entry
            .v1_text("path")
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Missing entry path in {file_name}"))?;
        if by_path.contains_key(&path) {
            return Err(format!(
                "Duplicate entry path {} in {file_name}",
                path.quoted()
            ));
        }
        let invalid = |message: &str| format!("{message} for {} in {file_name}", path.quoted());
        let kind = match entry.text("type").as_deref() {
            Some("file") => {
                let mut sha256 = entry
                    .text("sha256")
                    .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                    .ok_or_else(|| invalid("Invalid SHA-256"))?;
                let size = entry
                    .get("size")
                    .and_then(file_size)
                    .ok_or_else(|| invalid("Invalid file size"))?;
                sha256.make_ascii_lowercase();
                Kind::File { size, sha256 }
            }
            Some("symlink") => Kind::Symlink {
                target: entry
                    .v1_text("target")
                    .ok_or_else(|| invalid("Missing link target"))?,
            },
            Some("dir") => Kind::Dir,
            Some("other") => Kind::Other,
            _ => return Err(invalid("Unknown entry type")),
        };
        by_path.insert(path, kind);
    }
    Ok(Loaded {
        root,
        recorded_at,
        entries: by_path,
    })
}

pub fn compare(before: &Path, after: &Path) -> Result<u8, String> {
    let before = load(before)?;
    let after = load(after)?;
    if before.root != after.root {
        return Err(format!(
            "Snapshots come from different workspaces: {} and {}",
            before.root, after.root
        ));
    }
    if before.recorded_at.units().cmp(after.recorded_at.units()) != Ordering::Less {
        return Err(
            "The after snapshot must be a separate record made later than the before snapshot."
                .into(),
        );
    }
    let mut output = io::BufWriter::new(io::stdout().lock());
    let status = report(&before.entries, &after.entries, &mut output).map_err(|e| e.to_string())?;
    output.flush().map_err(|e| e.to_string())?;
    Ok(status)
}

fn report(old: &Entries, now: &Entries, output: &mut impl Write) -> io::Result<u8> {
    enum Change<'a> {
        Added(&'a Kind<V1Text>),
        Removed(&'a Kind<V1Text>),
        Changed(&'a Kind<V1Text>, &'a Kind<V1Text>),
    }
    let mut differences = Vec::new();
    for (path, prev) in old {
        match now.get(path) {
            None => differences.push((path, Change::Removed(prev))),
            Some(new) if prev != new => differences.push((path, Change::Changed(prev, new))),
            _ => {}
        }
    }
    for (path, new) in now {
        if !old.contains_key(path) {
            differences.push((path, Change::Added(new)));
        }
    }
    differences.sort_unstable_by(|a, b| a.0.units().cmp(b.0.units()));
    let (mut added, mut removed, mut changed) = (0usize, 0usize, 0usize);
    for (path, change) in differences {
        match change {
            Change::Added(new) => {
                added += 1;
                writeln!(output, "added {} {}", new.name(), path.quoted())?;
            }
            Change::Removed(prev) => {
                removed += 1;
                writeln!(output, "removed {} {}", prev.name(), path.quoted())?;
            }
            Change::Changed(prev, new) => {
                changed += 1;
                write!(output, "changed {} {} ", new.name(), path.quoted())?;
                match (prev, new) {
                    (Kind::File { size: a, .. }, Kind::File { size: b, .. }) => {
                        writeln!(output, "(content, {a} -> {b} bytes)")?;
                    }
                    (Kind::Symlink { target: a }, Kind::Symlink { target: b }) => {
                        writeln!(output, "(target {} -> {})", a.quoted(), b.quoted())?;
                    }
                    _ => writeln!(output, "(was {})", prev.name())?,
                }
            }
        }
    }
    if added + removed + changed == 0 {
        writeln!(
            output,
            "No differences in entries, file contents or link targets (root .git excluded)."
        )?;
        Ok(0)
    } else {
        writeln!(
            output,
            "{added} added, {removed} removed, {changed} changed"
        )?;
        Ok(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_sizes_follow_javascript_number_conversion() {
        for (input, expected) in [
            ("821.0", Some(821)),
            ("8.21e2", Some(821)),
            ("-0.0", Some(0)),
            ("1e-400", Some(0)),
            ("9007199254740990.8", Some(9_007_199_254_740_991)),
            ("9007199254740992", None),
            ("0.1", None),
            ("-1", None),
            ("\"0\"", None),
            (r#"{"$serde_json::private::Number":"12"}"#, None),
        ] {
            assert_eq!(
                file_size(serde_json::from_str(input).unwrap()),
                expected,
                "{input}"
            );
        }
    }

    #[test]
    fn report_preserves_utf16_order_and_quotes_paths_and_targets() {
        let old = HashMap::from([
            ("\u{e000}".into(), Kind::Other),
            (
                "\u{10000}".into(),
                Kind::Symlink {
                    target: "a\n".into(),
                },
            ),
        ]);
        let now = HashMap::from([
            (
                "\u{10000}".into(),
                Kind::Symlink {
                    target: "b\"".into(),
                },
            ),
            ("A/\"".into(), Kind::Dir),
        ]);
        let mut output = Vec::new();
        assert_eq!(report(&old, &now, &mut output).unwrap(), 1);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            "added dir \"A/\\\"\"\nchanged symlink \"\u{10000}\" (target \"a\\n\" -> \"b\\\"\")\nremoved other \"\u{e000}\"\n1 added, 1 removed, 1 changed\n",
        );
    }
}
