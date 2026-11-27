use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::fs;
use std::io;
use std::path::Path;

#[derive(Clone, Serialize)]
pub struct Entry {
    path: String,
    #[serde(flatten)]
    kind: Kind,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Kind {
    Dir,
    File { size: usize, sha256: String },
}

impl Kind {
    fn file(content: &[u8]) -> Self {
        Self::File {
            size: content.len(),
            sha256: format!("{:x}", Sha256::digest(content)),
        }
    }
}

impl Entry {
    fn dir(path: &str) -> Self {
        Self {
            path: path.to_owned(),
            kind: Kind::Dir,
        }
    }

    fn file(path: &str, content: &[u8]) -> Self {
        Self {
            path: path.to_owned(),
            kind: Kind::file(content),
        }
    }
}

fn sort_entries(entries: &mut [Entry]) {
    // JavaScript's v1 path order is lexicographic over UTF-16 code units.
    entries.sort_unstable_by(|a, b| a.path.encode_utf16().cmp(b.path.encode_utf16()));
}

pub fn copy_fixture(source: &Path, workspace: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    let mut directories = vec![source.to_owned()];
    fs::create_dir(workspace)?;
    while let Some(dir) = directories.pop() {
        for child in fs::read_dir(dir)? {
            let child = child?;
            let path = child.path();
            let relative = path.strip_prefix(source).expect("fixture path");
            let destination = workspace.join(relative);
            let name = relative
                .to_str()
                .ok_or_else(|| io::Error::other("non-Unicode fixture path"))?;
            let name = name.replace(std::path::MAIN_SEPARATOR, "/");
            let ty = child.file_type()?;
            if ty.is_dir() {
                fs::create_dir(destination)?;
                entries.push(Entry::dir(&name));
                directories.push(path);
            } else if ty.is_file() {
                // Derive the oracle from the source fixture, before the CLI sees the copy.
                let content = fs::read(path)?;
                entries.push(Entry::file(&name, &content));
                fs::write(destination, content)?;
            } else {
                return Err(io::Error::other(format!(
                    "unsupported fixture entry: {name}"
                )));
            }
        }
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn generate_workspace(workspace: &Path) -> io::Result<Vec<Entry>> {
    fs::create_dir(workspace)?;
    let block = [b'a'; 4096];
    let small_file = Kind::file(&block);
    let mut entries = Vec::new();
    for dir in 0..10 {
        let name = dir.to_string();
        fs::create_dir(workspace.join(&name))?;
        entries.push(Entry::dir(&name));
        for n in 0..100 {
            let path = format!("{dir}/{n}.bin");
            fs::write(workspace.join(&path), block)?;
            entries.push(Entry {
                path,
                kind: small_file.clone(),
            });
        }
    }
    let large = vec![b'b'; 16 * 1024 * 1024];
    entries.push(Entry::file("large.bin", &large));
    fs::write(workspace.join("large.bin"), large)?;
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn large_snapshots() -> Vec<Entry> {
    let mut entries = Vec::with_capacity(30_300);
    for i in 0..100 {
        let group = match i {
            98 => "package-\u{10000}".to_owned(),
            99 => "package-\u{e000}".to_owned(),
            _ => format!("package-{i:02}"),
        };
        let directory = format!("{group}/src/assets");
        for path in [&group, &format!("{group}/src"), &directory] {
            entries.push(Entry::dir(path));
        }
        for n in 0..300 {
            let path = format!("{directory}/resource-{n:03}.js");
            let content = format!("export default {};\n", quote(&path));
            entries.push(Entry::file(&path, content.as_bytes()));
        }
    }
    sort_entries(&mut entries);
    entries
}

fn quote(path: &str) -> String {
    serde_json::to_string(path).expect("serializing a path string")
}

fn change_file(entry: &mut Entry, content: &[u8], report: &mut String) {
    let Kind::File { size, sha256 } = &entry.kind else {
        unreachable!("file edit requires a file entry");
    };
    let replacement = Kind::file(content);
    assert!(
        matches!(&replacement, Kind::File { sha256: new, .. } if new != sha256),
        "replacement must change the digest for {}",
        entry.path
    );
    writeln!(
        report,
        "changed file {} (content, {size} -> {} bytes)",
        quote(&entry.path),
        content.len()
    )
    .unwrap();
    entry.kind = replacement;
}

pub enum Case {
    Clean,
    Sparse,
    Dense,
}

impl Case {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Clean => "clean",
            Self::Sparse => "sparse",
            Self::Dense => "dense",
        }
    }

    pub fn comparison(&self, baseline: &[Entry]) -> (Vec<Entry>, String, i32) {
        if matches!(self, Self::Clean) {
            return (
                baseline.to_vec(),
                "No differences in entries, file contents or link targets (root .git excluded).\n"
                    .into(),
                0,
            );
        }
        let files: Vec<_> = baseline
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| match entry.kind {
                Kind::File { size, .. } => Some((index, size)),
                Kind::Dir => None,
            })
            .collect();
        let mut after = baseline.to_vec();
        let mut stdout = String::new();
        if matches!(self, Self::Sparse) {
            assert!(
                files.len() >= 3,
                "sparse workloads need three distinct files"
            );
            // First, middle and last file are already in v1 report order.
            let (first, size) = files[0];
            change_file(&mut after[first], &vec![0; size], &mut stdout);
            let middle = files[files.len() / 2].0;
            writeln!(stdout, "removed file {}", quote(&baseline[middle].path)).unwrap();
            let mut addition = baseline[files.last().unwrap().0].clone();
            addition.path.push_str(".benchmark-added");
            writeln!(stdout, "added file {}", quote(&addition.path)).unwrap();
            after.remove(middle);
            after.push(addition);
            sort_entries(&mut after);
            stdout.push_str("1 added, 1 removed, 1 changed\n");
        } else {
            for &(index, _) in &files {
                let entry = &mut after[index];
                let content = format!("snapshot benchmark updated {}", entry.path);
                change_file(entry, content.as_bytes(), &mut stdout);
            }
            writeln!(stdout, "0 added, 0 removed, {} changed", files.len()).unwrap();
        }
        (after, stdout, 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparse_change_preserves_size_and_changes_digest() {
        let before = ["a", "b", "c"].map(|path| Entry::file(path, b"abc"));
        let (after, stdout, status) = Case::Sparse.comparison(&before);
        let original = serde_json::to_value(&before[0]).unwrap();
        let changed = serde_json::to_value(&after[0]).unwrap();
        assert_eq!(changed["path"], original["path"]);
        assert_eq!(changed["size"], original["size"]);
        assert_ne!(changed["sha256"], original["sha256"]);
        assert_eq!(status, 1);
        assert_eq!(stdout, "changed file \"a\" (content, 3 -> 3 bytes)\nremoved file \"b\"\nadded file \"c.benchmark-added\"\n1 added, 1 removed, 1 changed\n");
    }
}
