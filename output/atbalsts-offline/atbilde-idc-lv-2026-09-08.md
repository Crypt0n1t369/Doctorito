# Atbildes projekts Iekšlietu digitālajam centram

Sagatavots 2026. gada 8. septembrī. Pārskatāms melnraksts; nav nosūtīts.

Labdien, Artūr!

Paldies par jautājumiem. Prezentācijas sadaļa “Līmenis 3” apraksta iecerēto attīstības virzienu. Tās formulējumus nepieciešams precizēt, nošķirot pašreizējo tīmekļa platformu no vēl izstrādājamās un pārbaudāmās bezsakaru funkcionalitātes.

Mūsu ieteiktais risinājums ir lietotne ar iepriekš saglabātiem datiem, nelieli digitāli parakstīti atjauninājumi un vairāki to piegādes ceļi. Drošai darbībai būtiskākais ir skaidri noteikt, kurš drīkst publicēt oficiālu informāciju, kā tā tiek pārbaudīta telefonā un kā lietotājam tiek parādīts tās aktualitātes un piegādes statuss.

Pašreizējā koda pārskatā ir konstatēta sagatavotības materiālu bezsaistes saglabāšana, bet nav pilnas bezsaistes kartes vai šeit aprakstītās radio/P2P piegādes. Tam nepieciešams izstrādāt telefonā instalējamu lietotnes daļu ar vietējo datu glabātuvi un sakaru saskarnēm.

**Radio tehnoloģija un uztveršana.** Pilotam piedāvājam atsevišķas LoRa radioierīces Latvijas frekvenču izmantošanas nosacījumiem atbilstošā konfigurācijā. Parasts iPhone vai Android telefons pats LoRa signālu neuztver. Telefons sazinātos ar ārēju ierīci, izmantojot Bluetooth LE, vai ar koplietošanas datu mezglu, izmantojot vietējo Wi-Fi. Šim Wi-Fi savienojumam internets nav nepieciešams.

Prezentācijā norādītie aptuveni 10–30 bit/s nav jāinterpretē kā Atbalsts prototipā apstiprināts mērījums. LoRa nominālais pārraides ātrums un lietotnei faktiski piegādātais datu ātrums ir atšķirīgi lielumi. Rezultātu ietekmē radioiestatījumi, atļautais raidīšanas laiks, ziņojuma izmērs, atkārtojumi, traucējumi un retranslatori. Pilotā būtu jāmēra pilna, pārbaudīta ziņojuma piegādes laiks abos virzienos.

