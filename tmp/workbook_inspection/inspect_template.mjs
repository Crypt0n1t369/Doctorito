import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "/Users/kristaps/Downloads/Deal offers/Paneli_Template.xlsx";
const previewDir = "/Users/kristaps/Documents/New project/tmp/workbook_inspection";

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const sheetInfo = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 5000,
});
console.log("SHEETS");
console.log(sheetInfo.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  console.log(`USED_RANGE ${sheet.name} ${used?.address ?? "(none)"}`);

  const region = await workbook.inspect({
    kind: "region",
    sheetId: sheet.name,
    range: used?.address ?? "A1:Z50",
    include: "values,formulas",
    maxChars: 15000,
    tableMaxRows: 100,
    tableMaxCols: 30,
    tableMaxCellChars: 200,
  });
  console.log(`REGION ${sheet.name}`);
  console.log(region.ndjson);

  const styles = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheet.name,
    range: used?.address ?? "A1:Z50",
    maxChars: 10000,
  });
  console.log(`STYLES ${sheet.name}`);
  console.log(styles.ndjson);

  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 2,
    format: "png",
  });
  const safeName = sheet.name.replaceAll(/[^A-Za-z0-9_-]/g, "_");
  await fs.writeFile(
    `${previewDir}/template_${safeName}.png`,
    new Uint8Array(await preview.arrayBuffer()),
  );
}
