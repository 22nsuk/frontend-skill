use crate::snapshot::{path_order, Entry, Kind, Snapshot, FORMAT};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

// Node's realpath/readlink expose drive and UNC paths without Rust's verbatim prefix.
// Keep the native paths for IO, including long paths on Windows.
fn v1_path(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    #[cfg(windows)]
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        if let Some(share) = rest.strip_prefix(r"UNC\") {
            return Some(format!(r"\\{share}"));
        }
        if rest.as_bytes().get(1) == Some(&b':') {
            return Some(rest.to_owned());
        }
    }
    Some(text.to_owned())
}

fn require_in_place(path: &Path, relative: &str) -> io::Result<()> {
    let resolved = path.canonicalize()?;
    if resolved != path {
        return Err(io::Error::other(format!(
            "Refusing to read {}: it resolves to {}",
            serde_json::to_string(relative)?,
            resolved.display()
        )));
    }
    Ok(())
}

fn hash_file(path: &Path, buffer: &mut [u8]) -> io::Result<Kind> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    let mut hash = Sha256::new();
    let mut size = 0;
    loop {
        let count = file.read(buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        size += count as u64;
    }
    Ok(Kind::File {
        size,
        sha256: format!("{:x}", hash.finalize()),
    })
}

fn walk(root: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    let mut buffer = vec![0; 1 << 20];
    let mut directories = vec![(root.to_owned(), String::new())];
    while let Some((dir, prefix)) = directories.pop() {
        require_in_place(&dir, &prefix)?;
        for child in fs::read_dir(&dir)? {
            let child = child?;
            let name = child.file_name();
            let name = name.to_str().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Non-Unicode filename in {}", dir.display()),
                )
            })?;
            if prefix.is_empty() && name == ".git" {
                continue;
            }
            let path = child.path();
            let relative = if prefix.is_empty() {
                name.to_owned()
            } else {
                format!("{prefix}/{name}")
            };
            let ty = child.file_type()?;
            let kind = if ty.is_symlink() {
                Kind::Symlink {
                    target: v1_path(&fs::read_link(&path)?).ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!("Non-Unicode symlink target for {relative:?}"),
                        )
                    })?,
                }
            } else if ty.is_dir() {
                directories.push((path, relative.clone()));
                Kind::Dir
            } else if ty.is_file() {
                require_in_place(&path, &relative)?;
                hash_file(&path, &mut buffer)?
            } else {
                Kind::Other
            };
            entries.push(Entry {
                path: relative,
                kind,
            });
        }
    }
    Ok(entries)
}

fn output_path(requested: &Path) -> Result<PathBuf, Box<dyn Error>> {
    // Node resolves "." and ".." lexically before resolving links in the parent.
    let mut absolute = PathBuf::new();
    for part in std::path::absolute(requested)?.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                absolute.pop();
            }
            component => absolute.push(component),
        }
    }
    let Some(name) = absolute.file_name() else {
        return Err(format!(
            "Snapshot already exists; choose a new file: {}",
            absolute.display()
        )
        .into());
    };
    let parent = absolute.parent().expect("absolute path with a filename");
    let real_parent = parent.canonicalize().map_err(|_| {
        format!(
            "The snapshot directory must already exist: {}",
            parent.display()
        )
    })?;
    Ok(real_parent.join(name))
}

#[cfg(unix)]
fn directory_id(path: &Path) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::metadata(path)?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn directory_id(path: &Path) -> io::Result<same_file::Handle> {
    same_file::Handle::from_path(path)
}

fn inside_workspace(root: &Path, target: &Path) -> io::Result<bool> {
    if target.starts_with(root) {
        return Ok(true);
    }
    // Aliases and filesystem-specific case rules can give one directory two spellings.
    let root_id = directory_id(root)?;
    for ancestor in target.ancestors().skip(1) {
        if directory_id(ancestor)? == root_id {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn record(workspace: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    if !workspace.is_dir() {
        return Err(format!(
            "Expected an existing workspace directory.\n{}",
            crate::USAGE
        )
        .into());
    }
    let root = workspace.canonicalize()?;
    let recorded_root = v1_path(&root).ok_or("Non-Unicode workspace root")?;
    let target = output_path(output)?;
    let display_target = v1_path(&target).unwrap_or_else(|| target.display().to_string());
    if inside_workspace(&root, &target)? {
        return Err(format!(
            "Record the snapshot outside the workspace: {} is inside {}",
            display_target, recorded_root
        )
        .into());
    }
    match fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(format!(
                "Snapshot already exists; choose a new file: {}",
                display_target
            )
            .into())
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }

    let recorded_at =
        DateTime::<Utc>::from(SystemTime::now()).to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut entries = walk(&root)?;
    entries.sort_unstable_by(|left, right| path_order(&left.path, &right.path));
    let snapshot = Snapshot {
        format: FORMAT.into(),
        root: recorded_root,
        recorded_at,
        entries,
    };

    let mut builder = tempfile::Builder::new();
    builder.prefix(".snapshot-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Node creates the snapshot with mode 0666 filtered by the caller's umask.
        builder.permissions(fs::Permissions::from_mode(0o666));
    }
    let mut temp = builder.tempfile_in(target.parent().expect("resolved output directory"))?;
    {
        let mut writer = BufWriter::new(temp.as_file_mut());
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b" ");
        snapshot.serialize(&mut serde_json::Serializer::with_formatter(
            &mut writer,
            formatter,
        ))?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    temp.persist_noclobber(&target)?;
    println!(
        "Recorded {} entries from {} to {}",
        snapshot.entries.len(),
        snapshot.root,
        display_target
    );
    Ok(())
}
