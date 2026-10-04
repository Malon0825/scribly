import fs from 'node:fs';
for (const name of ['selection-colors', 'ux-critique', 'permanent-delete']) {
  let source = fs.readFileSync(`tests/${name}.spec.ts`, 'utf8');
  source = source.replaceAll('getByRole("button", { name: "Selection colors", exact: true', 'getByRole("button", { name: "Text and background color options", exact: true')
    .replaceAll("name: 'Draw pen', exact: true", "name: 'Start drawing', exact: true")
    .replaceAll('Drawing · Freehand', 'Drawing · Free')
    .replaceAll('does not confirm the file was saved', 'Check Downloads to confirm the file was saved.')
    .replaceAll("'./themeHelper'", "'../tests/themeHelper'");
  fs.writeFileSync(`audit/corrected-${name}.spec.ts`, source);
}
