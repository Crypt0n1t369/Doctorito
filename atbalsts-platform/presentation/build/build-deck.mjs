import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const FINAL_PPTX = "/Users/kristaps/Documents/New project/atbalsts-platform/presentation/Atbalsts_government_briefing_LV.pptx";
const PREVIEW_DIR = "/Users/kristaps/Documents/New project/atbalsts-platform/presentation/build/previews";

const W = 1280;
const H = 720;
const FONT = "Helvetica Neue";
const INK = "#102D38";
const MUTED = "#64757C";
const TEAL = "#23675F";
const TEAL_DARK = "#174B46";
const TEAL_SOFT = "#E5F1ED";
const PAPER = "#F3F4EF";
const PANEL = "#ECEFEC";
const LINE = "#C9D1CE";
const AMBER = "#9B6500";
const AMBER_SOFT = "#FFF1CC";
const RED = "#9C3232";
const RED_SOFT = "#F7E7E5";
const BLUE = "#315D7C";
const BLUE_SOFT = "#E8F0F5";
const WHITE = "#FFFFFF";

function addText(slide, text, x, y, w, h, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: options.name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontSize: options.size ?? 20,
    typeface: FONT,
    color: options.color ?? INK,
    bold: options.bold ?? false,
    alignment: options.align ?? "left",
    verticalAlignment: options.valign ?? "top",
    autoFit: options.autoFit ?? "shrinkText",
  };
  return shape;
}

function addRect(slide, x, y, w, h, fill, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? "rect",
    name: options.name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: options.line ?? { style: "solid", fill: "none", width: 0 },
    borderRadius: options.radius,
  });
}

function addRule(slide, x, y, w, color = LINE, width = 1) {
  return slide.shapes.add({
    geometry: "line",
    position: { left: x, top: y, width: w, height: 0 },
    fill: "none",
    line: { style: "solid", fill: color, width },
  });
}

function addBrand(slide, inverse = false) {
  const color = inverse ? WHITE : TEAL;
  addRect(slide, 48, 35, 24, 24, color, { radius: 6 });
  addRect(slide, 54, 45, 12, 4, inverse ? TEAL_DARK : WHITE, { radius: 2 });
  addRect(slide, 58, 41, 4, 12, inverse ? TEAL_DARK : WHITE, { radius: 2 });
  addText(slide, "ATBALSTS", 82, 35, 150, 28, { size: 17, bold: true, color: inverse ? WHITE : INK, valign: "middle" });
}

function addFooter(slide, number, label = "KONCEPCIJA APSPRIEŠANAI") {
  addRule(slide, 48, 672, 1184, LINE, 1);
  addText(slide, label, 48, 680, 360, 20, { size: 12, bold: true, color: MUTED, valign: "middle" });
  addText(slide, String(number).padStart(2, "0"), 1178, 680, 54, 20, { size: 12, bold: true, color: MUTED, align: "right", valign: "middle" });
}

function addSlideTitle(slide, title, number, kicker = "ATBALSTS") {
  addText(slide, kicker, 48, 42, 310, 22, { size: 14, bold: true, color: TEAL, valign: "middle" });
  addText(slide, title, 48, 82, 1160, 112, { size: 46, bold: true, color: INK, valign: "top" });
  addFooter(slide, number);
}

function addNumberedPoint(slide, number, title, body, x, y, w) {
  addText(slide, String(number).padStart(2, "0"), x, y, 54, 36, { size: 23, bold: true, color: TEAL, valign: "middle" });
  addText(slide, title, x + 70, y, w - 70, 36, { size: 24, bold: true, color: INK, valign: "middle" });
  addText(slide, body, x + 70, y + 42, w - 70, 66, { size: 17, color: MUTED });
}

function addSourceNotes(slide, presenter, sources) {
  const lines = [presenter, "", "[Sources]", ...sources.map(source => `- ${source}`), "[/Sources]"];
  slide.speakerNotes.textFrame.setText(lines.join("\n"));
}

