mod common;

use common::{cli, compare, CLEAN};
use serde_json::{json, Value};
use std::{fs, path::Path, process::Command, thread, time::Duration};
use tempfile::TempDir;

fn tempdir() -> TempDir {
    // Use the long, native spelling for expected roots and junction targets.
    // Windows TEMP can be an 8.3 path and macOS /var can be a symlink.
    let temp = std::env::temp_dir().canonicalize().unwrap();
    #[cfg(windows)]
    let temp = {
        let text = temp.to_str().unwrap();
        if let Some(share) = text.strip_prefix(r"\\?\UNC\") {
            std::path::PathBuf::from(format!(r"\\{share}"))
        } else {
            std::path::PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text))
        }
    };
    tempfile::tempdir_in(temp).unwrap()
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn record(workspace: &Path, output: &Path) {
    assert!(cli("record", &[workspace, output], 0).starts_with("Recorded "));
    // A later record needs its own millisecond timestamp.
    thread::sleep(Duration::from_millis(2));
}

#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) {
    let output = Command::new("pwsh")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:SNAPSHOT_TEST_LINK -Target $env:SNAPSHOT_TEST_TARGET | Out-Null"])
        .env("SNAPSHOT_TEST_LINK", link)
        .env("SNAPSHOT_TEST_TARGET", target)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn unlink_dir(link: &Path) {
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
}

#[test]
fn record_matches_historical_node_v1_fixture() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    let outside = temp.path().join("outside");
    fs::create_dir_all(workspace.join("dir")).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(workspace.join("dir/漢.bin"), [0, 255, 10]).unwrap();
    fs::write(workspace.join("\u{e000}"), []).unwrap();
    fs::write(workspace.join("\u{10000}"), []).unwrap();
    link_dir(&outside, &workspace.join("linked"));

    let native = temp.path().join("native.json");
    record(&workspace, &native);
    let recorded = read_json(&native);
    let timestamp = recorded["recordedAt"].as_str().unwrap();
    let parsed = chrono::DateTime::parse_from_rfc3339(timestamp).unwrap();
    assert_eq!(
        timestamp,
        parsed.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    );

    // Recorded by the Node v1 CLI at a46959d; only the workspace, absolute link
    // target and timestamp were normalized. Compare the complete ordered entries.
    let mut legacy: Value = serde_json::from_str(include_str!("fixtures/node-v1.json")).unwrap();
    legacy["root"] = json!(workspace);
    legacy["entries"][2]["target"] = json!(outside);
    let historical = temp.path().join("historical.json");
    fs::write(&historical, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert_eq!(compare(&historical, &native, 0), CLEAN);
    legacy["recordedAt"] = json!(timestamp);
    assert_eq!(legacy, recorded);

    fs::remove_file(workspace.join("dir/漢.bin")).unwrap();
    fs::create_dir(workspace.join("dir/漢.bin")).unwrap();
    let changed = temp.path().join("changed.json");
    record(&workspace, &changed);
    let expected = "changed dir \"dir/漢.bin\" (was file)\n0 added, 0 removed, 1 changed\n";
    assert_eq!(compare(&historical, &changed, 1), expected);
    assert_eq!(compare(&native, &changed, 1), expected);
}

#[test]
fn reports_ignored_changes_and_skips_only_the_root_git_directory() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    fs::create_dir_all(workspace.join("data")).unwrap();
    fs::create_dir_all(workspace.join("vendor/.git")).unwrap();
    fs::write(workspace.join(".gitignore"), "*.log\nbuild/\n").unwrap();
    fs::write(workspace.join("styles.css"), "body { color: navy; }\n").unwrap();
    fs::write(
        workspace.join("data/requests.csv"),
        "month,count\n2024-01,42\n",
    )
    .unwrap();
    fs::write(workspace.join("debug.log"), "ignored before\n").unwrap();
    fs::write(workspace.join("vendor/.git/config"), "[core]\n").unwrap();
    let init = Command::new("git")
        .current_dir(&workspace)
        .args(["init", "-q"])
        .output()
        .unwrap();
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );
    let before = temp.path().join("before.json");
    record(&workspace, &before);

    let css = workspace.join("styles.css");
    let modified = fs::metadata(&css).unwrap().modified().unwrap();
    fs::write(&css, "body { color: plum; }\n").unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(css)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    fs::write(workspace.join("debug.log"), "ignored after!\n").unwrap();
    fs::create_dir(workspace.join("build")).unwrap();
    fs::write(workspace.join("build/capture.png"), "not really a png").unwrap();
    fs::remove_file(workspace.join("data/requests.csv")).unwrap();
    fs::write(
        workspace.join("vendor/.git/config"),
        "[core]\n\tbare = true\n",
    )
    .unwrap();
    fs::write(workspace.join(".git/evaluator-note"), "index refreshed").unwrap();
    let ignored = Command::new("git")
        .current_dir(&workspace)
        .args(["check-ignore", "debug.log", "build/capture.png"])
        .output()
        .unwrap();
    assert!(
        ignored.status.success(),
        "{}",
        String::from_utf8_lossy(&ignored.stderr)
    );
    assert_eq!(
        String::from_utf8(ignored.stdout)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        ["debug.log", "build/capture.png"]
    );

    let after = temp.path().join("after.json");
    record(&workspace, &after);
    assert_eq!(
        compare(&before, &after, 1),
        concat!(
            "added dir \"build\"\n",
            "added file \"build/capture.png\"\n",
            "removed file \"data/requests.csv\"\n",
            "changed file \"debug.log\" (content, 15 -> 15 bytes)\n",
            "changed file \"styles.css\" (content, 22 -> 22 bytes)\n",
            "changed file \"vendor/.git/config\" (content, 7 -> 20 bytes)\n",
            "2 added, 1 removed, 3 changed\n",
        )
    );
}

