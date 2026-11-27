#[path = "benchmark/workloads.rs"]
mod workloads;

use chrono::{DateTime, SecondsFormat, TimeDelta, Utc};
use serde::Serialize;
use serde_json::Value;
use std::error::Error;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};
use workloads::{Case, Entry};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const WARMUPS: usize = 3;
const SAMPLES: usize = 15;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    format: &'static str,
    root: &'a str,
    recorded_at: &'a str,
    entries: &'a [Entry],
}

fn snapshot<'a>(root: &'a str, recorded_at: &'a str, entries: &'a [Entry]) -> Snapshot<'a> {
    Snapshot {
        format: "eval-workspace-snapshot/1",
        root,
        recorded_at,
        entries,
    }
}

fn write_snapshot(file: &Path, root: &str, recorded_at: &str, entries: &[Entry]) -> Result<()> {
    let mut bytes = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b" ");
    snapshot(root, recorded_at, entries).serialize(&mut serde_json::Serializer::with_formatter(
        &mut bytes, formatter,
    ))?;
    bytes.push(b'\n');
    fs::write(file, bytes)?;
    Ok(())
}

// CLI paths use the native spelling without Windows' canonicalization prefix.
fn display_path(path: &Path) -> Result<String> {
    let path = path.to_str().ok_or("non-Unicode benchmark path")?;
    #[cfg(windows)]
    if let Some(suffix) = path.strip_prefix(r"\\?\") {
        return Ok(match suffix.strip_prefix(r"UNC\") {
            Some(share) => format!(r"\\{share}"),
            None => suffix.to_owned(),
        });
    }
    Ok(path.to_owned())
}

fn check_bytes(label: &str, actual: &[u8], expected: &[u8]) -> Result<()> {
    if actual != expected {
        let offset = actual
            .iter()
            .zip(expected)
            .position(|(a, b)| a != b)
            .unwrap_or(actual.len().min(expected.len()));
        let preview = |bytes: &[u8]| {
            String::from_utf8_lossy(&bytes[offset..bytes.len().min(offset + 100)]).into_owned()
        };
        return Err(format!(
            "{label} differs at byte {offset}: expected {:?}, got {:?}",
            preview(expected),
            preview(actual)
        )
        .into());
    }
    Ok(())
}

fn check_record(file: &Path, root: &str, entries: &[Entry]) -> Result<DateTime<Utc>> {
    let actual: Value = serde_json::from_slice(&fs::read(file)?)?;
    let recorded_at = actual["recordedAt"]
        .as_str()
        .ok_or("missing recordedAt string")?;
    let date = DateTime::parse_from_rfc3339(recorded_at)?.to_utc();
    if date.timestamp_subsec_millis() >= 1000
        || date.to_rfc3339_opts(SecondsFormat::Millis, true) != recorded_at
    {
        return Err(format!("invalid v1 recordedAt: {recorded_at:?}").into());
    }
    let expected = serde_json::to_value(snapshot(root, recorded_at, entries))?;
    if actual != expected {
        check_bytes(
            &file.display().to_string(),
            &serde_json::to_vec(&actual)?,
            &serde_json::to_vec(&expected)?,
        )?;
    }
    Ok(date)
}

struct Driver<'a> {
    executable: &'a Path,
    smoke: bool,
}

