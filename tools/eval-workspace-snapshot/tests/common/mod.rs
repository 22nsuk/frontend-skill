use std::{
    fs::File,
    io::{Read, Seek},
    path::Path,
    process::Command,
    thread,
    time::{Duration, Instant},
};

pub const CLEAN: &str =
    "No differences in entries, file contents or link targets (root .git excluded).\n";

fn read_output(mut file: File) -> String {
    file.rewind().unwrap();
    let mut text = String::new();
    file.read_to_string(&mut text).unwrap();
    text
}

pub fn cli(command: &str, paths: &[&Path], code: i32) -> String {
    // A large report can fill a pipe while the parent is polling the deadline.
    let stdout = tempfile::tempfile().unwrap();
    let stderr = tempfile::tempfile().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_eval-workspace-snapshot"))
        .arg(command)
        .args(paths)
        .stdout(stdout.try_clone().unwrap())
        .stderr(stderr.try_clone().unwrap())
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
    let status = child.wait().unwrap();
    let stdout = read_output(stdout);
    let stderr = read_output(stderr);
    assert_eq!(
        status.code(),
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