function addNode(slide, label, sublabel, x, y, w, h, fill = WHITE, line = LINE) {
  const node = addRect(slide, x, y, w, h, fill, { line: { style: "solid", fill: line, width: 1.3 }, radius: 12 });
  addText(slide, label, x + 16, y + 14, w - 32, 29, { size: 19, bold: true, color: INK, valign: "middle" });
  addText(slide, sublabel, x + 16, y + 48, w - 32, h - 58, { size: 14, color: MUTED });
  return node;
}

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function main() {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  const deck = Presentation.create({ slideSize: { width: W, height: H } });

  // 1 — Cover, adapted from Codex Grid slide 01.
  {
    const slide = deck.slides.add();
    slide.background.fill = PAPER;
    addBrand(slide);
    addText(slide, "PRIEKŠLIKUMS KONTROLĒTAM RĪGAS MĀCĪBU PILOTPROJEKTAM", 48, 92, 780, 28, { size: 16, bold: true, color: TEAL });
    addText(slide, "Iedzīvotāju kapacitāte,\nko var droši koordinēt", 48, 190, 1010, 230, { size: 72, bold: true, color: INK, valign: "bottom" });
    addText(slide, "Atbalsts papildina esošo krīžu vadības struktūru ar izsekojamu, piekrišanā balstītu kopienas koordinācijas slāni.", 48, 484, 820, 92, { size: 24, color: MUTED });
    addRule(slide, 48, 642, 1184, LINE, 1);
    addText(slide, "Koncepcija apspriešanai · 2026", 48, 658, 420, 24, { size: 14, color: MUTED });
    addText(slide, "LATVIJA", 1120, 658, 112, 24, { size: 14, bold: true, color: TEAL, align: "right" });
    addSourceNotes(slide, "Atklājiet ar konkrētu pozicionējumu: šis nav jauns dispečerdienests, bet kontrolēts koordinācijas slānis.", [
      "Atbalsts architecture concept v0.1, 28 Aug 2026 (internal)",
    ]);
  }

  // 2 — Institutional position, adapted from Codex Grid slide 05.
  {
    const slide = deck.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Atbalsts papildina esošo komandstruktūru — tas to neaizvieto", 2, "INSTITUCIONĀLAIS NOVIETOJUMS");
    addRule(slide, 640, 222, 0, LINE, 1);
    addRect(slide, 639, 222, 1, 350, LINE);

    addText(slide, "Esošais pamats", 48, 224, 520, 42, { size: 28, bold: true });
    addText(slide, "Krīzes vadības centrs", 48, 300, 520, 30, { size: 22, bold: true, color: BLUE });
    addText(slide, "Starpinstitucionāla koordinācija, krīzes komunikācija un situācijas monitorings.", 48, 338, 520, 70, { size: 18, color: MUTED });
    addText(slide, "VUGD un pašvaldības", 48, 438, 520, 30, { size: 22, bold: true, color: BLUE });
    addText(slide, "Likumā noteikta glābšanas darbu vadība un tiesības iesaistīt personas un resursus definētā kārtībā.", 48, 476, 520, 82, { size: 18, color: MUTED });

    addText(slide, "Atbalsts risināmais uzdevums", 688, 224, 520, 42, { size: 28, bold: true });
    addText(slide, "Padarīt kopienas kapacitāti atrodamu un iesaistāmu, neatklājot publisku cilvēku vai resursu sarakstu.", 688, 304, 500, 150, { size: 27, bold: true, color: TEAL_DARK });
    addText(slide, "Programmatūra palīdz īstenot pilnvaras; tā pati pilnvaras nerada.", 688, 500, 500, 62, { size: 18, color: MUTED });
    addSourceNotes(slide, "Uzsveriet papildinošo lomu un nepieciešamību kopīgi definēt institucionālo īpašnieku katram uzdevuma veidam.", [
      "https://www.mk.gov.lv/lv/krizes-vadibas-centrs",
      "https://likumi.lv/ta/id/282333-civilas-aizsardzibas-un-katastrofas-parvaldisanas-likums",
    ]);
  }

  // 3 — Citizen interaction.
  {
    const slide = deck.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Iedzīvotāja princips: pasaki, pārbaudi, piekrīti", 3, "MINIMĀLS UX");
    addNumberedPoint(slide, 1, "Pasaki", "Latviski vai angliski, rakstot vai nospiežot un runājot.", 48, 238, 470);
    addNumberedPoint(slide, 2, "Pārbaudi", "Sistēma parāda nozīmi, redzamību, nākamo darbību un termiņu.", 48, 368, 470);
    addNumberedPoint(slide, 3, "Piekrīti", "Nekas netiek piedāvāts vai atklāts cilvēka vārdā bez apstiprinājuma.", 48, 498, 470);

    addRect(slide, 570, 226, 638, 356, PANEL, { radius: 16 });
    addText(slide, "“Man ir busiņš, un brīvdienās varu palīdzēt pārvadāt mantas Rīgā.”", 602, 254, 570, 76, { size: 24, bold: true, color: INK });
    addRule(slide, 602, 346, 570, LINE, 1);
    addText(slide, "KO SISTĒMA SAPRATA", 602, 366, 260, 20, { size: 13, bold: true, color: TEAL });
    addText(slide, "Spēja", 602, 406, 110, 24, { size: 15, bold: true, color: MUTED });
    addText(slide, "Mantu pārvadāšana ar busiņu", 730, 406, 430, 24, { size: 18, bold: true });
    addText(slide, "Robeža", 602, 452, 110, 24, { size: 15, bold: true, color: MUTED });
    addText(slide, "Nav pasažieru vai bīstamu darbu", 730, 452, 430, 24, { size: 18, bold: true });
    addText(slide, "Redzamība", 602, 498, 110, 24, { size: 15, bold: true, color: MUTED });
    addText(slide, "Kopiena redz tikai, ka kapacitāte pastāv", 730, 498, 430, 50, { size: 18, bold: true });
    addSourceNotes(slide, "Demonstrējiet vienu sarunas piemēru. Galvenais ir redzamā kontrole pirms jebkādas darbības.", [
      "Atbalsts conversational UX specification v0.1 (internal)",
      "Atbalsts interactive prototype (internal)",
    ]);
  }

  // 4 — Authority experience.
  {
    const slide = deck.slides.add();
    slide.background.fill = PAPER;
    addSlideTitle(slide, "Koordinators vaicā pēc kapacitātes — nevis pārlūko cilvēku sarakstu", 4, "AUTORITĀTES UX");
    addText(slide, "VAICĀJUMS", 48, 226, 200, 20, { size: 13, bold: true, color: TEAL });
    addRect(slide, 48, 258, 1184, 96, WHITE, { line: { style: "solid", fill: LINE, width: 1 }, radius: 12 });
    addText(slide, "“Parādi transporta kapacitāti ūdens piegādei Āgenskalnā šodien no 16.00 līdz 18.00.”", 74, 279, 1124, 54, { size: 24, bold: true, valign: "middle" });

    addText(slide, "STRUKTURĒTA ATBILDE · ILUSTRATĪVI MĀCĪBU DATI", 48, 396, 520, 20, { size: 13, bold: true, color: TEAL });
    addText(slide, "Transporta kapacitāte ir pieejama", 48, 430, 700, 48, { size: 32, bold: true });
    addText(slide, "5", 48, 510, 90, 58, { size: 48, bold: true, color: TEAL_DARK });
    addText(slide, "atbilstošas personas", 48, 574, 210, 32, { size: 16, color: MUTED });
    addText(slide, "3", 318, 510, 90, 58, { size: 48, bold: true, color: TEAL_DARK });
    addText(slide, "piemēroti transportlīdzekļi", 318, 574, 250, 32, { size: 16, color: MUTED });
    addText(slide, "3", 638, 510, 90, 58, { size: 48, bold: true, color: TEAL_DARK });
    addText(slide, "maksimālais pirmais uzaicinājums", 638, 574, 300, 32, { size: 16, color: MUTED });
    addRect(slide, 970, 430, 238, 156, TEAL_SOFT, { radius: 14 });
    addText(slide, "Identitātes slēptas", 994, 456, 190, 32, { size: 21, bold: true, color: TEAL_DARK });
    addText(slide, "Detaļas atklāj tikai pēc politikas pārbaudes un dalībnieka piekrišanas.", 994, 502, 190, 70, { size: 16, color: TEAL_DARK });
    addSourceNotes(slide, "Skaitļi ir ilustratīvi. Demonstrējiet principu: kapacitātes vaicājums atgriež piemērotību, nevis eksportē cilvēku sarakstu.", [
      "Atbalsts architecture concept v0.1 (internal)",
      "Atbalsts interactive prototype — exercise authority view (internal)",
    ]);
  }

  // 5 — Simple architecture diagram.
  {
    const slide = deck.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "AI interpretē valodu; pilnvaroti cilvēki pieņem lēmumus", 5, "KONTROLES ARHITEKTŪRA");

    const n1 = addNode(slide, "1 · Saruna", "Teksts vai balss\nLV / EN", 48, 250, 210, 128, WHITE);
    const n2 = addNode(slide, "2 · Priekšlikums", "Strukturēts nolūks\nun nenoteiktība", 286, 250, 220, 128, TEAL_SOFT, "#A8C8C1");
    const n3 = addNode(slide, "3 · Politikas vārti", "Loma · risks · piekrišana\n· atklājamie lauki", 534, 250, 232, 128, WHITE);
    const n4 = addNode(slide, "4 · Darbplūsma", "Apstiprinājums · uzdevums\n· nodošana · atcelšana", 794, 250, 220, 128, WHITE);
    const n5 = addNode(slide, "5 · Privāta atlase", "Neliela uzaicinājumu grupa\n· skaidrs atteikums", 1042, 250, 190, 128, WHITE);
    slide.shapes.connect(n1, n2, { kind: "straight", fromSide: "right", toSide: "left", line: { style: "solid", fill: LINE, width: 2 }, tail: { type: "arrow", width: "sm", length: "sm" } });
    slide.shapes.connect(n2, n3, { kind: "straight", fromSide: "right", toSide: "left", line: { style: "solid", fill: LINE, width: 2 }, tail: { type: "arrow", width: "sm", length: "sm" } });
    slide.shapes.connect(n3, n4, { kind: "straight", fromSide: "right", toSide: "left", line: { style: "solid", fill: LINE, width: 2 }, tail: { type: "arrow", width: "sm", length: "sm" } });
    slide.shapes.connect(n4, n5, { kind: "straight", fromSide: "right", toSide: "left", line: { style: "solid", fill: LINE, width: 2 }, tail: { type: "arrow", width: "sm", length: "sm" } });
    [n1, n2, n3, n4, n5].forEach(node => node.bringToFront());

    addRect(slide, 48, 446, 1184, 118, INK, { radius: 12 });
    addText(slide, "Pierādījumu plūsma", 76, 470, 260, 30, { size: 22, bold: true, color: WHITE });
    addText(slide, "ievade → transkripcija → interpretācija → labojums → piekrišana → politikas lēmums → atklāšana → rezultāts", 76, 516, 1100, 30, { size: 18, color: "#C7D4D8" });
    addText(slide, "AI darbības robeža", 286, 398, 220, 24, { size: 14, bold: true, color: TEAL });
    addText(slide, "Determinēta kontrole sākas šeit", 534, 398, 360, 24, { size: 14, bold: true, color: MUTED });
    addSourceNotes(slide, "Nošķiriet elastīgu valodas interpretāciju no determinētas atļauju un stāvokļu kontroles.", [
      "Atbalsts architecture concept v0.1, sections 6–8 (internal)",
    ]);
  }

  // 6 — Safety controls, adapted from Codex Grid slide 09.
  {
    const slide = deck.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "Vispirms mācību režīms; dzīva integrācija tikai pēc pierādījumiem", 6, "DROŠĪBAS ROBEŽA");
    addText(slide, "Autoritātes režīms ir atsevišķa drošības vide ar definētām lomām, termiņiem un jurisdikciju.", 48, 198, 1080, 56, { size: 23, color: MUTED });

    const cols = [48, 450, 852];
    const titles = ["Pilnvaras ir ierobežotas", "Cilvēks saglabā kontroli", "Viss ir rekonstruējams"];
    const bodies = [
      "Institūcija · loma · incidents · darbība · ģeogrāfija · termiņš. Plašiem paziņojumiem un noteiktām darbībām — divu personu apstiprinājums.",
      "Sistēma neuzņemas uzdevumu cilvēka vārdā. Precīza identitāte, atrašanās vieta un resursi tiek atklāti tikai nepieciešamajā posmā.",
      "Katram tulkojumam, politikas lēmumam, uzaicinājumam, piekrišanai, nodošanai un atcelšanai ir pierādījumu pēda.",
    ];
    cols.forEach((x, i) => {
      addRect(slide, x, 300, 354, 246, PANEL, { radius: 10 });
      addText(slide, `0${i + 1}`, x + 24, 324, 48, 28, { size: 18, bold: true, color: TEAL });
      addText(slide, titles[i], x + 24, 370, 304, 58, { size: 24, bold: true });
      addText(slide, bodies[i], x + 24, 442, 304, 84, { size: 16, color: MUTED });
    });
    addText(slide, "Sākotnēji: nav savienojuma ar 112 · nav dzīvas dispečerizācijas · nav nepilngadīgo vai bīstamu uzdevumu", 48, 594, 1140, 32, { size: 17, bold: true, color: RED });
    addSourceNotes(slide, "Augsta riska AI pienākumi nav risināmi ar vienkāršu apzīmējumu “lēmumu atbalsts”; robeža un juridiskais novērtējums jāveido jau pilotprojekta sākumā.", [
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32024R1689",
      "https://www.dvi.gov.lv/lv/jaunums/dviskaidro-NIDA",
      "Atbalsts architecture concept v0.1 (internal)",
    ]);
  }

  // 7 — Pilot timeline, adapted from Codex Grid slide 17.
  {
    const slide = deck.slides.add();
    slide.background.fill = WHITE;
    addSlideTitle(slide, "12 nedēļās pārbaudām modeli, neiejaucoties dzīvajās sistēmās", 7, "IEROSINĀTS RĪGAS PILOTPROJEKTS");
    addRule(slide, 48, 354, 1160, INK, 1.4);
    const xs = [48, 452, 856];
    const phases = [
      ["1.–4. nedēļa", "Kopienas pamats", "25–40 uzaicināti pieaugušie · prasmes un resursi · privātuma priekšskatījums · zema riska pieprasījumi"],
      ["5.–8. nedēļa", "Autoritātes simulators", "Mācību incidents · ierobežotas lomas · uzdevumi · uzaicinājumi · kontrolatzīmes · nodošana un atcelšana"],
      ["9.–12. nedēļa", "Kontrolētas mācības", "LV / EN scenārijs · kļūmju testi · novērotāji · NIDA projekts · audita un drošības pierādījumi"],
    ];
    xs.forEach((x, i) => {
      addRect(slide, x, 346, 16, 16, INK, { geometry: "ellipse" });
      addText(slide, phases[i][0], x, 286, 220, 28, { size: 18, bold: true, color: TEAL });
      addText(slide, phases[i][1], x, 398, 320, 36, { size: 24, bold: true });
      addText(slide, phases[i][2], x, 450, 320, 110, { size: 17, color: MUTED });
    });
    addRect(slide, 48, 594, 1160, 44, TEAL_SOFT, { radius: 8 });
    addText(slide, "Pilotprojekta iznākums ir pierādījumu kopums un institucionāli definēts nākamais lēmums — nevis automātiska ieviešana.", 70, 604, 1116, 24, { size: 17, bold: true, color: TEAL_DARK, valign: "middle" });
    addSourceNotes(slide, "Termiņš un apjoms ir apspriešanai paredzēts priekšlikums. Piedāvājiet sākt bez integrācijas dzīvajās sistēmās.", [
      "Atbalsts proposed development loop and architecture v0.1 (internal)",
    ]);
  }

  // 8 — Evidence gate, adapted from Codex Grid slide 05.
  {
    const slide = deck.slides.add();
    slide.background.fill = PAPER;
    addSlideTitle(slide, "Pilotprojekts virzās tālāk tikai ar pārbaudāmiem pierādījumiem", 8, "IEEJAS UN IZEJAS KRITĒRIJI");
    addText(slide, "Virzīt tālāk, ja", 48, 226, 520, 42, { size: 28, bold: true, color: TEAL_DARK });
    const positive = [
      "LV / EN nolūki tiek interpretēti pareizi un labojami",
      "nav neatļautas identitātes vai resursu atklāšanas",
      "atteikums, klusums un sakaru zudums rada drošu stāvokli",
      "operators var rekonstruēt katru lēmumu un nodošanu",
    ];
    positive.forEach((item, i) => {
      addText(slide, "✓", 48, 294 + i * 72, 28, 28, { size: 20, bold: true, color: TEAL });
      addText(slide, item, 90, 290 + i * 72, 500, 52, { size: 18, color: INK, valign: "middle" });
    });

    addRect(slide, 638, 222, 1, 360, LINE);
    addText(slide, "Apturēt vai pārstrādāt, ja", 688, 226, 520, 42, { size: 28, bold: true, color: RED });
    const negative = [
      "AI min trūkstošus faktus vai apiet apstiprinājumu",
      "autoritatīva un kopienas informācija nav atšķirama",
      "sociālās pazīšanās trūkums ietekmē palīdzības pieejamību",
      "nav skaidra institucionālā īpašnieka vai sistēmas ieraksta",
    ];
    negative.forEach((item, i) => {
      addText(slide, "×", 688, 294 + i * 72, 28, 28, { size: 22, bold: true, color: RED });
      addText(slide, item, 730, 290 + i * 72, 478, 52, { size: 18, color: INK, valign: "middle" });
    });
    addSourceNotes(slide, "Šie ir sākotnējie kvalitātes vārti. Gala kritēriji jāapstiprina pilotprojekta institucionālajiem īpašniekiem.", [
      "Atbalsts architecture concept v0.1, reliability and development loop (internal)",
      "https://www.dvi.gov.lv/lv/jaunums/dviskaidro-NIDA",
    ]);
  }

  // 9 — Decision request, sparse close adapted from Codex Grid slide 01.
  {
    const slide = deck.slides.add();
    slide.background.fill = INK;
    addBrand(slide, true);
    addText(slide, "LĒMUMS, KO LŪDZAM ŠODIEN", 48, 104, 580, 24, { size: 15, bold: true, color: "#8EC5BC" });
    addText(slide, "Viena kontaktpersona.\nViens mācību scenārijs.\nKopīgi drošības kritēriji.", 48, 178, 1030, 246, { size: 58, bold: true, color: WHITE, valign: "middle" });
    addRule(slide, 48, 478, 1184, "#49616A", 1);
    addText(slide, "01", 48, 514, 48, 30, { size: 18, bold: true, color: "#8EC5BC" });
    addText(slide, "Nosaukt institucionālo kontaktpunktu", 110, 512, 300, 48, { size: 18, bold: true, color: WHITE });
    addText(slide, "02", 444, 514, 48, 30, { size: 18, bold: true, color: "#8EC5BC" });
    addText(slide, "Izvēlēties vienu Rīgas mācību scenāriju", 506, 512, 300, 48, { size: 18, bold: true, color: WHITE });
    addText(slide, "03", 838, 514, 48, 30, { size: 18, bold: true, color: "#8EC5BC" });
    addText(slide, "Vienoties par ieejas un izejas kritērijiem", 900, 512, 300, 48, { size: 18, bold: true, color: WHITE });
    addText(slide, "Šajā posmā netiek lūgta integrācija, iepirkums vai dzīva operacionālā saistība.", 48, 636, 980, 28, { size: 16, color: "#B6C5CA" });
    addText(slide, "ATBALSTS", 1120, 636, 112, 28, { size: 14, bold: true, color: "#8EC5BC", align: "right" });
    addSourceNotes(slide, "Noslēdziet ar konkrētu un zema riska lēmumu: kopīgi definēt pilotprojektu, nevis apstiprināt dzīvu ieviešanu.", [
      "Atbalsts pilot proposal v0.1 (internal)",
    ]);
  }

  for (const [index, slide] of deck.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(`${PREVIEW_DIR}/${stem}.png`, await deck.export({ slide, format: "png", scale: 1 }));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(`${PREVIEW_DIR}/${stem}.layout.json`, await layout.text());
  }

  await writeBlob(`${PREVIEW_DIR}/montage.webp`, await deck.export({ format: "webp", montage: true, scale: 1 }));
  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
