use serde_bytes::ByteBuf;
use serde_json::value::RawValue;
use std::fmt::{self, Write};

// A v1 JSON string can contain any UTF-16 code unit. serde_json's bytes API decodes
// strings to WTF-8, preserving lone surrogates that cannot be stored in a Rust str.
#[derive(PartialEq, Eq, Hash)]
pub(crate) struct V1Text(ByteBuf);

impl V1Text {
    pub fn parse(raw: &RawValue) -> Option<Self> {
        // The bytes API also accepts JSON byte arrays; v1 requires a string here.
        if !raw.get().starts_with('"') {
            return None;
        }
        serde_json::from_str(raw.get()).ok().map(Self)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    // Split only at lone surrogates. Every other byte comes from a validated JSON
    // string in a UTF-8 document and can use Rust's standard Unicode operations.
    fn parts(&self) -> impl Iterator<Item = (&str, Option<u16>)> {
        let mut rest = self.0.as_slice();
        std::iter::from_fn(move || {
            if rest.is_empty() {
                return None;
            }
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    rest = &[];
                    Some((valid, None))
                }
                Err(error) => {
                    let (prefix, tail) = rest.split_at(error.valid_up_to());
                    let [0xed, second @ 0xa0..=0xbf, third @ 0x80..=0xbf, remaining @ ..] = tail
                    else {
                        unreachable!("serde_json produced invalid WTF-8")
                    };
                    let surrogate =
                        0xd800 | (u16::from(second & 0x1f) << 6) | u16::from(third & 0x3f);
                    rest = remaining;
                    Some((std::str::from_utf8(prefix).unwrap(), Some(surrogate)))
                }
            }
        })
    }

    pub fn units(&self) -> impl Iterator<Item = u16> + '_ {
        self.parts()
            .flat_map(|(text, lone)| text.encode_utf16().chain(lone))
    }

    pub fn quoted(&self) -> String {
        let mut result = String::from("\"");
        for (text, lone) in self.parts() {
            let quoted = serde_json::to_string(text).expect("a string serializes to JSON");
            result.push_str(&quoted[1..quoted.len() - 1]);
            if let Some(unit) = lone {
                write!(result, "\\u{unit:04x}").unwrap();
            }
        }
        result.push('"');
        result
    }
}

// Match the old CLI's terminal encoding for unquoted diagnostics. Comparisons use
// the preserved bytes or code units, and change reports use the lossless quoted form.
impl fmt::Display for V1Text {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (text, lone) in self.parts() {
            f.write_str(text)?;
            if lone.is_some() {
                f.write_char(char::REPLACEMENT_CHARACTER)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl From<&str> for V1Text {
    fn from(text: &str) -> Self {
        Self(ByteBuf::from(text.as_bytes()))
    }
}
