// Compile the pinned WordNet database into local, word-prefix shards.
// Keep lexical antonyms attached to their actual word and sense.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import wordnet from 'wordnet-db';
const output = 'public/dictionary';
const version = `wordnet-${wordnet.libVersion}-1`;
try { if (JSON.parse(await readFile(`${output}/manifest.json`, 'utf8')).version === version) process.exit(0); } catch { /* First install or changed format. */ }
const categories = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };
const names = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const synsets = new Map();
for (const [file, pos] of Object.entries(categories)) {
  for (const line of (await readFile(`${wordnet.path}/data.${file}`, 'utf8')).split('\n')) {
    if (!/^\d{8} /.test(line)) continue;
    const separator = line.indexOf('|');
    const fields = line.slice(0, separator).trim().split(/\s+/);
    const gloss = line.slice(separator + 1).trim();
    const words = [], pointers = [];
    let cursor = 4;
    for (let i = 0; i < parseInt(fields[3], 16); i++, cursor += 2) words.push(fields[cursor].replace(/\([a-z]+\)$/, '').replaceAll('_', ' '));
    const count = Number(fields[cursor++]);
    for (let i = 0; i < count; i++, cursor += 4) {
      if (fields[cursor] === '!') pointers.push({ id: `${fields[cursor + 2] === 's' ? 'a' : fields[cursor + 2]}${fields[cursor + 1]}`, from: parseInt(fields[cursor + 3].slice(0, 2), 16), to: parseInt(fields[cursor + 3].slice(2), 16) });
    }
    const examples = [...gloss.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    synsets.set(`${pos}${fields[0]}`, { words, pointers, definition: gloss.replace(/;?\s*"[^"]*"/g, '').replace(/;\s*$/, '').trim(), example: examples.join(' · ') || undefined });
  }
}
const shards = new Map();
let words = 0, bytes = 0;
for (const [file, pos] of Object.entries(categories)) {
  for (const line of (await readFile(`${wordnet.path}/index.${file}`, 'utf8')).split('\n')) {
    if (!/^[a-z]/.test(line)) continue;
    const fields = line.trim().split(/\s+/), word = fields[0];
    if (!/^[a-z]+(?:['-][a-z]+)*$/.test(word) || word.length > 64) continue;
    const definitions = fields.slice(6 + Number(fields[3])).map(offset => {
      const sense = synsets.get(`${pos}${offset}`);
      if (!sense) throw new Error(`Missing WordNet sense: ${pos}${offset}`);
      const sourceIndex = sense.words.findIndex(value => value.toLowerCase() === word) + 1;
      const antonyms = sense.pointers.filter(pointer => pointer.from === 0 || pointer.from === sourceIndex).flatMap(pointer => {
        const target = synsets.get(pointer.id);
        if (!target) throw new Error(`Missing WordNet antonym: ${pointer.id}`);
        return pointer.to ? [target.words[pointer.to - 1]] : target.words;
      });
      return { definition: sense.definition, example: sense.example, synonyms: sense.words.filter(value => value.toLowerCase() !== word), antonyms: [...new Set(antonyms)] };
    });
    const prefix = word.slice(0, 2).padEnd(2, '_').replace(/[^a-z]/g, '_');
    if (!shards.has(prefix)) shards.set(prefix, Object.create(null));
    const shard = shards.get(prefix);
    if (!shard[word]) { shard[word] = []; words++; }
    shard[word].push({ partOfSpeech: names[pos], definitions, synonyms: [], antonyms: [] });
  }
}
await mkdir(output, { recursive: true });
for (const [prefix, shard] of shards) {
  const data = JSON.stringify(shard); bytes += Buffer.byteLength(data);
  await writeFile(`${output}/${prefix}.json`, data);
}
await writeFile(`${output}/LICENSE.txt`, await readFile('node_modules/wordnet-db/LICENSE', 'utf8'));
await writeFile(`${output}/manifest.json`, JSON.stringify({ version, prefixes: [...shards.keys()].sort() }));
console.log(`WordNet 3.1: ${words} words, ${shards.size} local shards, ${(bytes / 1048576).toFixed(1)} MiB.`);
