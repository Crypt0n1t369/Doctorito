import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "/Users/kristaps/Downloads/Deal offers/Paneli_Template.xlsx";
const outputDir = "/Users/kristaps/Documents/New project/outputs/01a02519-a7e0-7d90-b15a-30a3e222213e";
const outputPath = `${outputDir}/Paneli_Aizpildits_SIG_Solar.xlsx`;
const previewPath = `${outputDir}/Paneli_Aizpildits_SIG_Solar_preview.png`;

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Sheet1");

// Normalize the template's only rich-text cell. Without this targeted rewrite,
// the exporter serializes its 10-point runs as 1000-point text in Excel.
sheet.getRange("A15").values = [[
  "- nojume nelaiž gauri ūdeni lietū (jo ir blīves, vai apakšsegums)",
]];
sheet.getRange("A15:F15").format.rowHeight = 13;

sheet.getRange("B1").values = [["SIA SIG SOLAR LATVIA"]];

sheet.getRange("B5:F10").values = [
  ["kW", 10.08, "OnSolar QNN182-HG-54 420W", 1680, 25],
  ["kW", 12, "Solis S6-EH3P12K02-NV-YD-L", 1748, 10],
  ["kWh", 16, "Dyness PowerBrick Plus", 2500, 10],
  ["gab.", 24, "Cinkota tērauda un alumīnija konstrukcija", 3000, 5],
  ["kompl.", 1, "Kabeļi, zemējums, palīgmateriāli un montāža", 840, 5],
  ["kompl.", 1, "Automātiskais salas režīma slēdzis", 150, null],
];
sheet.getRange("E11").values = [["Jā"]];

sheet.getRange("B24:F29").values = [
  ["kW", 10.08, "OnSolar QNN182-HG-54 420W", 1680, 25],
  ["kW", 12, "Solis S6-EH3P12K02-NV-YD-L", 1750, 10],
  ["kWh", 16, "Dyness PowerBrick Plus", 2500, 10],
  ["gab.", 24, "Jumta metāla konstrukcija", 1920, 5],
  ["kompl.", 1, "Kabeļi, zemējums, palīgmateriāli un montāža", 865, 5],
  ["kompl.", 1, "Automātiskais salas režīma slēdzis", 150, null],
];
sheet.getRange("E30").values = [["Jā"]];

sheet.getRange("E5:E10").format.numberFormat = "#,##0.00";
sheet.getRange("E24:E29").format.numberFormat = "#,##0.00";
sheet.getRange("F5:F10").format.numberFormat = "0";
sheet.getRange("F24:F29").format.numberFormat = "0";
sheet.getRange("C5:C10").format.horizontalAlignment = "center";
sheet.getRange("C24:C29").format.horizontalAlignment = "center";
sheet.getRange("E5:F10").format.horizontalAlignment = "right";
sheet.getRange("E24:F29").format.horizontalAlignment = "right";
sheet.getRange("D5:D10").format.wrapText = true;
sheet.getRange("D24:D29").format.wrapText = true;
sheet.getRange("E11").format.horizontalAlignment = "center";
sheet.getRange("E30").format.horizontalAlignment = "center";

sheet.getRange("B4:B34").format.columnWidth = 11;
sheet.getRange("C4:C34").format.columnWidth = 11;
sheet.getRange("D4:D34").format.columnWidth = 34;
sheet.getRange("E4:E34").format.columnWidth = 17;
sheet.getRange("F4:F34").format.columnWidth = 16;
sheet.getRange("A5:F10").format.rowHeight = 30;
sheet.getRange("A24:F29").format.rowHeight = 30;

const rigaCheck = await workbook.inspect({
  kind: "table",
  range: "Sheet1!A1:F16",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
  maxChars: 12000,
});
console.log("RIGA_CHECK");
console.log(rigaCheck.ndjson);

const neretaCheck = await workbook.inspect({
  kind: "table",
  range: "Sheet1!A22:F34",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
  maxChars: 12000,
});
console.log("NERETA_CHECK");
console.log(neretaCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log("ERROR_SCAN");
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({
  sheetName: "Sheet1",
  range: "A1:F34",
  scale: 2,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT ${outputPath}`);
console.log(`PREVIEW ${previewPath}`);
