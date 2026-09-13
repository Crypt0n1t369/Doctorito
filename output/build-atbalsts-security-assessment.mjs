import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const previousPath = path.join(outputDir, "atbalsts-kiberdrosibas-kopsavilkums-lv-artifact.json");
const outputPath = path.join(
  outputDir,
  "atbalsts-kiberdrosibas-novertejums-prezentacijai-lv-artifact.json",
);
const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));

const generatedAt = "2026-09-10T19:09:29+03:00";
const commit = "5abbb5ebb683e49b309785db6f33db316afaedd5";
const baseCommit = "6636f6fae01bba5a4a9697c196638b7f0ee84ea9";
const repoTree = `https://github.com/goofis11/palidzi/tree/${commit}`;
const prUrl = "https://github.com/goofis11/palidzi/pull/73";
const ciUrl = "https://github.com/goofis11/palidzi/actions/runs/34499895675";

const q = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
};

function materializationSql(dataset, rows, fields, orderBy) {
  const columns = fields.map((field) => `"${field}"`).join(", ");
  const values = rows.map((row) => `    (${fields.map((field) => q(row[field])).join(", ")})`).join(",\n");
  return `WITH "${dataset}"(${columns}) AS (\n  VALUES\n${values}\n)\nSELECT ${columns}\nFROM "${dataset}"\nORDER BY "${orderBy}" ASC`;
}

const controls = [
  {
    seciba: "01",
    kontrole: "Produkcijas glabātuve un identitātes konfigurācija atsakās darboties nedrošā režīmā",
    statuss: "Ieviests Worker kodā; Worker nav publiskās vides izcelsme",
    pieradijums: "Worker bez noturīgas glabātuves atgriež 503; neatpazīts AUTH_PROVIDER nepiešķir izstrādes identitāti.",
    atlikums: "Kontrole jāpārbauda izvēlētajā produkcijas izpildvidē; pašreiz domēnu apkalpo lokāls process aiz tuneļa.",
  },
  {
    seciba: "02",
    kontrole: "Droši sesiju sīkfaili un tās pašas izcelsmes pārbaudes mutējošiem pieprasījumiem",
    statuss: "Ieviests galvenajā zarā",
    pieradijums: "HttpOnly/Secure/SameSite sīkfaili un servera izcelsmes pārbaudes.",
    atlikums: "Nav centrālas sesiju atsaukšanas un pilna ierīču pārvaldības procesa.",
  },
  {
    seciba: "03",
    kontrole: "Ārkārtas atbilde tiek pabeigta pirms MI maršrutēšanas",
    statuss: "Ieviests un pārbaudīts",
    pieradijums: "Determinētais drošības lēmums pārtrauc HTTP ceļu pirms ārējā modeļa izsaukuma abās valodās.",
    atlikums: "Jāturpina regresijas pārbaudes, mainot sarunas loģiku.",
  },
  {
    seciba: "04",
    kontrole: "Ārējo tekstu sanitizācija, shēmu un ticamības robežu pārbaudes",
    statuss: "Daļēji ieviests",
    pieradijums: "Drošā teksta palīgs un vairāku ārējo avotu normalizācija/plauzibilitātes pārbaudes.",
    atlikums: "Normalizācija vēl nav vienādi piemērota visām ievades un glabāšanas vietām.",
  },
  {
    seciba: "05",
    kontrole: "Brīvprātīgo saraksti minimizē kontaktinformāciju; detalizēta apskate tiek auditēta",
    statuss: "Ieviests galvenajā zarā",
    pieradijums: "Masveida sarakstā nav tālruņa, e-pasta, pilnas adreses vai precīzu koordinātu.",
    atlikums: "Audits nav pret manipulācijām drošā, atsevišķā uzticamības zonā.",
  },
  {
    seciba: "06",
    kontrole: "Faili ir privāti, piesaistīti īpašniekam un ierobežoti pēc izmēra un tipa",
    statuss: "Ieviests pamata līmenī",
    pieradijums: "Īpašnieka pārbaudes, MIME un izmēra limiti.",
    atlikums: "Nav ļaunprogrammatūras skenēšanas, satura dekodēšanas un karantīnas.",
  },
  {
    seciba: "07",
    kontrole: "Bezsaistes kešatmiņai ir publisks atļauto resursu saraksts",
    statuss: "Ieviests un pārbaudīts",
    pieradijums: "API, privātās lapas un vaicājumu URL netiek glabāti kopīgajā bezsaistes kešatmiņā.",
    atlikums: "Jāpabeidz pakotnes pilnīguma un versiju aktivizācijas pārbaude.",
  },
  {
    seciba: "08",
    kontrole: "Situācijas publicēšana un atsaukšana ir atomāra, versēta un idempotenta",
    statuss: "Ieviests galvenajā zarā",
    pieradijums: "Notikums, audits un outbox ieraksts tiek komitēti vienā komandā; novecojis labojums saņem 409.",
    atlikums: "Līdzvērtīgs transakciju modelis vēl jāattiecina uz misijām un ziņojumu lēmumiem.",
  },
  {
    seciba: "09",
    kontrole: "MI ir marķēts un tam nav tiešu publicēšanas vai cilvēku nosūtīšanas tiesību",
    statuss: "Ieviesta produkta robeža",
    pieradijums: "MI sagatavo ieteikumus; publicēšanu veic cilvēks un avota dati paliek redzami.",
    atlikums: "Jānostiprina neuzticamas ievades izolācija, zemējums un pakalpojuma izslēgšanas režīms.",
  },
  {
    seciba: "10",
    kontrole: "Maksas datu avotiem ir autentifikācijas un budžeta vārti",
    statuss: "Ieviests galvenajā zarā",
    pieradijums: "Anonīms pieprasījums neizraisa maksas atsvaidzināšanu; cron pārtrūkst bez noturīgas glabātuves.",
    atlikums: "Jāpievieno centrāla ļaunprātīgas izmantošanas telemetrija un brīdinājumi.",
  },
  {
    seciba: "11",
    kontrole: "Mācību dati ir vizuāli atšķirami un centralizēti izslēdzami/notīrāmi",
    statuss: "Ieviests galvenajā zarā",
    pieradijums: "Simulācijas marķējums, sēklas slēdzis un demonstrācijas datu notīrīšanas darbība.",
    atlikums: "Vajadzīga rakstiska pārejas kārtība no mācībām uz reālu lietojumu.",
  },
  {
    seciba: "12",
    kontrole: "Publiskajam notikumu API ir skaidri atļauto lauku DTO",
    statuss: "Ieviests PR #73; nav izvietots",
    pieradijums: "Operatora identitāte, iekšējais statuss, veidne un iekšējie laika lauki vairs nav publiskajā projekcijā.",
    atlikums: "Jāapvieno PR un jāpārbauda anonīmā produkcijas atbilde.",
  },
  {
    seciba: "13",
    kontrole: "Publiskā veselības pārbaude ir minimāla; pilnā diagnostika ir aiz Centra sesijas",
    statuss: "Ieviests PR #73; nav izvietots",
    pieradijums: "Anonīmi paredzēti tikai ok un būvējuma SHA; topoloģija, identitātes un MI stāvoklis pārvietots uz /api/center/health.",
    atlikums: "Pašreizējā produkcija vēl rāda iepriekšējo, plašāko atbildi.",
  },
  {
    seciba: "14",
    kontrole: "Izlaiduma vārti: tipi, lint, 32 pārbaudes, build, kritiskas produkcijas atkarības un noslēpumu paraugi",
    statuss: "Ieviests PR #73; CI iziet",
    pieradijums: "GitHub Actions izpilde 34499895675 komitam 5abbb5e pabeigta sekmīgi.",
    atlikums: "Statusa pārbaude kļūst obligāta tikai pēc galvenā zara aizsardzības ieslēgšanas.",
  },
  {
    seciba: "15",
    kontrole: "Dependabot un CODEOWNERS repozitorija konfigurācija",
    statuss: "Ieviests PR #73; administratīvā izpilde gaida",
    pieradijums: "Iknedēļas npm, ikmēneša Actions atjauninājumi un īpašnieks sensitīvajām koda zonām.",
    atlikums: "Branch protection, Dependabot alerts, secret scanning un push protection prasa administratoru/plānu.",
  },
  {
    seciba: "16",
    kontrole: "Worker izvēršana ir nošķirta no pašreizējās tuneļa vides izlaiduma",
    statuss: "Ieviests PR #73; CI iziet",
    pieradijums: "Worker izvēršanas darbplūsma ir tikai manuāla, prasa nepārprotamu pārslēgšanas apstiprinājumu un darbojas tikai no main.",
    atlikums: "Faktiskajam lokālajam izcelsmes serverim vēl vajag dokumentētu, uzraudzītu precīza SHA izvēršanu; Worker maršrutu drīkst piesaistīt tikai pēc pārbaudes pirmsražošanas vidē.",
  },
];