#[test]
fn reads_link_targets_without_following_them() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    let outside = temp.path().join("outside");
    let other = temp.path().join("other");
    for dir in [&workspace, &outside, &other] {
        fs::create_dir(dir).unwrap();
    }
    let link = workspace.join("shared");
    link_dir(&outside, &link);
    fs::write(outside.join("secret"), "before").unwrap();
    let before = temp.path().join("before.json");
    record(&workspace, &before);
    assert_eq!(
        read_json(&before)["entries"],
        json!([{"path":"shared","type":"symlink","target":outside}])
    );

    fs::write(outside.join("secret"), "after").unwrap();
    let unchanged = temp.path().join("outside-edit.json");
    record(&workspace, &unchanged);
    assert_eq!(compare(&before, &unchanged, 0), CLEAN);
    for (first, second) in [(&before, &before), (&unchanged, &before)] {
        assert!(compare(first, second, 2).contains("after snapshot must be a separate record"));
    }

    unlink_dir(&link);
    link_dir(&other, &link);
    fs::remove_dir(&other).unwrap(); // Leave a dangling link.
    let after = temp.path().join("retargeted.json");
    record(&workspace, &after);
    assert_eq!(
        compare(&before, &after, 1),
        format!(
            "changed symlink \"shared\" (target {} -> {})\n0 added, 0 removed, 1 changed\n",
            json!(outside),
            json!(other)
        )
    );
}

#[test]
fn records_a_deep_directory_tree() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    fs::create_dir(&workspace).unwrap();
    let mut deepest = workspace.canonicalize().unwrap();
    let depth = if cfg!(target_os = "macos") { 300 } else { 600 };
    for _ in 0..depth {
        deepest.push("d");
        fs::create_dir(&deepest).unwrap();
    }
    let leaf = deepest.join("leaf");
    fs::write(&leaf, "end").unwrap();
    let snapshot = temp.path().join("deep.json");
    record(&workspace, &snapshot);
    let saved = read_json(&snapshot);
    let entries = saved["entries"].as_array().unwrap();
    assert_eq!(entries.len(), depth + 1);
    assert_eq!(
        entries[depth]["path"],
        format!("{}leaf", "d/".repeat(depth))
    );
    assert_eq!(entries[depth]["size"], 3);
    fs::remove_file(leaf).unwrap();
    for _ in 0..depth {
        fs::remove_dir(&deepest).unwrap();
        deepest.pop();
    }
}

#[test]
fn distinguishes_workspace_roots_using_actual_directory_names() {
    let temp = tempdir();
    for (name, variant) in [("İ", "i\u{307}"), ("case", "CASE")] {
        let first = temp.path().join(name);
        let second = temp.path().join(variant);
        fs::create_dir(&first).unwrap();
        match fs::create_dir(&second) {
            Ok(()) => {
                // Both directories exist independently. The second is a valid output
                // directory, and comparing a snapshot of each must fail.
                let before = second.join("before.json");
                record(&first, &before);
                let after = first.join("after.json");
                record(&second, &after);
                assert!(compare(&before, &after, 2).contains("different workspaces"));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let output = second.join("inside.json");
                assert!(cli("record", &[&first, &output], 2).contains("outside the workspace"));
                assert!(!output.exists());
            }
            Err(error) => panic!("cannot create {second:?}: {error}"),
        }
    }
}

#[cfg(unix)]
fn non_unicode_name() -> std::ffi::OsString {
    use std::os::unix::ffi::OsStringExt;
    std::ffi::OsString::from_vec(vec![0xff])
}

#[cfg(windows)]
fn non_unicode_name() -> std::ffi::OsString {
    use std::os::windows::ffi::OsStringExt;
    std::ffi::OsString::from_wide(&[0xd800])
}

