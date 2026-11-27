use std::{
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub const CLEAN: &str =
    "No differences in entries, file contents or link targets (root .git excluded).\n";

pub fn cli(command: &str, paths: &[&Path], code: i32) -> String {
    let mut child = Command::new(env!("CARGO_BIN_EXE_eval-workspace-snapshot"))
        .arg(command)
        .args(paths)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // A recorder that follows a FIFO could block indefinitely.
    let started = Instant::now();
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() > Duration::from_secs(10) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("{command} {paths:?} timed out");
        }
        thread::sleep(Duration::from_millis(2));
    }
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert_eq!(
        output.status.code(),
        Some(code),
        "{command} {paths:?}\n{stdout}{stderr}"
    );
    if code == 2 {
        assert!(stdout.is_empty(), "{stdout}");
        stderr
    } else {
        assert!(stderr.is_empty(), "{stderr}");
        stdout
    }
}

pub fn compare(before: &Path, after: &Path, code: i32) -> String {
    cli("compare", &[before, after], code)
}