const softwareVectors = [
  {
    seciba: "01",
    id: "S1",
    vektors: "Publiskā API skrāpēšana un iekšējo metadatu izguve",
    pasreizeja_kontrole: "PR #73 ievieš atļauto lauku DTO un minimālu veselības pārbaudi.",
    atlikusais_risks: "Labojums vēl nav produkcijā; citi publiskie DTO jāpārskata pēc tā paša principa.",
    nakamais_varts: "Apvienot, izvērst konkrētu SHA un pārbaudīt anonīmās atbildes.",
    termins: "Pirms prezentācijas",
  },
  {
    seciba: "02",
    id: "S2",
    vektors: "Izkliedēts brutāls spēks, API plūdi un izmaksu izsmelšana",
    pasreizeja_kontrole: "Lietotnes maršrutu limiti un maksas avotu budžeta vārti.",
    atlikusais_risks: "Vairāki limiti ir procesa lokāli, nav kopīgi starp instancēm un neaizstāj domēna zonas līmeņa aizsardzību; pielāgoti WAF un pieprasījumu biežuma noteikumi nav ieviesti.",
    nakamais_varts: "Domēna zonas īpašnieks: R1 modeļu API un R3 pieteikšanās perimetra limiti vispirms Managed Challenge režīmā, pēc tam Security Events pārbaude.",
    termins: "Pirms prezentācijas",
  },
  {
    seciba: "03",
    id: "S3",
    vektors: "Izvietojuma izcelsmes sajaukšana un demonstrācijas priekšskatījuma izpildvide",
    pasreizeja_kontrole: "PR #73 dokumentē publiskās vides topoloģiju un neļauj automātisku Worker izvēršanu kļūdaini uzskatīt par publiskās vides izlaidumu; CI pārbauda izmaiņas.",
    atlikusais_risks: "Publiskais domēns iet caur tuneli uz lokālu Vite priekšskatījuma procesu; /api/health rāda build unknown, un nav pierādīta uzraudzīta precīza SHA izvēršana vai automātiska atjaunošana.",
    nakamais_varts: "Pirms prezentācijas faktiskajā tuneļa izcelsmes serverī izvērst precīzu apstiprinātā main SHA, iestatīt būvējuma identitāti, uzraudzīt procesu un pārbaudīt atgriešanos iepriekšējā versijā; Worker maršrutu nemainīt.",
    termins: "Pirms prezentācijas",
  },
  {
    seciba: "04",
    id: "S4",
    vektors: "Sesijas zādzība un atkārtota izmantošana",
    pasreizeja_kontrole: "Droši sīkfailu atribūti, izcelsmes pārbaudes un servera sesija.",
    atlikusais_risks: "Nav tūlītējas visu sesiju atsaukšanas, ierīču saraksta un piespiedu atkārtotas autentifikācijas.",
    nakamais_varts: "Individuāla identitāte, MFA un centrāla sesiju atsaukšana.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "05",
    id: "S5",
    vektors: "Promptu injekcija un lēmumu datu saindēšana",
    pasreizeja_kontrole: "MI nevar publicēt; ārkārtas atbilde ir determinēta; daļa teksta tiek sanitizēta.",
    atlikusais_risks: "Neuzticams brīvais teksts un sociālo avotu saturs vēl var ietekmēt MI kontekstu un operatoru.",
    nakamais_varts: "Strukturēta starpslāņa shēma, avotu/citātu vārti, riskantu instrukciju atmešana un red-team testi.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "06",
    id: "S6",
    vektors: "Ļaunprātīgs vai aktīvs augšupielādēts fails",
    pasreizeja_kontrole: "Privāta glabātuve, īpašnieka pārbaude, izmēra un deklarētā tipa ierobežojumi.",
    atlikusais_risks: "Nav faila satura skenēšanas, karantīnas un drošas attēlu pārkodēšanas.",
    nakamais_varts: "Karantīna, ļaunprogrammatūras skeneris, servera noteikts tips un droša pārkodēšana.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "07",
    id: "S7",
    vektors: "Misiju tiesību apiešana vai nedroša cilvēku nosūtīšana",
    pasreizeja_kontrole: "Publicēšanai ir cilvēka apstiprinājums un versiju/idempotences kontrole.",
    atlikusais_risks: "Misijām nav pilnu bīstamības, kompetenču, vecāka notikuma aktualitātes un divpakāpju apstiprināšanas vārtu.",
    nakamais_varts: "Atsevišķs misiju stāvokļu automāts un obligāti drošības/kompetenču apliecinājumi.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "08",
    id: "S8",
    vektors: "Ārējā avota kompromitēšana, novecojuši vai maldinoši dati",
    pasreizeja_kontrole: "Normalizācija, sanitizācija, avota saite un vairāku lauku ticamības robežas.",
    atlikusais_risks: "Nav pilnas savienotāju izolācijas, visaptverošas svaiguma politikas un parakstītas izcelsmes.",
    nakamais_varts: "Atsevišķi savienotāji, karantīna, svaiguma SLA un avota veselības brīdinājumi.",
    termins: "31–90 dienas",
  },
  {
    seciba: "09",
    id: "S9",
    vektors: "Pārāk plaša Supabase servisa loma, sānu kustība un audita labošana",
    pasreizeja_kontrole: "Servera atslēga nav klientā; sensitīvas darbības tiek auditētas; publicēšana ir atomāra.",
    atlikusais_risks: "Viena privileģēta loma un viena uzticamības zona aptver vairākus datu veidus; audits ir maināms/ierobežots.",
    nakamais_varts: "Minimālu tiesību lomas, atsevišķas glabātuves un tikai papildināms, ārēji pārbaudāms audits.",
    termins: "31–90 dienas",
  },
  {
    seciba: "10",
    id: "S10",
    vektors: "Atkarību un būvēšanas ķēdes ievainojamības",
    pasreizeja_kontrole: "Fiksēts lock fails, CI build/probes, kritisku produkcijas paziņojumu vārti un Dependabot konfigurācija.",
    atlikusais_risks: "Bāzes auditā paliek 6 augsti un 3 vidēji paziņojumi; sasniedzamība nav pilnībā klasificēta.",
    nakamais_varts: "Regulāri atjauninājumi, sasniedzamības lēmums, SBOM un terminēti riska izņēmumi.",
    termins: "Pastāvīgi",
  },
];

const humanVectors = [
  {
    seciba: "01",
    id: "H1",
    vektors: "Mācību un reālās vides sajaukšana",
    pasreizeja_kontrole: "Simulācijas marķējums, demonstrācijas sēklas slēdzis un notīrīšanas funkcija.",
    atlikusais_risks: "Nepareizs prezentācijas formulējums var radīt iespaidu par operatīvu vai sertificētu sistēmu.",
    nakamais_varts: "Katrai demonstrācijai nosaukt vidi, datu veidu un to, kas vēl nav produkcijas kontrole.",
    termins: "Pirms prezentācijas",
  },
  {
    seciba: "02",
    id: "H2",
    vektors: "Mērķēta pikšķerēšana pret izstrādātāju vai operatoru",
    pasreizeja_kontrole: "Noslēpumi netiek glabāti repozitorijā; CI meklē akreditācijas datu paraugus.",
    atlikusais_risks: "Nav pierādījumu par organizācijas MFA/FIDO2, drošības apmācību un pikšķerēšanas ziņošanas procesu.",
    nakamais_varts: "MFA/FIDO2 administratīvajiem kontiem, apmācība un ātrs ārpusjoslas ziņošanas kanāls.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "03",
    id: "H3",
    vektors: "Kopīgas paroles izmantošana un darbību neattiecināmība",
    pasreizeja_kontrole: "Demonstrācijai kopīgā parole ir apzināti akceptēta; sistēma jau atbalsta operatoru sarakstu.",
    atlikusais_risks: "Kopīgā parole nepierāda, kurš cilvēks veica darbību, un tās noplūde skar visus.",
    nakamais_varts: "Pirms īsta pilota — individuāli konti, MFA un tūlītēja piekļuves/sesiju atsaukšana.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "04",
    id: "H4",
    vektors: "Nozaudēta ierīce vai neaizvērta operatora sesija",
    pasreizeja_kontrole: "HttpOnly/Secure sīkfails un servera sesijas pārbaude.",
    atlikusais_risks: "Nav ierīču uzskaites, attālinātas izrakstīšanas un riska gadījumā saīsinātas sesijas.",
    nakamais_varts: "Sesiju konsole, tūlītēja atsaukšana, atkārtota autentifikācija sensitīvām darbībām.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "05",
    id: "H5",
    vektors: "Privātuma kļūda: pārlieka ievākšana, nepareizs saņēmējs vai manuāls eksports",
    pasreizeja_kontrole: "Masveida kontaktu saraksti ir minimizēti un individuāla apskate tiek auditēta.",
    atlikusais_risks: "Nav pilna glabāšanas/dzēšanas, datu subjektu tiesību un personāla apmācības procesa.",
    nakamais_varts: "Datu karte, NIDA, lomu piekļuve, dzēšanas termiņi un praktiska apmācība.",
    termins: "Pirms personas datu pilota",
  },
  {
    seciba: "06",
    id: "H6",
    vektors: "Iekšēja ļaunprātība, piespiešana, lomu pieaugums vai nepabeigta darbinieka aiziešana",
    pasreizeja_kontrole: "Daļa sensitīvo lasījumu un lēmumu tiek auditēta.",
    atlikusais_risks: "Nav pilna RBAC, periodiskas piekļuves pārskatīšanas, offboarding SLA un pret manipulācijām droša audita.",
    nakamais_varts: "Minimālas lomas, ceturkšņa pārskati, divu cilvēku kontrole augstas ietekmes darbībām.",
    termins: "31–90 dienas",
  },
  {
    seciba: "07",
    id: "H7",
    vektors: "Atbalsta dienesta, piegādātāja vai amatpersonas uzdošanās",
    pasreizeja_kontrole: "Cloudflare nodošanas promptā ir aizliegts atklāt noslēpumu vērtības un prasīts izmaiņu žurnāls.",
    atlikusais_risks: "Nav formālas ārpusjoslas identitātes pārbaudes un steidzamu izmaiņu apstiprināšanas kārtības.",
    nakamais_varts: "Divkanālu verifikācija, divu personu apstiprinājums un iepriekš definēts piegādātāju kontaktu saraksts.",
    termins: "31–90 dienas",
  },
  {
    seciba: "08",
    id: "H8",
    vektors: "Trešās puses konta kompromitēšana",
    pasreizeja_kontrole: "Pakalpojumu atslēgas ir servera pusē; deploy tokenam paredzētas minimālas tiesības.",
    atlikusais_risks: "Nav vienotas rotācijas, piegādātāju incidentu un avārijas atslēgšanas spēles kārtības.",
    nakamais_varts: "Atslēgu reģistrs, īpašnieki, rotācijas termiņi un pakalpojuma izslēgšanas runbook.",
    termins: "31–90 dienas",
  },
  {
    seciba: "09",
    id: "H9",
    vektors: "Krīzes stress, nogurums, baumas un apstiprinājuma kļūdas",
    pasreizeja_kontrole: "Avotu saites, nezināmā lauki, verifikācijas rinda, cilvēka apstiprinājums un MI marķējums.",
    atlikusais_risks: "Nav divu cilvēku principa kritiskām publikācijām, paaugstināta apdraudējuma režīma un regulāru mācību.",
    nakamais_varts: "Kontrolsaraksti, četru acu princips, lomu maiņa, mācības un dezinformācijas eskalācijas ceļš.",
    termins: "Pastāvīgi",
  },
  {
    seciba: "10",
    id: "H10",
    vektors: "Incidenta vai platformas atteices koordinācijas sabrukums",
    pasreizeja_kontrole: "Sistēma atsakās darboties bez noturīgas glabātuves; publiskais saturs var būt pieejams bezsaistē.",
    atlikusais_risks: "Nav pierādītu atjaunošanas testu, atbildību matricas un neatkarīga sakaru kanāla.",
    nakamais_varts: "Incidentu runbook, RTO/RPO lēmums, atjaunošanas un galda mācības, ārpusplatformas saziņa.",
    termins: "Pastāvīgi",
  },
];