impl Driver<'_> {
    fn run(&self, command: &str, paths: [&Path; 2], status: i32, stdout: &str) -> Result<Duration> {
        let mut process = Command::new(self.executable);
        process.arg(command).args(paths);
        let start = Instant::now();
        let output = process.output()?;
        let elapsed = start.elapsed();

        if output.status.code() != Some(status) {
            return Err(format!(
                "{command} {paths:?}: expected status {status}, got {}\n{}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }
        check_bytes(&format!("{command} stderr"), &output.stderr, b"")?;
        check_bytes(
            &format!("{command} stdout"),
            &output.stdout,
            stdout.as_bytes(),
        )?;
        Ok(elapsed)
    }

    fn measure(&self, label: &str, mut sample: impl FnMut() -> Result<Duration>) -> Result<()> {
        if self.smoke {
            sample()?;
            return Ok(());
        }
        for _ in 0..WARMUPS {
            sample()?;
        }
        let mut times = Vec::with_capacity(SAMPLES);
        for _ in 0..SAMPLES {
            times.push(sample()?);
        }
        times.sort_unstable();
        println!(
            "Rust {label}: {:.2} ms",
            times[SAMPLES / 2].as_secs_f64() * 1000.0
        );
        Ok(())
    }

    fn workspace(&self, workspace: &Path, evidence: &Path, entries: &[Entry]) -> Result<()> {
        let root = display_path(&workspace.canonicalize()?)?;
        fs::create_dir(evidence)?;
        let record = |target: &Path| -> Result<_> {
            let stdout = format!(
                "Recorded {} entries from {root} to {}\n",
                entries.len(),
                display_path(target)?
            );
            let elapsed = self.run("record", [workspace, target], 0, &stdout)?;
            Ok((elapsed, check_record(target, &root, entries)?))
        };
        println!(
            "{} ({} entries)",
            workspace.file_name().unwrap().to_string_lossy(),
            entries.len()
        );
        let before = evidence.join("before.json");
        let (_, recorded_at) = record(&before)?;
        if !self.smoke {
            let target = evidence.join("sample.json");
            self.measure("record", || {
                let (elapsed, _) = record(&target)?;
                fs::remove_file(&target)?;
                Ok(elapsed)
            })?;
        }
        write_snapshot(
            &before,
            &root,
            &recorded_at.to_rfc3339_opts(SecondsFormat::Millis, true),
            entries,
        )?;
        self.comparisons(evidence, &root, recorded_at, entries)
    }

    fn comparisons(
        &self,
        evidence: &Path,
        root: &str,
        recorded_at: DateTime<Utc>,
        entries: &[Entry],
    ) -> Result<()> {
        let later =
            (recorded_at + TimeDelta::milliseconds(1)).to_rfc3339_opts(SecondsFormat::Millis, true);
        let before = evidence.join("before.json");
        for case in [Case::Clean, Case::Sparse, Case::Dense] {
            let name = case.name();
            let after = evidence.join(format!("{name}.json"));
            let (entries, stdout, status) = case.comparison(entries);
            write_snapshot(&after, root, &later, &entries)?;
            self.measure(&format!("compare ({name})"), || {
                self.run("compare", [&before, &after], status, &stdout)
            })?;
        }
        Ok(())
    }
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let (smoke, executable) = match args.as_slice() {
        [flag, executable] if flag == "--smoke" => (true, executable),
        [executable] if executable != "--smoke" => (false, executable),
        _ => {
            eprintln!("Usage: benchmark [--smoke] <Rust release executable>");
            std::process::exit(2);
        }
    };
    let executable = Path::new(executable).canonicalize()?;
    let driver = Driver {
        executable: &executable,
        smoke,
    };
    let temp = tempfile::Builder::new()
        .prefix("snapshot-benchmark-")
        .tempdir()?;
    let base = temp.path().canonicalize()?;
    if !smoke {
        println!(
            "{} {} Rust benchmark driver, {SAMPLES} runs after {WARMUPS} warmups",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
    }
    let fixture = base.join("eval-fixture");
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/eval-fixture");
    let entries = workloads::copy_fixture(&source, &fixture)?;
    driver.workspace(&fixture, &base.join("eval-fixture-evidence"), &entries)?;
    if smoke {
        println!("Smoke passed (record, clean, sparse, dense)");
    } else {
        let generated = base.join("generated");
        let entries = workloads::generate_workspace(&generated)?;
        driver.workspace(&generated, &base.join("generated-evidence"), &entries)?;

        let evidence = base.join("large-compare-only");
        fs::create_dir(&evidence)?;
        let root = display_path(&base.join("large-workspace"))?;
        let entries = workloads::large_snapshots();
        let recorded_at = "2000-01-01T00:00:00.000Z";
        write_snapshot(&evidence.join("before.json"), &root, recorded_at, &entries)?;
        println!("large-compare-only ({} entries)", entries.len());
        driver.comparisons(&evidence, &root, recorded_at.parse()?, &entries)?;
    }
    temp.close()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn record_oracle_accepts_reordered_json_and_rejects_wrong_contents() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let source = temp.path().join("source");
        fs::create_dir(&source)?;
        fs::write(source.join("note"), b"abc")?;
        let entries = workloads::copy_fixture(&source, &temp.path().join("workspace"))?;
        let file = temp.path().join("record.json");
        let mut record = json!({
            "entries": [{"sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                "size": 3, "type": "file", "path": "note"}],
            "recordedAt": "2000-01-01T00:00:00.000Z",
            "root": "/workspace",
            "format": "eval-workspace-snapshot/1"
        });
        fs::write(&file, record.to_string())?;
        check_record(&file, "/workspace", &entries)?;
        record["entries"][0]["sha256"] = json!("0".repeat(64));
        fs::write(&file, record.to_string())?;
        assert!(check_record(&file, "/workspace", &entries).is_err());
        record["entries"] = json!([]);
        fs::write(&file, record.to_string())?;
        assert!(check_record(&file, "/workspace", &entries).is_err());
        Ok(())
    }
}
