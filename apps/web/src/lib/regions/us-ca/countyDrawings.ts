/**
 * Each California county's own randomized alphabet for the November 3, 2026
 * election (Elections Code §13111(i)): it orders the State Senate and
 * Assembly candidates on that county's ballots when the district reaches
 * more than one county. `local`: the county says its drawing also orders its
 * local contests; otherwise they use the Secretary of State's. Gathered from
 * each county's elections office on 2026-11-02; plans/ballot-order.md lists
 * the counties we looked for and couldn't find. A county missing here: we
 * couldn't find its drawing.
 */
export interface CountyDrawing {
  /** The 26 letters as drawn, first first. */
  alphabet: string;
  /** Where the county published it. */
  source: string;
  /** The county's drawing orders its local contests too. */
  local?: boolean;
  /**
   * The county's local measures by letter, in the order its ballot prints
   * them (`ballotSequence.ts`), where it publishes that order: San Mateo's is
   * neither by letter nor by contest code.
   */
  measures?: string[];
  /** Where the measure order comes from. */
  measuresSource?: string;
}

export const COUNTY_DRAWINGS_2026: Record<string, CountyDrawing> = {
  Alameda: {
    alphabet: "BOXPYDLHGVURMIKWCNEJTQZFSA",
    source:
      "https://acvote.alamedacountyca.gov/acvote-assets/02_election_information/PDFs/20261103/Random%20Alpha/countyrandomalphanov2026.pdf",
  },
  Amador: {
    alphabet: "UPOTMNGEHQFLJBIRCZVAXKWYSD",
    source: "https://www.amadorcounty.gov/home/showpublisheddocument/58744/639222350446600000",
  },
  Butte: {
    alphabet: "LDWABTOKFJSPCMVYZEIUHXNQGR",
    source: "https://buttevotes.net/DocumentCenter/View/4196/RandomAlphaNovemberGeneral2026",
  },
  Colusa: {
    alphabet: "TNOFVRUJGIQPMKYWHXEZDBSACL",
    source: "https://www.countyofcolusaca.gov/DocumentCenter/View/20488/doc10254620260813110723",
  },
  "El Dorado": {
    alphabet: "FAWNPUQCDYTJOREKXIVMBSZLGH",
    source:
      "https://www.eldoradocounty.ca.gov/files/assets/county/v/1/documents/government/elections/20261103/candidate-information/local-random-alpha-draw-20260813.pdf",
  },
  Fresno: {
    alphabet: "CTQJVNKMOLZXDABWYHEGRIFSPU",
    source:
      "https://www.fresnocountyca.gov/files/sharedassets/county/v/1/county-clerk-registrar-of-voters/1_election-pages/2026_3_nov_statewide-general/important-information/final-fresno-county-random-alphabet-sheet-for-11-3-2026-election.pdf",
  },
  Kern: {
    alphabet: "GMQVDKWNYHLRFATOBSIJXCZUPE",
    source: "https://www.kernvote.com/home/showpublisheddocument/26002/639222280633630000",
  },
  Kings: {
    alphabet: "PZEWYHGCJTNKMDQXSUFVOALBIR",
    source: "https://www.countyofkingsca.gov/home/showpublisheddocument/41794/639239562167530000",
  },
  Lassen: {
    alphabet: "WVRXBZKDAFYOIENUHGSCPTQJLM",
    source: "https://www.lassencounty.gov/DocumentCenter/View/3169",
  },
  "Los Angeles": {
    alphabet: "EACPTOFWHGNMDZXLQIKBURJVSY",
    source: "https://content.lavote.gov/docs/rrcc/documents/randomized-alphabet-drawing.pdf",
  },
  Madera: {
    alphabet: "CNAQTMOBEYJFRWDGVKPIZHULXS",
    source:
      "https://votemadera.com/wp-content/uploads/2026/08/County-of-Madera-Randomized-Alphabet-Drawing-Results-PDF.pdf",
  },
  Merced: {
    alphabet: "QYBHKASJFUODIMPWTZCGEXVRLN",
    source:
      "https://www.countyofmerced.com/DocumentCenter/View/53582/November-3-2026-General-Election-Merced-County-Randomized-Alphabet-Draw",
  },
  Monterey: {
    alphabet: "HSIFCUDGAXNYTPELMZJRWOQVKB",
    source: "https://www.countyofmonterey.gov/home/showpublisheddocument/147819/639222921661030000",
  },
  Nevada: {
    alphabet: "ARJKYNLPGDMEVFIQBSHTCZXOWU",
    source: "https://www.nevadacountyca.gov/CivicAlerts.aspx?AID=8876",
  },
  Orange: {
    alphabet: "KOTZCFNAJPHBIMDQLXSGVWYEUR",
    source: "https://ocvote.gov/sites/default/files/2026-08/RANDOM%20DRAW_COUNTY%2011.3.26.pdf",
  },
  Placer: {
    alphabet: "IDRVTCXMHWYUJAQSBGLKPENFZO",
    source:
      "https://placercountyelections.gov/Uploads/documents/11032026/11032026_County_Random_Alpha_Draw.pdf",
  },
  Riverside: {
    alphabet: "OEAJHNQCBKPMZFRYTGWUSIXVDL",
    source:
      "https://voteinfo.net/sites/g/files/aldnop371/files/2026-08/Random%20Draw%20for%20WEB.pdf",
  },
  Sacramento: {
    alphabet: "YPJNFAZQOIHRCDWSTMBUXKGLEV",
    source:
      "https://elections.saccounty.gov/us/en/campaign-services/sacramento-county-randomized-alphabet-drawing---november-2026.html",
  },
  "San Benito": {
    alphabet: "QZDFHCOWPUXKLMSJBAEVNIGTYR",
    source:
      "https://www.sanbenitocounty-ca-cre.gov/home/showpublisheddocument/16091/639222161451730000",
  },
  "San Bernardino": {
    alphabet: "LFVRNJAPOEUCQYKGIWBTHSDMXZ",
    source:
      "https://uploads.rov.sbcounty.gov/ROV/News/2026/1103/PublicNotice_RandomizedAlphabetDraw.pdf",
  },
  "San Francisco": {
    alphabet: "XZRKYUCPFIWDOGBENHQSVAJMLT",
    source:
      "https://www.sf.gov/news-the-san-francisco-department-of-elections-conducts-drawing-of-randomized-alphabet-for-listing-candidates-for-state-assembly-district-19-in-the-november-3-2026-consolidated-general-election",
  },
  "San Joaquin": {
    alphabet: "IOTERAYMKCUGXVWSPZHQBNJDFL",
    source:
      "https://www.sjgov.org/docs/default-source/registrar-of-voters-documents/elections/gubernatorial-general-election-2026/current-election/county-random-alphabet-11.3.26.pdf",
  },
  "San Luis Obispo": {
    alphabet: "LGWHKBYJUXMPDTCZFSQAENVOIR",
    source:
      "https://slocounty.ca.gov/departments/clerk-recorder/forms-documents/elections-and-voting/current-elections/2026-11-04/slo-county-random-alphabet-draw-8-13-26",
  },
  "San Mateo": {
    alphabet: "UGKXWBYTFMDHSNVJPICREQZALO",
    source:
      "https://smcacre.gov/system/files/2026-08/52_November%202026%20Random%20Alpha%20Drawing_Redacted.pdf",
    // The same document lists every measure with its letter: school district
    // measures, then county, then city. A San Mateo County voter's ballot
    // (2026-11-03) printed V, then L, AA, J, U, as listed here.
    measures: [
      ...["R", "Z", "M", "T", "K", "V", "W"],
      ...["L", "AA", "J", "U"],
      ...["H", "F", "Y", "X", "D", "O", "CC", "I", "Q", "P", "BB", "N", "E", "S", "DD", "EE", "G"],
    ],
    measuresSource:
      "https://smcacre.gov/system/files/2026-08/52_November%202026%20Random%20Alpha%20Drawing_Redacted.pdf",
  },
  "Santa Clara": {
    alphabet: "JKTDPXIASRLYMUBCWFQZVNGHEO",
    source: "https://files.santaclaracounty.gov/exjcpb1296/2026-08/rad_august13-2026.pdf",
  },
  Solano: {
    alphabet: "JWNGQBARCDZVEPHOYFLSMTXUKI",
    source:
      "https://content.solanocounty.gov/sites/default/files/2026-08/Results_of_Randomized_Alphabet_Drawing_11032026.pdf",
  },
  Stanislaus: {
    alphabet: "ZIWBVJEANTFCMUPHDGXYSKQORL",
    source: "https://stanvote.gov/pdf/GENERICPlacementHolder-RandomDrawWebsiteBi-Lingual.pdf",
  },
  Tehama: {
    alphabet: "LXHAKJCMWPVTBZFENSOUYIQRGD",
    source: "https://www.tehama.gov/wp-content/uploads/2026/08/Random-Alpha-Drawing-Results.pdf",
  },
  Tulare: {
    alphabet: "OCFHNUMEYTZRKIVDWAPBQXGJSL",
    source: "https://tularecounty.ca.gov/elections/randomized-alphabet-drawing-results",
  },
  Tuolumne: {
    alphabet: "ZAMWICHXLYNBVPGKETFRUJDOSQ",
    source: "https://www.tuolumnecounty.ca.gov/DocumentCenter/View/31582",
  },
  Yolo: {
    alphabet: "NHDOGXBWFVKZJPEQCYIRALUSMT",
    source: "https://ace.yolocounty.gov/410/Randomized-Alphabet-Drawing-Results",
  },
};