const attackSummary = [
  { seciba: "01", termins: "Pirms prezentācijas", veids: "Programmatūra", skaits: 3 },
  { seciba: "02", termins: "Pirms prezentācijas", veids: "Cilvēki un process", skaits: 1 },
  { seciba: "03", termins: "Pirms personas datu pilota", veids: "Programmatūra", skaits: 4 },
  { seciba: "04", termins: "Pirms personas datu pilota", veids: "Cilvēki un process", skaits: 4 },
  { seciba: "05", termins: "31–90 dienas", veids: "Programmatūra", skaits: 2 },
  { seciba: "06", termins: "31–90 dienas", veids: "Cilvēki un process", skaits: 3 },
  { seciba: "07", termins: "Pastāvīgi", veids: "Programmatūra", skaits: 1 },
  { seciba: "08", termins: "Pastāvīgi", veids: "Cilvēki un process", skaits: 2 },
];

const meetingStages = [
  {
    seciba: "01",
    posms: "Marķēta demonstrācija",
    ko_var_apgalvot: "Drošības pamati ir projektēti un pārbaudīti kodā; dati un lomas ir demonstrācijas režīmā.",
    obligatie_varti: "PR #73, zaļš CI, precīzs main SHA faktiskajā tuneļa izcelsmes serverī, uzraudzīts process un atgriešanās plāns, minimāls publiskais API; perimetra noteikumi vai dokumentēti kompensējoši lietotnes limiti.",
    apzinata_robeza: "Kopīgā Centra parole, sintētiski dati un Vite priekšskatījuma serveris ir pieļaujami tikai skaidri marķētā demonstrācijā, nevis produkcijas gatavības apgalvojumā.",
  },
  {
    seciba: "02",
    posms: "Publiska gatavības sadaļa / tikai lasāma karte",
    ko_var_apgalvot: "Atsevišķs zema riska produkts bez operatoru pilnvarām un personas datu ievades.",
    obligatie_varti: "Atsevišķs izvietojums, versēts publiskais DTO, satura izcelsme, kešatmiņas un pieejamības kontrole.",
    apzinata_robeza: "Nav automātiskas ārējo ziņu publicēšanas un nav vadības centra atslēgu publiskajā servisā.",
  },
  {
    seciba: "03",
    posms: "Kontrolēts personas datu pilots",
    ko_var_apgalvot: "Iedzīvotāju ziņojumi un operatoru darbs notiek ar definētu nolūku, lomām un auditu.",
    obligatie_varti: "NIDA/datu dzīves cikls, individuāla identitāte un MFA, sesiju atsaukšana, centrāli limiti, failu karantīna, atjaunošanas tests.",
    apzinata_robeza: "MI paliek padomdevējs un nekas no neuzticamas ievades netiek publicēts bez cilvēka lēmuma.",
  },
  {
    seciba: "04",
    posms: "Operatīvs vai iepirkumiem gatavs pakalpojums",
    ko_var_apgalvot: "Kontroles ir ne tikai kodā, bet pierādītas ar procesiem, žurnāliem, mācībām un neatkarīgu testu.",
    obligatie_varti: "Reāla segmentācija un minimālas lomas, pret manipulācijām drošs audits, IR/BCP mācības, juridiskās piemērojamības lēmumi, pentests.",
    apzinata_robeza: "Atbilstību un ISO sertifikāciju drīkst apgalvot tikai tad, kad ir attiecīgais audits/pierādījums.",
  },
  {
    seciba: "05",
    posms: "Brīvprātīgo nosūtīšana augstas ietekmes situācijās",
    ko_var_apgalvot: "Atsevišķs paaugstinātas ietekmes modulis ar skaidru pienākumu rūpēties par cilvēkiem.",
    obligatie_varti: "Bīstamības un kompetenču vārti, četru acu princips, aktuāls vecāka notikums, piekrišana, atsaukšana un drošības instrukcijas.",
    apzinata_robeza: "Šo funkciju droši izolēt vai neizlaist, kamēr vārti nav pabeigti.",
  },
];

const products = previous.snapshot.datasets.produktu_robezas;
const compliance = previous.snapshot.datasets.atbilstibas_minimums;
const dependencyRisks = previous.snapshot.datasets.atkaribu_riski;

const roadmap = [
  {
    posms: "0",
    termins: "Gatavs PR #73",
    merkis: "Aizvērt publiskās informācijas un repozitorija pamatspraugas",
    darbi: "Atļauto lauku publiskais DTO; minimāla /api/health atbilde; aizsargāta detalizētā diagnostika; Dependabot, CODEOWNERS, kritisku produkcijas atkarību CI vārti, paplašināta noslēpumu pārbaude; publiskās izcelsmes dokumentācija un manuāls Worker pārslēgšanas vārts.",
    pabeigsanas_kriterijs: "CI 34499895675 komitam 5abbb5e iziet; labojumi ir PR, bet vēl nav apvienoti vai izvietoti faktiskajā izcelsmes serverī.",
  },
  {
    posms: "1",
    termins: "Pirms prezentācijas",
    merkis: "Parādīt pārbaudāmu, ierobežotu demonstrācijas vidi",
    darbi: "Apvienot PR; faktiskā lokālā izcelsmes servera īpašnieks izvērš precīzu main SHA, iestata ATBALSTS_BUILD_SHA, palaiž lietotni un cloudflared uzraudzītā režīmā, veic pamatfunkciju un atgriešanās pārbaudi. Domēna zonas īpašnieks, kad pieejamas tiesības, ievieš prioritāros R1/R3 perimetra limitus. Worker maršrutu šajā posmā nepiesaistīt. GitHub administrators ieslēdz galvenā zara aizsardzību, ja plāns to ļauj.",
    pabeigsanas_kriterijs: "Publiskais /api/health rāda paredzēto SHA un tikai minimālos laukus; anonīmajā notikumu API nav iekšējo lauku; process pēc restartēšanas atjaunojas; ir izmēģināta atgriešanās iepriekšējā versijā un dokumentēts perimetra darbu īpašnieks/termiņš.",
  },
  {
    posms: "2",
    termins: "0–30 dienas / pirms personas datu pilota",
    merkis: "Ieviest identitātes, datu un atjaunošanas minimumu",
    darbi: "Aizstāt Vite priekšskatījuma serveri ar atbalstītu, uzraudzītu produkcijas izpildvidi vai pirmsražošanas vidē pabeigt un pārbaudīt Worker migrāciju; datu karte, NIDA, nolūku/tiesiskā pamata un glabāšanas lēmumi; individuāli konti, MFA un sesiju atsaukšana; centrāla ļaunprātīgas izmantošanas kontrole; atkarību sasniedzamība/SBOM; rezerves kopiju atjaunošana un incidentu rīcības plāns.",
    pabeigsanas_kriterijs: "Katram sensitīvam laukam ir nolūks/termiņš; īpašnieks spēj atsaukt piekļuvi, atjaunot datus un vadīt incidentu.",
  },
  {
    posms: "3",
    termins: "31–90 dienas",
    merkis: "Izveidot īstas produktu un uzticamības robežas",
    darbi: "Nodalīt publisko karti, neuzticamu ievadi, vadības centru, personas datu glabātuvi, auditu un MI starpslāni; minimālas DB lomas; failu karantīna; misiju drošības vārti; tikai papildināms audits.",
    pabeigsanas_kriterijs: "Katru moduli var atsevišķi izvērst, izslēgt un atjaunot bez cita moduļa atslēgām vai datiem.",
  },
  {
    posms: "4",
    termins: "3–12 mēneši",
    merkis: "Radīt neatkarīgus iepirkumu un atbilstības pierādījumus",
    darbi: "Ielaušanās tests, incidentu un darbības atjaunošanas mācības, NIS2/CRA/MI akta dokumenti un — tikai pēc klientu pieprasījuma — ISO 27001 ieviešana/sertifikācija.",
    pabeigsanas_kriterijs: "Drošības un atbilstības apgalvojumiem ir neatkarīgi testi un auditējami pierādījumi.",
  },
];