// Some macOS volumes reject invalid byte sequences at creation time. These
// recorder cases apply only when the filesystem can actually store the fixture.
fn created_non_unicode_fixture(result: std::io::Result<()>) -> bool {
    match result {
        Ok(()) => true,
        #[cfg(target_os = "macos")]
        Err(e) if matches!(e.raw_os_error(), Some(libc::EILSEQ | libc::EINVAL)) => false,
        Err(e) => panic!("cannot create non-Unicode test fixture: {e}"),
    }
}

#[test]
fn rejects_unrepresentable_workspace_paths_without_publishing() {
    let temp = tempdir();
    let workspace = temp.path().join(non_unicode_name());
    if !created_non_unicode_fixture(fs::create_dir(&workspace)) {
        return;
    }
    let snapshot = temp.path().join("invalid.json");
    assert!(cli("record", &[&workspace, &snapshot], 2).contains("Non-Unicode workspace root"));
    assert!(!snapshot.exists());
    let child = temp.path().join("workspace");
    fs::create_dir(&child).unwrap();
    fs::write(child.join(non_unicode_name()), []).unwrap();
    assert!(cli("record", &[&child, &snapshot], 2).contains("Non-Unicode filename"));
    assert!(!snapshot.exists());
}

#[test]
fn rejects_unrepresentable_symlink_targets_without_publishing() {
    let temp = tempdir();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let link = workspace.join("redirect");
    #[cfg(unix)]
    if !created_non_unicode_fixture(std::os::unix::fs::symlink(non_unicode_name(), link)) {
        return;
    }
    #[cfg(windows)]
    {
        let target = temp.path().join(non_unicode_name());
        fs::create_dir(&target).unwrap();
        // mklink consumes native UTF-16. PowerShell normalizes lone surrogates
        // when it builds its junction reparse buffer.
        let status = Command::new("cmd.exe")
            .current_dir(temp.path())
            .args(["/d", "/c", "mklink", "/j", r"workspace\redirect"])
            .arg(non_unicode_name())
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
        assert!(fs::read_link(&link).unwrap().to_str().is_none());
    }
    let snapshot = temp.path().join("invalid.json");
    let error = cli("record", &[&workspace, &snapshot], 2);
    assert!(
        error.contains("Non-Unicode symlink target for \"redirect\""),
        "{error}"
    );
    assert!(!snapshot.exists());
}

#[cfg(unix)]
#[test]
fn records_fifo_as_other() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    fs::create_dir(&workspace).unwrap();
    assert!(Command::new("mkfifo")
        .arg(workspace.join("pipe"))
        .status()
        .unwrap()
        .success());
    let output = temp.path().join("fifo.json");
    record(&workspace, &output);
    assert_eq!(
        read_json(&output)["entries"],
        json!([{"path":"pipe","type":"other"}])
    );
}

#[test]
fn rejects_invalid_requests_without_writing() {
    let temp = tempdir();
    let workspace = temp.path().join("site");
    fs::create_dir_all(workspace.join("data")).unwrap();
    let alias = temp.path().join("alias");
    link_dir(&workspace, &alias);
    for target in [workspace.join("snap.json"), alias.join("data/snap.json")] {
        assert!(cli("record", &[&workspace, &target], 2).contains("outside the workspace"));
        assert!(!target.exists());
    }

    let before = temp.path().join("before.json");
    record(&workspace, &before);
    let original = fs::read(&before).unwrap();
    assert!(cli("record", &[&workspace, &before], 2).contains("already exists"));
    assert_eq!(fs::read(&before).unwrap(), original);
    let other = temp.path().join("site-other");
    fs::create_dir(&other).unwrap();
    let after = temp.path().join("other.json");
    record(&other, &after);
    assert!(compare(&before, &after, 2).contains("different workspaces"));

    let missing = temp.path().join("missing");
    let target = temp.path().join("x.json");
    assert!(cli("record", &[&missing, &target], 2).contains("existing workspace directory"));
    assert!(!target.exists());
    assert!(cli("record", &[&workspace, &missing.join("x.json")], 2)
        .contains("directory must already exist"));
    assert!(!missing.exists());
    assert!(compare(&before, &missing, 2).contains("Cannot read snapshot"));
    fs::write(&target, r#"{"format":"eval-workspace-snapshot/1"}"#).unwrap();
    assert!(compare(&before, &target, 2).contains("Not a workspace snapshot"));
    assert!(cli("compare", &[&before], 2).contains("Usage:"));
    assert!(cli("diff", &[&workspace, &workspace], 2).contains("Usage:"));
    for help in ["-h", "--help"] {
        assert!(cli(help, &[], 0).contains("eval-workspace-snapshot compare"));
    }
}
