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
}

export const COUNTY_DRAWINGS_2026: Record<string, CountyDrawing> = {
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
  "San Mateo": {
    alphabet: "UGKXWBYTFMDHSNVJPICREQZALO",
    source:
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
};