const datasets = {
  kontroles_stavoklis: controls,
  uzbrukumu_kopsavilkums: attackSummary,
  programmat_vektori: softwareVectors,
  cilveku_vektori: humanVectors,
  prezentacijas_posmi: meetingStages,
  produktu_robezas: products,
  atbilstibas_minimums: compliance,
  atkaribu_riski: dependencyRisks,
  ricibas_plans: roadmap,
};

const dataSource = ({ id, label, href = repoTree, dataset, rows, fields, orderBy, description, filters, metrics, tables }) => ({
  id,
  label,
  href,
  query: {
    engine: "SQLite",
    language: "sql",
    sql: materializationSql(dataset, rows, fields, orderBy),
    description,
    executed_at: generatedAt,
    filters,
    metric_definitions: metrics,
    tables_used: tables,
  },
});

const sources = [
  {
    id: "repo-pr73",
    label: "Atbalsts PR #73 un pārbaudītais drošības zars",
    href: prUrl,
    query: {
      engine: "Git un GitHub",
      description: "Koda izmaiņu, bāzes komita, PR robežu un repozitorija atļauju pārbaude.",
      executed_at: generatedAt,
      filters: [
        `PR komits ${commit}`,
        `Bāzes origin/main komits ${baseCommit}`,
        "Lietotājam ir push, bet nav admin/maintain tiesību; administratora iestatījumi netika mainīti",
      ],
      tables_used: [
        "src/server.ts",
        "src/lib/center-events.ts",
        ".github/workflows/ci.yml",
        ".github/workflows/deploy.yml",
        ".github/dependabot.yml",
        ".github/CODEOWNERS",
      ],
    },
  },
  {
    id: "ci-pr73",
    label: "GitHub Actions CI izpilde PR #73",
    href: ciUrl,
    query: {
      engine: "GitHub Actions",
      description: "PR tipa, lint, 32 probe, produkcijas build, kritisku produkcijas atkarību un noslēpumu paraugu pārbaude.",
      executed_at: generatedAt,
      filters: ["Izpilde 34499895675", "Rezultāts: sekmīgs", "Komits 5abbb5e"],
      tables_used: ["GitHub Actions verify job"],
    },
  },
  {
    id: "live-production",
    label: "Publiski novērojamā produkcijas veselības pārbaude pirms PR izvēršanas",
    href: "https://atbalsts.sortium.co/api/health",
    query: {
      engine: "HTTPS read-only observation",
      description: "Anonīma produkcijas atbildes pārbaude pirms PR #73 apvienošanas; topoloģijas interpretācija salīdzināta ar pilnvarotā Cloudflare aģenta iesniegto inventarizāciju.",
      executed_at: generatedAt,
      filters: [
        "Produkcija vēl nav atjaunināta ar PR #73",
        "Būvējuma identitāte novērošanas brīdī bija unknown",
        "Atbilde bija DYNAMIC, bet tai nebija lietotnes Cache-Control galvenes",
        "Pilnvarotā aģenta inventarizācija: Cloudflare Tunnel uz lokālu Vite priekšskatījuma serveri; Worker nav publiskās vides izcelsme",
        "Netika veikta autentifikācija vai mutējoši pieprasījumi",
      ],
      tables_used: ["atbalsts.sortium.co/api/health"],
    },
  },
  {
    id: "live-origin-finding",
    label: "PR #73 — publiskās vides izcelsmes atradums un drošs pārejas plāns",
    href: `https://github.com/goofis11/palidzi/blob/${commit}/docs/LIVE-ORIGIN-FINDING-2026-09-10.md`,
    query: {
      engine: "Dokumentēta arhitektūras inventarizācija",
      description: "Pilnvarotā Cloudflare aģenta atradumi, publiska pārbaude un no tiem izrietošie izvēršanas vārti.",
      executed_at: generatedAt,
      filters: [
        "Publiskā vide: Cloudflare proxy un nosaukts tunelis uz lokālu izcelsmes serveri",
        "Worker eksistē, bet nav piesaistīts publiskajam maršrutam",
        "Zone/WAF/DNS izmaiņas netika veiktas nepietiekamu tiesību dēļ",
      ],
      tables_used: ["docs/LIVE-ORIGIN-FINDING-2026-09-10.md", ".github/workflows/deploy.yml"],
    },
  },
  dataSource({
    id: "kontroles-avots",
    label: "Pārbaudīto Atbalsts kontroļu inventārs",
    dataset: "kontroles_stavoklis",
    rows: controls,
    fields: ["seciba", "kontrole", "statuss", "pieradijums", "atlikums"],
    orderBy: "seciba",
    description: "Koda, probe pārbaudes un PR pierādījumi, nošķirot galveno zaru, PR un ārējo konfigurāciju.",
    filters: ["Stāvoklis 2026-09-10", "PR izmaiņas nav uzskatītas par produkcijā ieviestām"],
    metrics: ["Statuss ir pierādījumu klase, nevis sertifikācijas vai brieduma vērtējums."],
    tables: ["Atbalsts source tree", "GitHub PR #73", "GitHub Actions run 34499895675"],
  }),
  dataSource({
    id: "uzbrukumu-kopsavilkums-avots",
    label: "Izvērtēto uzbrukuma vektoru rīcības termiņu kopsavilkums",
    dataset: "uzbrukumu_kopsavilkums",
    rows: attackSummary,
    fields: ["seciba", "termins", "veids", "skaits"],
    orderBy: "seciba",
    description: "Divdesmit pārskatīto programmatūras un cilvēku/procesa scenāriju sadalījums pēc primārā kontroles termiņa.",
    filters: ["Katrs scenārijs ieskaitīts vienā primārajā termiņā", "Nav incidentu statistika vai varbūtības modelis"],
    metrics: ["Skaits = kvalitatīvi izvērtēto scenāriju skaits attiecīgajā tipā un termiņā."],
    tables: ["docs/THREAT-MODEL-2026-09-04.md", "docs/EXTERNAL-REVIEW-2026-09-07.md", "PR #73 review"],
  }),
  dataSource({
    id: "programmat-vektori-avots",
    label: "Programmatūras uzbrukuma vektoru izvērtējums",
    dataset: "programmat_vektori",
    rows: softwareVectors,
    fields: ["seciba", "id", "vektors", "pasreizeja_kontrole", "atlikusais_risks", "nakamais_varts", "termins"],
    orderBy: "seciba",
    description: "Galvenie tehniskie uzbrukuma ceļi, esošās kontroles, atlikušais risks un nākamais produkta vārts.",
    filters: ["Fokuss uz arhitektūru un augstas ietekmes loģiku", "Kosmētiski un zemas ietekmes defekti izlaisti"],
    metrics: ["Termiņš ir primārais kontroles vārts, nevis ekspluatācijas varbūtības prognoze."],
    tables: ["src/server.ts", "src/lib/*", "docs/THREAT-MODEL-2026-09-04.md"],
  }),
  dataSource({
    id: "cilveku-vektori-avots",
    label: "Cilvēku un procesa uzbrukuma vektoru izvērtējums",
    dataset: "cilveku_vektori",
    rows: humanVectors,
    fields: ["seciba", "id", "vektors", "pasreizeja_kontrole", "atlikusais_risks", "nakamais_varts", "termins"],
    orderBy: "seciba",
    description: "Cilvēkfaktora, sociālās inženierijas, pārvaldības un krīzes darba scenāriji.",
    filters: ["Nav veikta personāla intervija vai sociālās inženierijas tests", "Procesa kontroles, kurām nav pierādījumu, uzskatītas par atvērtām"],
    metrics: ["Termiņš ir ieteiktais produkta vārts, nevis cilvēku uzticamības vērtējums."],
    tables: ["docs/THREAT-MODEL-2026-09-04.md", "docs/SAFETY-AND-DATA-PROTECTION.md", "PR #73 review"],
  }),
  dataSource({
    id: "prezentacijas-posmi-avots",
    label: "Platformas posmu un pieļaujamo drošības apgalvojumu matrica",
    dataset: "prezentacijas_posmi",
    rows: meetingStages,
    fields: ["seciba", "posms", "ko_var_apgalvot", "obligatie_varti", "apzinata_robeza"],
    orderBy: "seciba",
    description: "Sapulcē lietojama matrica, kas sasaista platformas posmu ar nepieciešamajiem vārtiem un apzinātajām robežām.",
    filters: ["Drošības apgalvojumi nepārsniedz pieejamos pierādījumus"],
    metrics: ["Secība atspoguļo pieaugošu datu un darbību ietekmi."],
    tables: ["Atbalsts architecture review", "PR #73", "PRE-PRESENTATION-SECURITY-ROADMAP.md"],
  }),
  dataSource({
    id: "produktu-arhitektura",
    label: "Produktu robežu arhitektūras izvērtējums",
    dataset: "produktu_robezas",
    rows: products,
    fields: ["seciba", "modulis", "drosibas_robeza", "ieteikums"],
    orderBy: "seciba",
    description: "Ieteiktā produktu secība un drošības robežas pēc datu, pilnvaru un iespējamā kaitējuma.",
    filters: ["Priekšroka mazākam kompromitēšanas tvērumam", "Ilglaicīgi koda zari nav uzskatīti par drošības robežu"],
    metrics: ["Secība ir arhitektūras ieviešanas prioritāte, nevis kvantitatīvs riska reitings."],
    tables: ["Atbalsts source tree", "docs/THREAT-MODEL-2026-09-04.md", "docs/PLAN.md"],
  }),
  dataSource({
    id: "atbilstibas-izvertejums",
    label: "Oficiālo Latvijas un ES prasību piemērojamības izvērtējums",
    href: "https://likumi.lv/ta/id/353390-nacionalas-kiberdrosibas-likums",
    dataset: "atbilstibas_minimums",
    rows: compliance,
    fields: ["prioritate", "regulējums", "statuss", "riciba"],
    orderBy: "prioritate",
    description: "Kopsavilkuma matrica, kas balstīta oficiālajos Latvijas un ES aktos un standartu primārajos avotos.",
    filters: ["Latvija un Eiropas Savienība", "Precīza piemērojamība atkarīga no operatora, klienta un paredzētā lietojuma"],
    metrics: ["Prioritāte ir ieteikta ieviešanas secība, nevis juridiska atbilstības deklarācija."],
    tables: ["VDAR", "Nacionālās kiberdrošības likums", "MK noteikumi Nr. 397", "CRA", "MI akts"],
  }),
  dataSource({
    id: "atkaribu-audits",
    label: "Iepriekšējā pilnā package-lock.json audita bāzes līnija",
    href: `https://github.com/goofis11/palidzi/blob/${commit}/package-lock.json`,
    dataset: "atkaribu_riski",
    rows: dependencyRisks,
    fields: ["smagums", "skaits", "pakotnes", "konteksts", "parbaudes_datums", "ieteikums"],
    orderBy: "skaits",
    description: "2026-09-10 fiksētā pilnās atkarību ķēdes audita bāzes līnija; PR CI atsevišķi pārbaudīja kritiskus produkcijas paziņojumus.",
    filters: ["Lock fails PR #73 nav mainīts", "Paziņojums nenozīmē sasniedzamu ievainojamību produkcijā"],
    metrics: ["Skaits = iepriekšējā pilnā npm audit paziņojumu skaits pa smaguma pakāpēm."],
    tables: ["package-lock.json", "npm audit --json", "GitHub Actions run 34499895675"],
  }),
  dataSource({
    id: "ricibas-celakarte",
    label: "Atjaunotā kiberdrošības ceļakarte",
    dataset: "ricibas_plans",
    rows: roadmap,
    fields: ["posms", "termins", "merkis", "darbi", "pabeigsanas_kriterijs"],
    orderBy: "posms",
    description: "Darbu secība pēc produkta vārtiem, riska samazinājuma un ārējām atkarībām.",
    filters: ["Kopīgā parole apzināti netiek mainīta demonstrācijas posmā", "Cloudflare darbi nodoti atsevišķam pilnvarotam aģentam"],
    metrics: ["Posms ir atkarībās balstīta secība, nevis līgumisks termiņš."],
    tables: ["PR #73", "PRE-PRESENTATION-SECURITY-ROADMAP.md", "Cloudflare handoff prompt"],
  }),
  { id: "vdar", label: "Regula (ES) 2016/679 (VDAR)", href: "https://eur-lex.europa.eu/legal-content/LV/TXT/?uri=CELEX:32016R0679" },
  { id: "nkl", label: "Nacionālās kiberdrošības likums", href: "https://likumi.lv/ta/id/353390-nacionalas-kiberdrosibas-likums" },
  { id: "mk397", label: "MK noteikumi Nr. 397 — Minimālās kiberdrošības prasības", href: "https://likumi.lv/ta/id/361481-minimalas-kiberdrosibas-prasibas" },
  { id: "cra", label: "Eiropas Komisijas Kibernoturības akta pārskats", href: "https://digital-strategy.ec.europa.eu/en/policies/cra-summary" },
  { id: "ai-act", label: "Eiropas Komisijas Mākslīgā intelekta akta pārskats", href: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai" },
  { id: "nist-csf", label: "NIST Kiberdrošības ietvars 2.0", href: "https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20" },
  { id: "owasp-asvs", label: "OWASP ASVS 5", href: "https://owasp.org/www-project-application-security-verification-standard/" },
  { id: "cloudflare-rate", label: "Cloudflare Rate Limiting Rules", href: "https://developers.cloudflare.com/waf/rate-limiting-rules/" },
  { id: "cloudflare-waf", label: "Cloudflare Managed Rules", href: "https://developers.cloudflare.com/waf/managed-rules/" },
  { id: "cloudflare-tunnel", label: "Cloudflare Tunnel arhitektūra un aizsardzības plūsma", href: "https://developers.cloudflare.com/tunnel/" },
  { id: "vite-preview", label: "Vite statiska izvietošana — preview nav produkcijas serveris", href: "https://vite.dev/guide/static-deploy" },
  { id: "github-protection", label: "GitHub protected branches", href: "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches" },
  { id: "github-dependabot", label: "GitHub Dependabot version updates", href: "https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates" },
];

const tables = [
  {
    id: "kontroles-tabula",
    title: "Esošo un šajā PR ieviesto kontroļu stāvoklis",
    subtitle: "PR kontroles nav uzskatītas par produkcijā ieviestām, kamēr nav sekmīga izvēršana.",
    showDescription: true,
    dataset: "kontroles_stavoklis",
    defaultSort: { field: "seciba", direction: "asc" },
    density: "spacious",
    sourceId: "kontroles-avots",
    layout: "full",
    columns: [
      { field: "seciba", label: "#", type: "text" },
      { field: "kontrole", label: "Kontrole", type: "text" },
      { field: "statuss", label: "Stāvoklis", type: "text" },
      { field: "pieradijums", label: "Pierādījums", type: "text" },
      { field: "atlikums", label: "Atlikušais darbs", type: "text" },
    ],
  },
  {
    id: "programmat-tabula",
    title: "Programmatūras uzbrukuma vektori",
    subtitle: "Esošā kontrole, atlikušais risks un nākamais produkta vārts.",
    showDescription: true,
    dataset: "programmat_vektori",
    defaultSort: { field: "seciba", direction: "asc" },
    density: "spacious",
    sourceId: "programmat-vektori-avots",
    layout: "full",
    columns: [
      { field: "seciba", label: "#", type: "text" },
      { field: "id", label: "ID", type: "text" },
      { field: "vektors", label: "Uzbrukuma ceļš", type: "text" },
      { field: "pasreizeja_kontrole", label: "Kas jau aizsargā", type: "text" },
      { field: "atlikusais_risks", label: "Atlikušais risks", type: "text" },
      { field: "nakamais_varts", label: "Nākamais vārts", type: "text" },
      { field: "termins", label: "Termiņš", type: "text" },
    ],
  },
  {
    id: "cilveku-tabula",
    title: "Cilvēku un procesa uzbrukuma vektori",
    subtitle: "Tehniska kontrole nevar aizstāt identitāti, apmācību, četru acu principu un incidentu praksi.",
    showDescription: true,
    dataset: "cilveku_vektori",
    defaultSort: { field: "seciba", direction: "asc" },
    density: "spacious",
    sourceId: "cilveku-vektori-avots",
    layout: "full",
    columns: [
      { field: "seciba", label: "#", type: "text" },
      { field: "id", label: "ID", type: "text" },
      { field: "vektors", label: "Uzbrukuma vai kļūmes ceļš", type: "text" },
      { field: "pasreizeja_kontrole", label: "Kas jau aizsargā", type: "text" },
      { field: "atlikusais_risks", label: "Atlikušais risks", type: "text" },
      { field: "nakamais_varts", label: "Nākamais vārts", type: "text" },
      { field: "termins", label: "Termiņš", type: "text" },
    ],
  },
  {
    id: "produktu-tabula",
    title: "Ieteicamie atsevišķie produktu moduļi",
    subtitle: "Secība samazina datu un pilnvaru apjomu, ko viens kompromitēts modulis var skart.",
    showDescription: true,
    dataset: "produktu_robezas",
    defaultSort: { field: "seciba", direction: "asc" },
    density: "spacious",
    sourceId: "produktu-arhitektura",
    layout: "full",
    columns: [
      { field: "seciba", label: "Secība", type: "text" },
      { field: "modulis", label: "Modulis", type: "text" },
      { field: "drosibas_robeza", label: "Drošības robeža", type: "text" },
      { field: "ieteikums", label: "Ieteikums", type: "text" },
    ],
  },
  {
    id: "posmu-tabula",
    title: "Ko drīkst apgalvot katrā platformas posmā",
    subtitle: "Sapulces valoda ir sasaistīta ar pārbaudāmiem produkta vārtiem.",
    showDescription: true,
    dataset: "prezentacijas_posmi",
    defaultSort: { field: "seciba", direction: "asc" },
    density: "spacious",
    sourceId: "prezentacijas-posmi-avots",
    layout: "full",
    columns: [
      { field: "seciba", label: "#", type: "text" },
      { field: "posms", label: "Posms", type: "text" },
      { field: "ko_var_apgalvot", label: "Pamatotais apgalvojums", type: "text" },
      { field: "obligatie_varti", label: "Obligātie vārti", type: "text" },
      { field: "apzinata_robeza", label: "Apzinātā robeža", type: "text" },
    ],
  },
  {
    id: "atbilstibas-tabula",
    title: "Atbilstības minimums un standarti",
    subtitle: "Piemērojamība jāfiksē pa juridisko personu, klientu un produkta paredzēto lietojumu.",
    showDescription: true,
    dataset: "atbilstibas_minimums",
    defaultSort: { field: "prioritate", direction: "asc" },
    density: "spacious",
    sourceId: "atbilstibas-izvertejums",
    layout: "full",
    columns: [
      { field: "prioritate", label: "Prioritāte", type: "text" },
      { field: "regulējums", label: "Regulējums vai standarts", type: "text" },
      { field: "statuss", label: "Piemērojamība", type: "text" },
      { field: "riciba", label: "Nepieciešamā rīcība", type: "text" },
    ],
  },
  {
    id: "celakartes-tabula",
    title: "Prioritārā drošības ceļakarte",
    subtitle: "Prezentācijas darbi ir atdalīti no pilota un operatīvā pakalpojuma vārtiem.",
    showDescription: true,
    dataset: "ricibas_plans",
    defaultSort: { field: "posms", direction: "asc" },
    density: "spacious",
    sourceId: "ricibas-celakarte",
    layout: "full",
    columns: [
      { field: "posms", label: "Posms", type: "text" },
      { field: "termins", label: "Termiņš", type: "text" },
      { field: "merkis", label: "Mērķis", type: "text" },
      { field: "darbi", label: "Galvenie darbi", type: "text" },
      { field: "pabeigsanas_kriterijs", label: "Pabeigšanas kritērijs", type: "text" },
    ],
  },
];

const dependencyChart = {
  ...previous.manifest.charts.find((chart) => chart.id === "atkaribu-riski-diagramma"),
  subtitle: "Iepriekšējā pilnā audita bāzes līnija: 9 paziņojumi un 0 kritisku; PR CI izturēja atsevišķo kritisko produkcijas atkarību vārtu pārbaudi.",
  sourceId: "atkaribu-audits",
};

const attackChart = {
  id: "uzbrukumu-prioritates-diagramma",
  title: "Izvērtētie uzbrukuma vektori pēc primārā rīcības termiņa",
  subtitle: "Pirms personas datu pilota vajadzīgi vairāk kontroles vārtu nekā pašai marķētajai demonstrācijai.",
  showDescription: true,
  intent: "comparison",
  question: "Kurā produkta posmā jāievieš katra pārskatītā programmatūras vai cilvēku/procesa kontrole?",
  rationale: "Grupēti stabiņi salīdzina divu veidu scenāriju skaitu vienā un tajā pašā produkta termiņā.",
  comparisonContext: {
    grain: "uzbrukuma vektora tips un primārais rīcības termiņš",
    denominator: "20 kvalitatīvi izvērtēti scenāriji",
    unit: "scenāriji",
  },
  type: "bar",
  dataset: "uzbrukumu_kopsavilkums",
  sourceId: "uzbrukumu-kopsavilkums-avots",
  encodings: {
    x: { field: "termins", type: "ordinal", label: "Primārais rīcības termiņš" },
    y: { field: "skaits", type: "quantitative", aggregate: "none", format: "number", label: "Scenāriju skaits", unit: "scenāriji" },
    color: { field: "veids", type: "nominal", label: "Vektora tips" },
    tooltip: [
      { field: "termins", type: "ordinal", label: "Termiņš" },
      { field: "veids", type: "nominal", label: "Tips" },
      { field: "skaits", type: "quantitative", format: "number", label: "Scenāriji" },
    ],
  },
  options: { orientation: "vertical", grouping: "grouped" },
  xAxisTitle: "Primārais rīcības termiņš",
  yAxisTitle: "Izvērtēto scenāriju skaits",
  valueFormat: "number",
  layout: "full",
  maxRows: 8,
  emptyState: "Uzbrukuma scenāriju dati nav pieejami.",
  surface: { surface: "card", viewMode: "both", showControls: false },
};

const title = "Atbalsts kiberdrošība: kontroles, uzbrukumu ceļi un drošas attīstības plāns";
const blocks = [
  { id: "virsraksts", type: "markdown", layout: "full", body: `# ${title}` },
  {
    id: "vadibas-kopsavilkums",
    type: "markdown",
    layout: "full",
    body: `## Executive Summary / Vadības kopsavilkums

- **Pamatdrošības stāsts prezentācijai ir pamatots.** Avota kodā jau ir kļūmju gadījumā slēgta konfigurācija, drošas sesijas un izcelsmes pārbaudes, minimizēti brīvprātīgo saraksti, avotu un ievades drošības pārbaudes, determinēta ārkārtas atbilde pirms MI, ierobežota bezsaistes kešatmiņa, kā arī atomāra un idempotenta situāciju publicēšana.

- **PR [#73](${prUrl}) aizver tieši pirms prezentācijas jēgpilnās spraugas:** publiskajam notikumu API ir atļauto lauku projekcija; anonīmā veselības pārbaude vairs neizpauž topoloģiju, identitātes vai MI konfigurāciju; pievienoti Dependabot, CODEOWNERS, kritisku produkcijas atkarību CI vārti un paplašināta noslēpumu paraugu pārbaude. [CI izpilde](${ciUrl}) ir sekmīga ar 32 pārbaudēm.

- **Publiskās vides izcelsme nav Cloudflare Worker.** Pilnvarotā aģenta inventarizācija rāda plūsmu Cloudflare proxy → Tunnel → lokāls Vite priekšskatījuma serveris; publiskā pārbaude to papildina ar plašu \`/api/health\`, \`build: unknown\` un atšķirīgiem aktīvu jaucējkodiem. Tādēļ Worker izvēršana pati par sevi nemaina publisko sistēmu, bet domēna piesaiste Worker būtu atsevišķa arhitektūras pārslēgšana.

- **Drošākais solis pirms prezentācijas ir atjaunināt faktisko tuneļa izcelsmes serveri, nevis steigt Worker migrāciju.** Jāizvieto precīzs apstiprinātā \`main\` SHA, jāiestata \`ATBALSTS_BUILD_SHA\`, jāuzrauga gan lietotnes, gan \`cloudflared\` process un jāizmēģina atgriešanās iepriekšējā versijā. Vite dokumentācija norāda, ka \`vite preview\` nav paredzēts kā produkcijas serveris, tāpēc šo risinājumu drīkst saukt tikai par īslaicīgu demonstrācijas vidi.

- **Kopīgā Centra parole šai marķētajai demonstrācijai ir apzināts ierobežojums, nevis slēpts defekts.** Tā nav prezentācijas bloķētājs, ja netiek apgalvota personiska darbību attiecināmība vai produkcijas gatavība. Pirms reāla operatoru/personas datu pilota vajadzīgi individuāli konti, MFA un tūlītēja sesiju atsaukšana.

- **Ārējie pamatdarbi ir skaidri nodalīti.** Cloudflare domēna zonas īpašniekam, kad ir vajadzīgās tiesības, jāievieš plānam atbilstoši perimetra limiti un WAF; pašreizējie lietotnes limiti un autentificētais datu atsvaidzināšanas maršruts ir kompensējošas, nevis līdzvērtīgas perimetra kontroles. GitHub administratoram jāieslēdz galvenā zara aizsardzība un pieejamās drošības funkcijas. Neviena no šīm konta izmaiņām šajā novērtējumā netiek pasludināta par jau ieviestu.`,
  },
  {
    id: "kontroles-ievads",
    type: "markdown",
    layout: "full",
    body: `## Ko jau darām pareizi

Drošības bāze nav tikai dokumentācija: to uztur konkrētas servera robežas un 32 automātiskas probe pārbaudes. Svarīgākais prezentācijas vēstījums ir nevis “viss ir pabeigts”, bet “augstas ietekmes lēmumi ir atdalīti no MI un neuzticamas ievades, publiskie dati tiek minimizēti, un katram nākamajam lietojuma posmam ir savi vārti”.`,
  },
  { id: "kontroles-bloks", type: "table", tableId: "kontroles-tabula", layout: "full" },
  {
    id: "pr73-izmainas",
    type: "markdown",
    layout: "full",
    body: `## Kas ir izlabots tieši pirms prezentācijas

PR #73 maina noklusējumu no “publiskot visu glabāto objektu” uz “publiskot tikai pārskatītu lauku sarakstu”. Tas pats princips piemērots diagnostikai: publiski paliek tikai darbspējas pazīme un būvējuma identitāte, bet sensitīvā topoloģija un konfigurācijas stāvoklis ir pieejams tikai autentificētam Centra operatoram. Izvēršanas pārbaude tagad apstājas, ja produkcijas SHA neatbilst izlaidumam.

Worker izvēršanas darbplūsma ir pārveidota par apzinātu pārslēgšanas darbību: tā vairs nestartējas automātiski pēc \`main\` izmaiņas un prasa manuālu apstiprinājumu. Tas novērš situāciju, kur veca, publiskajam domēnam nepiesaistīta Worker izvēršana tiek kļūdaini uzskatīta par publiskās vides izlaidumu.

Repozitorija pusē ir ieviesta uzturama atkarību atjaunināšana un koda īpašnieki. Tomēr \`CODEOWNERS\` kļūst par piespiedu kontroli tikai kopā ar aizsargātu \`main\`; pašreizējām piekļuves tiesībām nav administratora pilnvaru šo iestatījumu ieslēgt.`,
  },
  {
    id: "uzbrukumu-ievads",
    type: "markdown",
    layout: "full",
    body: `## Uzbrukuma scenāriji un prioritātes

Zemāk ir 20 kvalitatīvi izvērtēti scenāriji. Skaits nav incidentu biežums un nav matemātiska varbūtība; tas parāda, kurā platformas posmā katram scenārijam vajadzīgs galvenais kontroles vārts. Demonstrācijai jāaizver tikai tie ceļi, kas var diskreditēt pamatdrošību vai publiski izpaust iekšējus datus. Personas datu un cilvēku nosūtīšanas funkcijas apzināti saņem stingrākus vēlākus vārtus.`,
  },
  { id: "uzbrukumu-diagramma", type: "chart", chartId: "uzbrukumu-prioritates-diagramma", layout: "full" },
  {
    id: "programmat-ievads",
    type: "markdown",
    layout: "full",
    body: `## Programmatūras uzbrukuma vektori

Galvenie tehniskie ceļi ir publisko API datu noplūde, izkliedēta ļaunprātīga izmantošana, izvēršanas kompromitēšana, sesiju atkārtota izmantošana, promptu/datu saindēšana, ļaunprātīgi faili, misiju drošības apiešana, ārējo avotu kompromitēšana, pārāk plašas datubāzes tiesības un piegādes ķēdes ievainojamības.`,
  },
  { id: "programmat-bloks", type: "table", tableId: "programmat-tabula", layout: "full" },
  {
    id: "cilveku-ievads",
    type: "markdown",
    layout: "full",
    body: `## Cilvēku un procesa uzbrukuma vektori

Krīzes platformai pretinieks ne vienmēr uzbrūk kodam. Pikšķerēšana, kopīgi akreditācijas dati, nozaudēta ierīce, iekšēja ļaunprātība, uzdošanās par piegādātāju, nogurums, baumu pastiprināšana un neizspēlēta atjaunošana var apiet tehniski pareizu funkciju. Šīs kontroles jādemonstrē ar lomām, praksi un pierādījumiem, nevis tikai politikas tekstu.`,
  },
  { id: "cilveku-bloks", type: "table", tableId: "cilveku-tabula", layout: "full" },
  {
    id: "pasreizeja-arhitektura",
    type: "markdown",
    layout: "full",
    body: `## Pašreizējā publiskās vides arhitektūra un tās nozīme

    Internets → Cloudflare proxy → Cloudflare Tunnel → cloudflared uz lokālā hosta
                                                    └→ Vite priekšskatījuma serveris 127.0.0.1:4178 → API un datu pakalpojumi

    Cloudflare Worker atbalsts-sortium-co → eksistē, bet publiskajam domēnam nav piesaistīts

Tunelis ir vērtīga robeža, jo savienojums uz Cloudflare tiek veidots no izcelsmes servera uz āru un nav jāatver publisks ienākošais ports. Tomēr šis ieguvums neatrisina lokālā hosta, procesa uzraudzības, rezerves kopiju un izlaiduma izsekojamības riskus. Pielāgoti domēna zonas WAF un pieprasījumu biežuma noteikumi nav pierādīti kā ieviesti.

Svarīgākais arhitektūras trūkums nav pats tunelis, bet tas, ka publisko vietni apkalpo \`vite preview\`, ko Vite dokumentācija neparedz kā produkcijas serveri, un publiskais būvējums nav identificējams. Prezentācijai to var saglabāt kā marķētu, uzraudzītu demonstrācijas izcelsmes serveri; 0–30 dienās tas jāaizstāj ar atbalstītu produkcijas izpildvidi vai pirmsražošanas vidē pārbaudītu Worker migrāciju.`,
  },
  {
    id: "arhitektura",
    type: "markdown",
    layout: "full",
    body: `## Mērķa arhitektūra: viena kodu bāze, vairākas reālas drošības robežas

Ilglaicīgi produktu zari nav drošības robeža — tie rada drošības labojumu novirzi. Ieteicams saglabāt kopīgus moduļus, bet izvērst atsevišķus servisus ar savām atslēgām, datubāzes lomām un kļūmes zonām.

    Ārējie avoti → izolēti savienotāji → karantīna/normalizācija → versēti notikumi
    Iedzīvotāji → ziņojumu API → personas datu glabātuve → privāts vadības centrs
                                                        └→ cilvēka lēmums → outbox → publiskā karte
    MI starpslānis ← tikai minimizētas projekcijas; bez publicēšanas vai nosūtīšanas tiesībām
    Audits/rezerves kopijas ← atsevišķa, pret manipulācijām pārbaudāma uzticamības zona

Funkcionalitātes slēdzis var izolēt nepabeigtu funkciju no lietotāja, bet par drošības robežu tas kļūst tikai tad, ja atslēgas un datu tiesības ir atdalītas.`,
  },
  { id: "produktu-bloks", type: "table", tableId: "produktu-tabula", layout: "full" },
  {
    id: "apzinatas-robezas",
    type: "markdown",
    layout: "full",
    body: `## Apzināti ierobežojumi, kurus drīkst skaidrot prezentācijā

- **Kopīgā parole:** pieļaujama tikai marķētai demonstrācijai; tā nepierāda individuālu operatoru atbildību.
- **Tunelis uz Vite priekšskatījuma serveri:** pieļaujams īslaicīgai, uzraudzītai prezentācijas videi ar precīzu SHA un pārbaudītu atgriešanās plānu; to nedrīkst saukt par produkcijas servera arhitektūru.
- **MI padomdevēja loma:** apzināti nav tiesību publicēt situāciju vai nosūtīt cilvēkus; kritiskā ārkārtas atbilde darbojas pirms MI.
- **Sintētiski mācību dati:** tie ir vizuāli marķēti, centralizēti izslēdzami un notīrāmi; tos nedrīkst sajaukt ar operatīvu informāciju.
- **Pakāpeniska funkciju palaišana:** publisko saturu un karti var atdalīt agrāk; personas datu ievade, vadības centrs un brīvprātīgo misijas paliek aiz stingrākiem vārtiem.
- **Publisks būvējuma SHA:** apzināti saglabāts kā minimāls izlaiduma pierādījums; tas neaizstāj iekšējo monitoringu.
- **Nav atbilstības sertifikācijas apgalvojuma:** tiek izmantoti standarti un vārti, bet juridiska atbilstība un ISO sertifikācija nav pasludināta bez attiecīga pierādījuma.`,
  },
  { id: "posmu-bloks", type: "table", tableId: "posmu-tabula", layout: "full" },
  {
    id: "atbilstiba",
    type: "markdown",
    layout: "full",
    body: `## Atbilstības un standartu ceļš

[VDAR](https://eur-lex.europa.eu/legal-content/LV/TXT/?uri=CELEX:32016R0679) ir pirmais praktiskais pienākumu slānis, tiklīdz izmanto reālu personu datus. [Nacionālā kiberdrošības likuma](https://likumi.lv/ta/id/353390-nacionalas-kiberdrosibas-likums), NIS2 un [MK noteikumu Nr. 397](https://likumi.lv/ta/id/361481-minimalas-kiberdrosibas-prasibas) piemērojamība jānosaka pēc operatora, pakalpojuma un klienta statusa. Katram pārdodamam modulim atsevišķi jāizvērtē [Kibernoturības akts](https://digital-strategy.ec.europa.eu/en/policies/cra-summary), bet MI lomas maiņa no padomdevēja uz lēmumu ietekmējošu funkciju maina [MI akta](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) riska profilu.

Praktiskai drošības programmai izmantot [NIST CSF 2.0](https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20) pārvaldībai un [OWASP ASVS 5](https://owasp.org/www-project-application-security-verification-standard/) lietotnes prasību/pieņemšanas kritērijiem. ISO 27001 ir organizācijas vadības sistēmas projekts, nevis ātrs produkta ķeksītis; to sākt, kad to prasa tirgus vai iepirkums.`,
  },
  { id: "atbilstibas-bloks", type: "table", tableId: "atbilstibas-tabula", layout: "full" },
  {
    id: "atkaribas",
    type: "markdown",
    layout: "full",
    body: `## Atkarību ievainojamības jālabo pēc sasniedzamības

Iepriekšējā pilnā fiksētās atkarību ķēdes pārbaude ziņoja 9 paziņojumus — 6 augstus un 3 vidējus, bez kritiskiem. PR #73 nemaina lock failu, bet tā CI sekmīgi izpildīja jaunu, šauru vārtu: kritisks paziņojums produkcijas atkarībās aptur izmaiņu. Atlikušie augstie/vidējie ceļi jāklasificē pēc tā, vai tie ir sasniedzami faktiskajā lokālajā Node/Vite izcelsmes serverī, nākotnes Worker izpildē vai tikai būvēšanas/izvēršanas rīkos; pēc tam jāievieš saderīgs atjauninājums vai terminēts izņēmums.`,
  },
  { id: "atkaribu-diagramma", type: "chart", chartId: "atkaribu-riski-diagramma", layout: "full" },
  {
    id: "celakarte",
    type: "markdown",
    layout: "full",
    body: `## Ceļš uz priekšu

Pirms prezentācijas nav jāmēģina pabeigt visu drošības programmu vai mainīt publiskās vides izcelsmes arhitektūru. Jāpierāda publiskās virsmas minimizācija un precīza izlaiduma izvēršana faktiskajā tuneļa izcelsmes serverī, jāpārbauda procesa restartēšana un atgriešanās iepriekšējā versijā un godīgi jānosauc perimetra noteikumu un priekšskatījuma izpildvides robežas. Datu pārvaldība, individuāla identitāte, sesiju atsaukšana un failu drošība ir vārti pirms personas datu pilota; atbalstīta produkcijas izpildvide, sistēmu/uzticamības zonu nodalīšana un neatkarīgi pierādījumi seko pēc tam.`,
  },
  { id: "celakartes-bloks", type: "table", tableId: "celakartes-tabula", layout: "full" },
  {
    id: "jautajumi",
    type: "markdown",
    layout: "full",
    body: `## Jautājumi sapulcei

1. Kuru platformas posmu patiesībā vērtējam — demonstrāciju, tikai lasāmu publisku produktu, personas datu pilotu vai operatīvu sistēmu?
2. Kura juridiskā persona būs operators, datu pārzinis vai apstrādātājs katrā modulī?
3. Vai pirmajam produktam vispār vajag precīzu atrašanās vietu, attēlus, sensitīvas kompetences un ārēju MI?
4. Vai MI paliek tikai padomdevējs, vai nākotnē ietekmēs prioritizēšanu, triāžu vai cilvēku nosūtīšanu?
5. Kāds ir pieļaujamais atjaunošanas laiks un datu zudums, un kā komanda sazinās, ja pati platforma nav pieejama?
6. Kurš ir īpašnieks Cloudflare/GitHub administratīvajām kontrolēm, privātuma programmai, incidentu vadībai un produktu robežu izveidei?`,
  },
  {
    id: "ierobezojumi",
    type: "markdown",
    layout: "full",
    body: `## Ierobežojumi un pierādījumu robežas

Šis ir avota koda, arhitektūras, CI/CD un publiski novērojamās vides novērtējums, nevis ielaušanās tests, juridisks atzinums, VDAR audits, ISO audits vai sociālās inženierijas pārbaude. Tuneļa un Worker topoloģija balstās lietotāja iesniegtā pilnvarotā Cloudflare aģenta inventarizācijā; publiski tika neatkarīgi apstiprināta plašā veselības pārbaudes atbilde, \`build: unknown\`, DYNAMIC statuss un aktīvā būvējuma atšķirība, bet šajā novērtējumā netika veikts atkārtots administratīvs domēna zonas konfigurācijas audits. Supabase, iekšējo žurnālu, rezerves kopiju, līgumu un personāla procesu konfigurācijas netika pārbaudītas ar administratīvu piekļuvi. PR #73 ir pārbaudīts, bet novērtējuma brīdī nav apvienots vai izvietots faktiskajā tuneļa izcelsmes serverī. Atkarību diagramma saglabā iepriekšējā pilnā audita bāzes līniju; jaunais CI pierāda tikai to, ka nav kritiska produkcijas atkarību paziņojuma pēc npm sliekšņa. Ziņojums jāatjauno pēc pirmās sekmīgās, ar SHA identificētās izcelsmes servera izvēršanas un Cloudflare noteikumu verifikācijas.`,
  },
];

const artifact = {
  surface: "report",
  manifest: {
    version: 1,
    surface: "report",
    title,
    description: "Prezentācijai paredzēts Atbalsts kiberdrošības novērtējums: esošās kontroles, atlikušās spraugas, programmatūras un cilvēkfaktora uzbrukuma vektori, produktu robežas un posmos sadalīta ceļakarte.",
    generatedAt,
    sources,
    blocks,
    charts: [attackChart, dependencyChart],
    tables,
  },
  snapshot: {
    version: 1,
    generatedAt,
    status: "ready",
    datasets,
  },
  sources,
  package_info: {
    reportLanguage: "lv",
    reportAudience: "product stakeholders",
    reportingQuestion: "Kā Atbalsts prezentācijā pamatoti parāda jau ieviesto drošību, atlikušos programmatūras un cilvēku riskus un drošu pāreju uz atsevišķiem produktiem?",
    decisionUsefulAnswer: "Prezentācijai jāizvieto PR #73 faktiskajā tuneļa izcelsmes serverī ar precīzu SHA, uzraudzītu procesu un pārbaudītu atgriešanās plānu, neveicot steidzamu Worker pārslēgšanu; perimetra noteikumi paliek domēna zonas īpašnieka darbā, bet kopīgā parole un Vite priekšskatījuma serveris ir skaidri jānosauc par demonstrācijas robežām. Personas datu un augstas ietekmes moduļi jāpalaiž tikai pēc identitātes, datu, atjaunošanas un reālas segmentācijas vārtiem.",
    requiredStructureMap: {
      title: "virsraksts",
      executiveSummary: "vadibas-kopsavilkums",
      findingsWithVisualEvidence: [
        "kontroles-ievads",
        "kontroles-bloks",
        "uzbrukumu-ievads",
        "uzbrukumu-diagramma",
        "programmat-bloks",
        "cilveku-bloks",
        "atkaribu-diagramma",
      ],
      recommendedNextSteps: ["celakarte", "celakartes-bloks"],
      furtherQuestions: "jautajumi",
      caveats: "ierobezojumi",
    },
    chartMap: [
      {
        section: "Uzbrukuma scenāriji un prioritātes",
        analyticalQuestion: "Kurā produkta posmā vajadzīgs katra scenārija primārais kontroles vārts?",
        family: "Comparison",
        chartType: "grouped bar",
        fields: ["termins", "veids", "skaits"],
        supportedClaim: "No 20 scenārijiem 8 galvenie vārti ir vajadzīgi pirms personas datu pilota, bet 4 — pirms prezentācijas.",
        palettePolicy: "type-based grouping",
        provenanceSource: "uzbrukumu-kopsavilkums-avots",
      },
      {
        section: "Atkarību ievainojamības jālabo pēc sasniedzamības",
        analyticalQuestion: "Cik iepriekšējā pilnā audita paziņojumu bija katrā smaguma pakāpē?",
        family: "Comparison",
        chartType: "bar",
        fields: ["smagums", "skaits"],
        supportedClaim: "Bāzes līnijā bija 9 paziņojumi — 6 augsti un 3 vidēji, bez kritiskiem.",
        palettePolicy: "single-root preferred",
        provenanceSource: "atkaribu-audits",
      },
    ],
    evidenceState: {
      mergedMain: false,
      deployedProduction: false,
      prCiPassed: true,
      cloudflareChanged: false,
      edgeProtectionChanged: false,
      liveOrigin: "cloudflare_tunnel_to_vite_preview",
      workerLiveOrigin: false,
      githubAdminSettingsChanged: false,
    },
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(outputPath);
