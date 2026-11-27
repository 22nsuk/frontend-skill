mod common;

use common::{compare, CLEAN};
use std::{fs, path::Path};
use tempfile::tempdir;

// Keep the JSON spellings intact: Rust strings cannot themselves contain lone surrogates.
fn snapshot(path: &Path, root: &str, timestamp: &str, entries: &str) {
    fs::write(path, format!(
        r#"{{"format":"eval-workspace-snapshot/1","root":"{root}","recordedAt":"{timestamp}","entries":[{entries}]}}"#
    )).unwrap();
}

const EMPTY_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

fn empty_file(hash: &str, size: &str) -> String {
    format!(r#"{{"path":"empty","type":"file","sha256":"{hash}","size":{size}}}"#)
}

#[test]
fn validates_both_inputs_before_reporting_any_differences() {
    let temp = tempdir().unwrap();
    let valid = temp.path().join("valid");
    let edited = temp.path().join("edited");
    let empty = empty_file(EMPTY_HASH, "0");
    snapshot(&valid, "/site", "1", &empty);
    for number in ["0", "0.0", "-0", "0e2"] {
        snapshot(
            &edited,
            "/site",
            "2",
            &empty_file(&EMPTY_HASH.to_uppercase(), number),
        );
        assert_eq!(compare(&valid, &edited, 0), CLEAN);
    }
    let cases = [
        (format!("{empty},{empty}"), "Duplicate entry path"),
        (empty_file(&"a".repeat(63), "0"), "Invalid SHA-256"),
        (empty_file(&"z".repeat(64), "0"), "Invalid SHA-256"),
        (empty_file(EMPTY_HASH, "-1"), "Invalid file size"),
        (empty_file(EMPTY_HASH, "0.5"), "Invalid file size"),
        (
            empty_file(EMPTY_HASH, r#"{"$serde_json::private::Number":"0"}"#),
            "Invalid file size",
        ),
        (r#"{"path":"","type":"dir"}"#.into(), "Missing entry path"),
        (r#"{"type":"other"}"#.into(), "Missing entry path"),
        (
            r#"{"path":"bad","type":"symlink","target":7}"#.into(),
            "Missing link target",
        ),
        (
            r#"{"path":"bad","type":"socket"}"#.into(),
            "Unknown entry type",
        ),
    ];
    for (entries, diagnostic) in cases {
        snapshot(&edited, "/site", "2", &entries);
        for (first, second) in [(&valid, &edited), (&edited, &valid)] {
            let error = compare(first, second, 2);
            assert!(error.contains(diagnostic), "{entries}: {error}");
        }
    }
}

#[test]
fn compares_and_quotes_utf16_paths_and_link_targets() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    snapshot(
        &before,
        "/site",
        "1",
        r#"
        {"path":"\\ud800","type":"other"},
        {"path":"\uD800","type":"symlink","target":"quote\"\\\n\ud800"},
        {"path":"𐀀","type":"symlink","target":"\uD800\uDC00"},
        {"path":"\ud801","type":"other"}
    "#,
    );
    snapshot(
        &after,
        "/site",
        "2",
        r#"
        {"path":"\ufffd","type":"other"},
        {"path":"\ue000","type":"other"},
        {"path":"\udc00","type":"dir"},
        {"path":"\udb80\udc00","type":"other"},
        {"path":"\ud800\udc00","type":"symlink","target":"𐀀"},
        {"path":"\ud800","type":"symlink","target":"quote\"\\\n\udc00"},
        {"path":"\\ud800","type":"dir"}
    "#,
    );
    assert_eq!(
        compare(&before, &after, 1),
        concat!(
            r#"changed dir "\\ud800" (was other)"#,
            "\n",
            r#"changed symlink "\ud800" (target "quote\"\\\n\ud800" -> "quote\"\\\n\udc00")"#,
            "\n",
            r#"removed other "\ud801""#,
            "\n",
            "added other \"\u{f0000}\"\n",
            r#"added dir "\udc00""#,
            "\n",
            "added other \"\u{e000}\"\n",
            "added other \"\u{fffd}\"\n",
            "4 added, 1 removed, 2 changed\n",
        )
    );
}

#[test]
fn detects_duplicate_paths_by_utf16_value() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    snapshot(&before, "/site", "1", "");
    for (first, second, quoted) in [
        (r"\uD800", r"\ud800", r#""\ud800""#),
        (r"\uDC00", r"\udc00", r#""\udc00""#),
        ("𐀀", r"\ud800\udc00", r#""𐀀""#),
    ] {
        snapshot(
            &after,
            "/site",
            "2",
            &format!(r#"{{"path":"{first}","type":"dir"}},{{"path":"{second}","type":"other"}}"#),
        );
        let error = compare(&before, &after, 2);
        assert!(
            error.contains(&format!("Duplicate entry path {quoted}")),
            "{error}"
        );
    }
}

#[test]
fn reads_escaped_field_names_and_ignores_unknown_fields() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    let entry = r#"{"path":"\ud800","type":"dir"}"#;
    snapshot(&before, "/site", "1", entry);
    snapshot(
        &after,
        "/site",
        "2",
        r#"{
        "path":"old", "pa\u0074h":"\uD800", "\udfff":{"\ud800":"\udfff"}, "type":"dir"
    }"#,
    );
    assert_eq!(compare(&before, &after, 0), CLEAN);
    for malformed in [r#""\u12xz""#, r#""\x00""#, r#"["\ud800",]"#] {
        let entry = format!(r#"{{"path":"x","type":"dir","ignored":{malformed}}}"#);
        snapshot(&after, "/site", "2", &entry);
        assert!(compare(&before, &after, 2).contains("Cannot read snapshot"));
    }
}

#[test]
fn rejects_unescaped_control_characters_in_keys() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    snapshot(&before, "/site", "1", "");
    snapshot(&after, "/site", "2", "");
    let clean = fs::read_to_string(&after).unwrap();
    for control in ['\t', '\n', '\0'] {
        fs::write(
            &after,
            clean.replacen('{', &format!("{{\"bad{control}key\":0,"), 1),
        )
        .unwrap();
        for (a, b) in [(&before, &after), (&after, &before)] {
            assert!(compare(a, b, 2).contains("Cannot read snapshot"));
        }
    }
    fs::write(
        &after,
        clean.replacen('{', r#"{"ok\t\n\u0000\ud800":0,"#, 1),
    )
    .unwrap();
    assert_eq!(compare(&before, &after, 0), CLEAN);
}

#[test]
fn rejects_invalid_utf8_in_either_snapshot() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    let entry = r#"{"path":"price-�.txt","type":"dir"}"#;
    snapshot(&before, "/site", "1", entry);
    snapshot(&after, "/site", "2", entry);
    assert_eq!(compare(&before, &after, 0), CLEAN);

    let mut bytes = fs::read(&after).unwrap();
    let index = bytes.windows(3).position(|w| w == "�".as_bytes()).unwrap();
    bytes.splice(index..index + 3, [0xff]);
    fs::write(&after, bytes).unwrap();
    for (first, second) in [(&before, &after), (&after, &before)] {
        assert!(compare(first, second, 2).contains("Cannot read snapshot"));
    }
}

#[test]
fn captures_a_large_change_report_through_its_summary() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    let mut entries = Vec::new();
    let mut expected = String::new();
    for index in 0..4000 {
        let path = format!("project/module-{index:04}");
        entries.push(format!(r#"{{"path":"{path}","type":"dir"}}"#));
        expected.push_str(&format!("added dir \"{path}\"\n"));
    }
    snapshot(&before, "/site", "1", "");
    snapshot(&after, "/site", "2", &entries.join(","));
    expected.push_str("4000 added, 0 removed, 0 changed\n");
    assert_eq!(compare(&before, &after, 1), expected);
}

#[test]
fn handles_utf16_roots_and_timestamp_order() {
    let temp = tempdir().unwrap();
    let before = temp.path().join("before");
    let after = temp.path().join("after");
    snapshot(&before, r"/\ud800", r"\ud800\udc00", "");
    snapshot(&after, r"/\uD800", r"\udc00", "");
    assert_eq!(compare(&before, &after, 0), CLEAN);
    assert!(compare(&after, &before, 2).contains("after snapshot must be a separate record"));
    for root in [r"/\udc00", "/�", r"/\uE000"] {
        snapshot(&after, root, r"\udc00", "");
        assert!(compare(&before, &after, 2).contains("different workspaces"));
    }
}