**Dati radio skaņā.** Kā papildu saņemšanas ceļu var pārbaudīt dzirdamu modema toņu pārraidīšanu radio programmas skaņā. Radio uztvērējs saņemtu apraidi, bet atvērta lietotne ar telefona mikrofonu uztvertu skaņu, atkodētu datus un pārbaudītu parakstu. Šāda principa piemērs ir [TIVAR](https://sourceforge.net/projects/tivar/). Tas vēl neapstiprina mūsu risinājuma uzticamību dažādos mūsdienu telefonos. Gandrīz ultraskaņas signālu pārraide parastā FM apraidē nebūtu pamata izvēle. Šis apraides ceļš ir vienvirziena; atbildei vajadzīgs cits savienojums.

**Informācijas saturs un karte.** Pa šauro radio kanālu paredzētu pārraidīt notikuma identifikatoru, versiju, laiku, teritoriju vai koordinātas, apdraudējuma līmeni, rīcības kodu, nelielu papildu tekstu un digitālo parakstu. Karte, instrukcijas un pamatobjekti tiktu saglabāti telefonā iepriekš. Ar radio varētu pievienot arī jaunu resursu punktu, mainīt tā statusu vai attēlot vienkāršu apdraudējuma zonu.

Attēlus un video pa šo kanālu nepiedāvājam pārsūtīt. Piemēram, pat 100 kB attēls pie 10–30 bit/s prasītu aptuveni 7–22 stundas ideālas nepārtrauktas pārraides. Pielikumus varētu glabāt telefonā un vēlāk nodot pa vietējo Wi-Fi vai augšupielādēt pēc savienojuma atjaunošanās. Precīzs bezsaistes kartes apjoms jānosaka pēc datu un detalizācijas izvēles; sākotnējais plānošanas diapazons detalizētai vektorkartei ir daži simti megabaitu.

**P2P un darbība fonā.** Lietotnes varētu apmainīties ar trūkstošajiem ziņojumiem, kad ierīces atrodas tuvumā. A nodotu ziņojumu B, savukārt B vēlāk to nodotu C. Pirmajai versijai paredzētu lietotāja aktivizētu apmaiņu ar atvērtu lietotni. Nevaram solīt nepārtrauktu automātisku retranslāciju visos iPhone: operētājsistēma ierobežo darbību fonā, un iespējas atšķiras atkarībā no izmantotās tehnoloģijas. [Apple skaidrojums par Bluetooth darbību fonā](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html).

Pastāvīgai datu uzkrāšanai un nodošanai izmantotu īpašus mezglus ar nodrošinātu barošanu. Ziņojumu identifikatori, versijas, derīguma nosacījumi, saņemto datu uzskaite un pārraides ierobežojumi novērstu normālu ierīču bezgalīgu atkārtošanu. Beidzies aktualitātes termiņš nenozīmētu “apdraudējums beidzies”; lietotne parādītu, ka jaunākais stāvoklis nav zināms.

**Drošība un iedzīvotāju ziņojumi.** Oficiālus paziņojumus parakstītu tikai pilnvarots izdevējs. Telefoni un parastie datu mezgli saņemtu pārbaudes atslēgas, nevis tiesības izveidot oficiālus paziņojumus. Tādēļ kompromitēts retranslators pats nevarētu radīt derīgi parakstītu viltus trauksmi. Tas gan varētu aizturēt datus vai traucēt piegādi; pret to nepieciešami alternatīvi ceļi, pārraides ierobežojumi un uzraudzība.

Iedzīvotāja palīdzības pieprasījumu varētu šifrēt telefonā saņēmējam centrā. Starpniekierīces pārvadātu šifrētu saturu. Mobilais mezgls mugursomā vai transportlīdzeklī varētu apvienot radio uztvērēju, vietējo piekļuves punktu, glabātuvi un retranslatoru, kā arī vēlāk nogādāt savāktos datus serverī.

Lietotnē atsevišķi parādītu “saglabāts telefonā”, “nodots starpniekierīcei”, “saņemts centrā” un “izskatīts”. Nodošana tuvākajam mezglam pati par sevi neapstiprina pieprasījuma saņemšanu vai palīdzības nosūtīšanu.

**Pārklājums un pilotprojekts.** Viena mezgla rādiusu un vienlaikus apkalpojamo lietotāju skaitu var noteikt tikai konkrētai konfigurācijai un videi. Sākotnējai plānošanai starp LoRa ierīcēm var izmantot aptuveni 0,5–2 km sarežģītā pilsētvidē un 3–10 km laukos, bet šie nav izmērīti vai garantēti lielumi. Telefona savienojuma attālums līdz vietējam Wi-Fi/Bluetooth mezglam ir ievērojami mazāks.

Vispirms piedāvātu pārbaudīt vienu pašvaldību un konkrētus informācijas saņemšanas punktus. Nelielam demonstratoram ar sešām radioierīcēm, diviem datu mezgliem un aizlienētiem telefoniem aprīkojuma un lauka darbu plānošanas izmaksas būtu aptuveni 1 200–2 200 EUR bez PVN. Atsevišķi jāparedz lietotnes un protokola izstrāde: sākotnēji aptuveni 25–50 izstrādes cilvēkdienas. Tas vēl nebūtu publiskai operatīvai izmantošanai gatavs dienests.

Pilotā demonstrētu pilnu ķēdi: pilnvarots izdevējs izveido paziņojumu → radio → datu mezgls → telefons → notikums bezsaistes kartē → otrs telefons → iedzīvotāja pieprasījums → serveris → atpakaļ piegādāts saņemšanas apliecinājums. Paralēli pārbaudītu sakaru zudumu, atkārtotus un viltotus ziņojumus, darbību fonā, slodzi un rezerves barošanu.

Latvijas mērogā vispirms izvērtētu esošo apraidi un infrastruktūru, neatkarīgi pieslēgtus reģionālos mezglus un vietējos piekļuves punktus. Valsts mēroga pakalpojuma pieejamība būtu jānošķir no nepārtraukta radio pārklājuma katram telefonam. Pilnīgi izolētam vietējam tīklam jauni valsts līmeņa paziņojumi nevar piekļūt bez neatkarīga sakaru ceļa vai fiziskas datu nogādāšanas. Vietējo paziņojumu izveidei arī bez mākoņpakalpojumiem būtu vajadzīgs iepriekš pilnvarots pašvaldības izdevējs un atbilstoša atslēgu pārvaldība.

**ePPO atsauce.** To precizētu kā piemēru iedzīvotāju novērojumu nodošanai atbildīgajām institūcijām. Pārskatītie publiskie avoti neapstiprina prezentācijas apgalvojumu par video publicēšanu vai mūsu piedāvāto LoRa/P2P arhitektūru. Šos apgalvojumus no prezentācijas būtu jāizņem, kamēr nav atbilstoša pamatojuma. [ePPO oficiālā vietne](https://eppoua.com/), [izstrādātāja lietotnes apraksts](https://play.google.com/store/apps/details?hl=en&id=ua.quick.brpg.pathfinder).

Turpmākā sadarbībā būtu vērtīgi vienoties par pilotvietu, pilnvaroto informācijas izdevēju, pieejamo infrastruktūru un izmērāmiem piegādes kritērijiem. Tas ļautu pieņemt nākamos lēmumus, balstoties faktiskos rezultātos.
