mod record;
mod snapshot;
mod v1_text;

use std::{env, path::Path, process::ExitCode};

const USAGE: &str = "Usage:
  eval-workspace-snapshot record <workspace> <snapshot.json>
  eval-workspace-snapshot compare <before.json> <after.json>";

fn main() -> ExitCode {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let result = match args.as_slice() {
        [help] if help == "--help" || help == "-h" => {
            println!("{USAGE}");
            Ok(0)
        }
        [command, workspace, output] if command == "record" => {
            record::record(Path::new(workspace), Path::new(output))
                .map(|()| 0)
                .map_err(|e| e.to_string())
        }
        [command, before, after] if command == "compare" => {
            snapshot::compare(Path::new(before), Path::new(after))
        }
        _ => Err(format!(
            "Expected record or compare with two paths.\n{USAGE}"
        )),
    };
    match result {
        Ok(code) => ExitCode::from(code),
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}
