# Atbalsts platformas kiberdrošības novērtējums

**Prezentācijas versija — 2026. gada 10. septembris**

## Vadības kopsavilkums

Atbalsts platformai jau ir pamatota drošības bāze: kritiskie lēmumi ir nodalīti no mākslīgā intelekta, publiskie dati tiek minimizēti, sensitīvās darbības tiek pārbaudītas serverī, bet izmaiņas pārbauda automatizēta CI darbplūsma. [PR #73](https://github.com/goofis11/palidzi/pull/73) papildus samazina publiskā API un veselības pārbaudes izpausto informāciju, pievieno repozitorija drošības kontroles un novērš nejaušu Cloudflare Worker izvēršanas sajaukšanu ar publiskās vides izlaidumu. [Jaunākā CI pārbaude](https://github.com/goofis11/palidzi/actions/runs/34499895675) ir sekmīga.

Svarīgākais jaunais secinājums: publisko domēnu pašlaik neapkalpo Cloudflare Worker. Pieprasījumi caur Cloudflare Tunnel nonāk lokālā Vite priekšskatījuma serverī. Tādēļ pirms prezentācijas nevajag steigā pārslēgt domēnu uz Worker. Drošākais ceļš ir izvērst apstiprināto `main` versiju faktiskajā tuneļa izcelsmes serverī, norādīt precīzu būvējuma SHA, uzraudzīt lietotnes un tuneļa procesus un pārbaudīt atgriešanos iepriekšējā versijā.

Kopīgā Centra parole šajā posmā var palikt kā skaidri nosaukts demonstrācijas ierobežojums. Arī Vite priekšskatījuma serveri drīkst saglabāt īslaicīgai prezentācijai, taču to nedrīkst raksturot kā gatavu produkcijas arhitektūru. Vite pats norāda, ka `vite preview` nav paredzēts kā produkcijas serveris.

## Pašreizējā arhitektūra

```text
Internets
   ↓
Cloudflare proxy
   ↓
Cloudflare Tunnel
   ↓
cloudflared uz lokālā hosta
   ↓
Vite priekšskatījuma serveris → platformas API un datu pakalpojumi

Cloudflare Worker eksistē atsevišķi, bet nav piesaistīts publiskajam domēnam.
```

Cloudflare Tunnel ir lietderīga robeža: savienojums tiek veidots no izcelsmes servera uz Cloudflare, tāpēc nav jāatver publisks ienākošais ports. Tas samazina tiešu izcelsmes servera ekspozīciju, bet neatrisina lokālā hosta aizsardzību, procesa uzraudzību, rezerves kopijas, izlaiduma izsekojamību vai pielāgotus WAF un pieprasījumu biežuma noteikumus. Skatīt [Cloudflare Tunnel dokumentāciju](https://developers.cloudflare.com/tunnel/) un [Vite izvietošanas dokumentāciju](https://vite.dev/guide/static-deploy).

## Kas jau ir ieviests

- Droši sesiju sīkfaili un tās pašas izcelsmes pārbaudes datu mainīšanas pieprasījumiem.
- Determinēta ārkārtas atbilde pirms ārējā MI modeļa izsaukuma.
- MI nav tiešu tiesību publicēt situācijas vai nosūtīt cilvēkus; galīgais lēmums paliek operatoram.
- Publiskajos brīvprātīgo sarakstos nav kontaktinformācijas, pilnas adreses vai precīzu koordinātu.
- Privātiem failiem ir īpašnieka, tipa un izmēra pārbaudes.
- Bezsaistes kešatmiņā netiek glabāti API, privātās lapas vai vaicājumu URL.
- Situācijas publicēšana ir versēta, atomāra un idempotenta; novecojis labojums saņem konfliktu.
- Maksas datu atsvaidzināšana nav pieejama anonīmam lietotājam; anonīms pieprasījums saņem `401`.
- Lietotnes līmenī jau darbojas vairāki pieprasījumu biežuma un atkārtotu atbilžu ierobežojumi.
- Mācību dati ir marķēti un centralizēti izslēdzami vai notīrāmi.

PR #73 pievieno:

- atļauto lauku publisko notikumu projekciju, kas neizpauž operatora identitāti un iekšējos metadatus;
- minimālu publisko `/api/health` atbildi ar `ok` un būvējuma SHA;
- pilnu diagnostiku tikai autentificētā `/api/center/health` maršrutā;
- Dependabot, `CODEOWNERS`, kritisku produkcijas atkarību CI vārtus un plašāku noslēpumu paraugu pārbaudi;
- manuālu un nepārprotami apstiprināmu Worker pārslēgšanas darbplūsmu automātiskas izvēršanas vietā.

## Kas jāizdara pirms prezentācijas

1. Apvienot PR #73 tikai pēc sekmīgās CI pārbaudes.
2. Faktiskajā tuneļa izcelsmes serverī izvērst precīzu apstiprinātā `main` komita SHA.
3. Iestatīt `ATBALSTS_BUILD_SHA`, lai publiskā veselības pārbaude identificētu tieši izvērsto versiju.
4. Darbināt gan lietotni, gan `cloudflared` ar procesa uzraudzību un automātisku atjaunošanu pēc kļūmes vai hosta restartēšanas.
5. Izmēģināt atgriešanos iepriekšējā zināmi labajā versijā.
6. Anonīmi pārbaudīt sākumlapu, galvenās sadaļas, minimālo `/api/health`, publisko notikumu API un aizsargāto datu atsvaidzināšanas maršrutu.
7. Dokumentēt Cloudflare perimetra noteikumu un GitHub galvenā zara aizsardzības īpašnieku un izpildes termiņu, ja administratīvās tiesības vēl nav pieejamas.

Pirms prezentācijas nav nepieciešams mainīt kopīgo paroli, veikt Worker pārslēgšanu, pabeigt pilnu identitātes sistēmu vai pārbūvēt visu platformu atsevišķos servisos.

## Kā par to runāt prezentācijā

| Tēma | Pamatots formulējums |
|---|---|
| Publiskie dati | “Publiskajā API izmantojam pārskatītu atļauto lauku sarakstu, nevis publicējam iekšējo datu objektu.” |
| Diagnostika | “Publiski atklājam tikai darbspēju un izlaiduma identitāti; detalizētā diagnostika ir operatora zonā.” |
| MI | “MI sniedz ieteikumu, bet nevar pats publicēt kritisku informāciju vai nosūtīt cilvēkus.” |
| Kopīgā parole | “Tā ir apzināta demonstrācijas robeža; pirms reāla operatoru pilota paredzēti individuāli konti, MFA un sesiju atsaukšana.” |
| Pašreizējā izpildvide | “Prezentācijas vide darbojas aiz Cloudflare Tunnel; priekšskatījuma serveris ir īslaicīgs un ir iekļauts nomaiņas ceļakartē.” |
| Cloudflare aizsardzība | “Lietotnes līmeņa limiti jau darbojas; pielāgoti domēna zonas WAF un perimetra limiti ir atsevišķs īpašnieka darbs.” |
| Atbilstība | “Izmantojam standartus kā prasību un pārbaudes ietvaru; neapgalvojam sertifikāciju vai juridisku atbilstību bez audita.” |

Nevajag apgalvot, ka Worker jau ir publiskā izcelsme, ka pielāgoti Cloudflare WAF noteikumi jau darbojas, ka `vite preview` ir produkcijas serveris vai ka platforma jau ir ISO 27001 sertificēta.

## Būtiskākie uzbrukuma vektori

### Programmatūras riski

- Publiskā API skrāpēšana un iekšējo metadatu izguve.
- Izkliedēti pieprasījumu plūdi, brutāls spēks un maksas ārējo pakalpojumu izmaksu izsmelšana.
- Nepareizās izpildvides izvēršana vai nespēja pierādīt, kura versija darbojas publiski.
- Sesijas zādzība un atkārtota izmantošana.
- Promptu injekcija un ārējo datu saindēšana.
- Ļaunprātīgi vai aktīvi augšupielādēti faili.
- Misiju tiesību apiešana un nedroša cilvēku nosūtīšana.
- Kompromitēts ārējais datu avots vai novecojuši dati.
- Pārāk plašas datubāzes un servisa kontu tiesības.
- Ievainojama programmatūras piegādes ķēde.

### Cilvēku un procesa riski

- Pikšķerēšana un piekļuves datu izkrāpšana.
- Kopīgu akreditācijas datu ļaunprātīga izmantošana un nepietiekama darbību attiecināmība.
- Nozaudēta vai neaizsargāta operatora ierīce.
- Iekšēja ļaunprātība vai kļūdains augstas ietekmes lēmums.
- Uzdošanās par piegādātāju, datu avotu vai sadarbības partneri.
- Operatoru nogurums un steiga krīzes laikā.
- Baumu un maldinošas informācijas pastiprināšana.
- Nepārbaudīts incidentu, rezerves kopiju un darbības atjaunošanas process.

## Produktu nodalīšanas princips

Ilglaicīgi koda zari nav drošības robeža, jo drošības labojumi var novirzīties un netikt ieviesti visās versijās. Ieteicams saglabāt kopīgu kodu bāzi, bet augstāka riska moduļus izvērst atsevišķi ar savām atslēgām, datubāzes lomām un kļūmes zonām.

Droša ieviešanas secība:

1. Publiska, tikai lasāma gatavības informācija un karte.
2. Iedzīvotāju ziņojumu iesniegšana atsevišķā neuzticamas ievades zonā.
3. Privāts vadības centrs ar individuālu identitāti un auditu.
4. Brīvprātīgo misijas kā atsevišķs augstas ietekmes modulis ar kompetenču un bīstamības vārtiem.
5. MI starpslānis ar minimizētu kontekstu un bez publicēšanas tiesībām.

Funkcionalitātes slēdzis palīdz paslēpt nepabeigtu iespēju, bet par īstu drošības robežu tas kļūst tikai tad, ja ir nodalītas atslēgas un datu tiesības.

## Atbilstības un standartu ceļš

- [VDAR](https://eur-lex.europa.eu/legal-content/LV/TXT/?uri=CELEX:32016R0679) ir tūlītēji būtisks, tiklīdz tiek apstrādāti reālu personu dati. Nepieciešama datu karte, nolūki, tiesiskais pamats, glabāšanas termiņi, piekļuves kārtība un vajadzības gadījumā novērtējums par ietekmi uz datu aizsardzību.
- [Nacionālā kiberdrošības likuma](https://likumi.lv/ta/id/353390-nacionalas-kiberdrosibas-likums), NIS2 un [MK noteikumu Nr. 397](https://likumi.lv/ta/id/361481-minimalas-kiberdrosibas-prasibas) piemērojamība jānosaka pēc platformas operatora, klienta, nozares un pakalpojuma lomas.
- [ES Kibernoturības akts](https://digital-strategy.ec.europa.eu/en/policies/cra-summary) jāizvērtē katram tirgū laistam digitālam produktam vai modulim.
- [ES Mākslīgā intelekta akta](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) prasības ir atkarīgas no MI funkcijas. Pašreizējā padomdevēja loma ar cilvēka lēmumu ir drošāka nekā automātiska triāža vai nosūtīšana.
- [NIST CSF 2.0](https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20) ir piemērots drošības pārvaldības ietvars, bet [OWASP ASVS 5](https://owasp.org/www-project-application-security-verification-standard/) — praktisku tīmekļa lietotnes prasību un pieņemšanas kritēriju avots.
- ISO/IEC 27001 ir organizācijas vadības sistēmas projekts. Sertifikāciju ir lietderīgi sākt tad, kad to prasa klienti vai iepirkumi, nevis izmantot kā ātru produkta marķējumu.

## Ceļakarte

**Pirms prezentācijas:** apvienot un izvērst PR #73 faktiskajā tuneļa izcelsmes serverī; pierādīt SHA, minimālo publisko API, procesa atjaunošanos un atgriešanās plānu. Cloudflare un GitHub administratora darbi paliek ar skaidru īpašnieku un termiņu.

**0–30 dienas / pirms personas datu pilota:** aizstāt Vite priekšskatījuma serveri ar atbalstītu produkcijas izpildvidi vai pirmsražošanas vidē pārbaudīt Worker migrāciju; ieviest individuālus kontus, MFA, sesiju atsaukšanu, datu dzīves ciklu, centralizētu ļaunprātīgas izmantošanas kontroli, atjaunošanas testu un incidentu rīcības plānu.

**31–90 dienas:** nodalīt publisko saturu, neuzticamu ievadi, vadības centru, personas datu glabātuvi, auditu un MI starpslāni; ieviest minimālas datubāzes lomas, failu karantīnu, misiju drošības vārtus un pret manipulācijām pārbaudāmu auditu.

**3–12 mēneši:** neatkarīgs ielaušanās tests, incidentu un darbības atjaunošanas mācības, juridiskās piemērojamības dokumenti un — ja tirgus to prasa — ISO 27001 ieviešana vai sertifikācija.

## Novērtējuma robežas

Šis ir avota koda, arhitektūras, CI/CD un publiski novērojamās virsmas novērtējums. Tas nav ielaušanās tests, juridisks atzinums, VDAR audits, ISO audits vai sociālās inženierijas pārbaude. Tuneļa un Worker topoloģija balstās pilnvarotā Cloudflare aģenta inventarizācijā; publiski tika neatkarīgi apstiprināta plašā `/api/health` atbilde, `build: unknown`, dinamiska kešatmiņas apstrāde un atšķirīgs aktīvais būvējums. PR #73 novērtējuma brīdī vēl nav apvienots vai izvietots faktiskajā izcelsmes serverī. Ziņojums jāatjauno pēc pirmās sekmīgās, ar SHA identificētās izvēršanas un Cloudflare noteikumu verifikācijas.
