#!/usr/bin/env bun
// Most slates were read by a person or a model, so no pure extractor can rebuild them. What can be
// checked objectively is whether each position's statement and choice are really in the raw text.
//
//   bun experiments/signed-source-capture/07-anchor-positions.ts <dir> <positions.json>
//
// <dir> is a capture bundle whose first capture carried the text. Prints the unanchored positions:
// those are the ones a human should look at, and the tool makes no claim about why.

import { readFileSync } from "node:fs";
import { getRaw, type Manifest } from "./lib/bundle";
import { decodeBody, parseResponse } from "./lib/capture";
import { anchorStatement, comparable, htmlText } from "./lib/text";

const [dir, positionsFile] = process.argv.slice(2);
if (!dir || !positionsFile) throw new Error("usage: 07-anchor-positions.ts <dir> <positions.json>");

const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as Manifest;
const hop = manifest.captures[0]?.hops.at(-1);
if (!hop) throw new Error("no capture");
const decoded = decodeBody(parseResponse(getRaw(dir, hop.response_sha256)));
const source = comparable(htmlText(decoded.toString("utf8")));
console.log(`source text: ${source.length} comparable characters, from ${hop.url}\n`);

interface Position {
  choice?: string;
  statement?: string;
  subject: { title: string };
}
const { positions } = JSON.parse(readFileSync(positionsFile, "utf8")) as { positions: Position[] };
const counts = { exact: 0, "quoted-parts": 0, unanchored: 0, "no statement": 0 };
const choiceWords = { found: 0, missing: 0 };
const misses: string[] = [];
for (const position of positions) {
  const anchor = position.statement ? anchorStatement(position.statement, source) : "no statement";
  counts[anchor]++;
  if (anchor === "unanchored") misses.push(`${position.subject.title}: ${position.statement}`);
  if (position.choice) {
    const word = comparable(position.choice)
      .split(" ")
      .filter((w) => w.length >= 3)
      .at(-1);
    if (word && ` ${source} `.includes(` ${word} `)) choiceWords.found++;
    else choiceWords.missing++;
  }
}
console.log(`${positions.length} positions`);
console.log("statements:", counts);
console.log("choice surnames in the source:", choiceWords);
if (misses.length) console.log("\nFor a human to look at:", misses.slice(0, 8));
