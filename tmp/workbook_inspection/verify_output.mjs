import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const outputPath = "/Users/kristaps/Documents/New project/outputs/01a02519-a7e0-7d90-b15a-30a3e222213e/Paneli_Aizpildits_SIG_Solar.xlsx";
const input = await FileBlob.load(outputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const check = await workbook.inspect({
  kind: "table",
  range: "Sheet1!A1:F34",
  include: "values,formulas",
  tableMaxRows: 40,
  tableMaxCols: 8,
  maxChars: 20000,
});
console.log("FINAL_CONTENT_CHECK");
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "reopened workbook error scan",
});
console.log("FINAL_ERROR_SCAN");
console.log(errors.ndjson);
