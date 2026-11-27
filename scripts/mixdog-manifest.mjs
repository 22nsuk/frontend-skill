import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const folder = process.argv[2];
const frontmatterPattern = /^(?:\uFEFF)?---[ \t]*(\r?\n)([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function loadYaml() {
  const expected = require('../package-lock.json').packages['node_modules/yaml'].version;
  try {
    if (require('../node_modules/yaml/package.json').version === expected) return require('../node_modules/yaml');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  throw new Error(`Packaging requires yaml@${expected}. Run npm ci in the repository root.`);
}

function parseFrontmatter(yaml, header) {
  const lines = new yaml.LineCounter();
  const document = yaml.parseDocument(header, { lineCounter: lines, prettyErrors: false, strict: true, uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid SKILL.md frontmatter: ${document.errors[0].message}`);
  if (!yaml.isMap(document.contents) || document.contents.flow) {
    throw new Error('SKILL.md frontmatter must be a YAML block mapping');
  }
  const indent = lines.linePos(document.contents.range[0]).col - 1;
  return { fields: document.toJS({ maxAliasCount: 100 }), indent };
}

function generate(source, trigger, yaml) {
  const match = frontmatterPattern.exec(source);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter closed by a --- line');
  const [, newline, header] = match;
  const { fields, indent } = parseFrontmatter(yaml, header);
  if (Object.hasOwn(fields, 'when_to_use')) {
    throw new Error(`Remove when_to_use from skills/${folder}/SKILL.md; the package sets it from TRIGGER in scripts/package-mixdog.py`);
  }
  const added = `${' '.repeat(indent)}when_to_use: ${JSON.stringify(trigger)}${newline}`;
  // Check the header as the host will read it, including the inserted line.
  const packaged = parseFrontmatter(yaml, added + header).fields;
  if (typeof packaged.name !== 'string' || packaged.name.trim() !== folder) {
    throw new Error(`SKILL.md name must match the packaged folder: ${folder}`);
  }
  const { description, when_to_use: listing } = packaged;
  if (typeof description !== 'string' || !description.trim() || description.trim().length > 1024 || /[<>]/.test(description)) {
    throw new Error('SKILL.md description must be a nonempty string of at most 1024 UTF-16 code units without angle brackets');
  }
  if (typeof listing !== 'string' || !listing.trim() || listing.trim().length > 60 || /[<>]/.test(listing)) {
    throw new Error('TRIGGER must have 1-60 UTF-16 code units and no angle brackets');
  }
  const start = source.indexOf('\n') + 1;
  return source.slice(0, start) + added + source.slice(start);
}

try {
  const input = readFileSync(0);
  const separator = input.indexOf(0x0a);
  const trigger = JSON.parse(input.toString('ascii', 0, separator));
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.subarray(separator + 1));
  process.stdout.write(generate(source, trigger, loadYaml()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
