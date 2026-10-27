import { describe, expect, test } from "bun:test";
import { matchBallotName, samePerson, variants } from "../src/names";

describe("variants", () => {
  test("a nickname in parentheses or quotes gives the formal and the nickname forms", () => {
    expect(variants("Donald P. (Don) Wagner")).toEqual([
      "Donald P. (Don) Wagner",
      "Donald P. Wagner",
      "Don Wagner",
    ]);
    expect(variants('Nicholas "Nick" Schultz')).toContain("Nick Schultz");
    expect(variants("Jocelyn “Joz” Sida")).toContain("Joz Sida");
  });

  test("an apostrophe isn't a quote", () => {
    expect(variants("Shannon O’Brien")).toEqual(["Shannon O’Brien"]);
    expect(variants("Shannon O'Brien")).toEqual(["Shannon O'Brien"]);
  });
});

describe("samePerson", () => {
  test.each([
    ["Don Wagner", "Donald P. (Don) Wagner"],
    ["Nick Schultz", 'Nicholas "Nick" Schultz'],
    ["DJ Brookter", "Dionjay (DJ) Brookter"],
    ["D.J. Brookter", "DJ Brookter"],
    ["Shirley Weber", "Shirley N. Weber"],
    ["Ell Jennison", 'Ellsworth "Ell" M. Jennison, Jr.'],
    ["Joe Smith", "Joseph Smith"],
    ["José Pérez", "Jose Perez"],
    ["Danny Ivanov", "Daniel Ivanov"],
    ["Dan Ivanov", "Danny Ivanov"],
    ["Eddie de la Riva", "Eduardo De La Riva"],
    ["Johnny Yoder", "Johnathon Yoder"],
    ["Andy Gerken", "Andrew Gerken"],
    ["Jacqueline Elizalde", "Jacky Elizalde"],
  ])("%s = %s", (a, b) => {
    expect(samePerson(a, b)).toBe(true);
    expect(samePerson(b, a)).toBe(true);
  });

  test.each([
    ["Don Wagner", "Shirley N. Weber"],
    ["Mike Fong", "Long David Liu"],
    ["Wagner", "Donald P. (Don) Wagner"],
    ["Danny Ivanov", "Daniel Ivanova"],
    ["Pat Smith", "Peter Smith"],
  ])("%s ≠ %s", (a, b) => {
    expect(samePerson(a, b)).toBe(false);
  });
});

describe("matchBallotName", () => {
  const sos = ["Shirley N. Weber", "Donald P. (Don) Wagner"];

  test("an exact ballot name matches itself", () => {
    expect(matchBallotName("Shirley N. Weber", sos)).toEqual({
      name: "Shirley N. Weber",
      sure: true,
    });
  });

  test("the same person matches surely", () => {
    expect(matchBallotName("Don Wagner", sos)).toEqual({
      name: "Donald P. (Don) Wagner",
      sure: true,
    });
  });

  test.each([
    ["Andrae Gonzalez", ["Andrae Gonzales", "Saul Ayon"], "Andrae Gonzales"],
    ["Gerald Bourisquot", ["Gerald C. Boursiquot", "Carl DeMaio"], "Gerald C. Boursiquot"],
    ["Mano Raju", ["Manohar Raju"], "Manohar Raju"],
    ["David Liu", ["Mike Fong", "Long David Liu"], "Long David Liu"],
    [
      "Mesahl “Kash” Kashifalghita",
      ["Meshal Kashifalghita", "Richard Bowen"],
      "Meshal Kashifalghita",
    ],
    ["Chris Turnkey", ["Cindy Larae Hallman", "Christopher Trunkey"], "Christopher Trunkey"],
    ["Frederick Sykes", ["Fredrick Fred Sykes", "Tony Wu"], "Fredrick Fred Sykes"],
  ])("%s only resembles a ballot name: a suggestion, not sure", (choice, ballot, name) => {
    expect(matchBallotName(choice, ballot)).toEqual({ name, sure: false });
  });

  test("no match when nothing fits", () => {
    expect(matchBallotName("Jane Doe", sos)).toBeUndefined();
  });

  test("no match when two ballot names fit", () => {
    expect(matchBallotName("John Lee", ["John A. Lee", "John B. Lee"])).toBeUndefined();
    expect(matchBallotName("Pat Smith", ["Patricia Smith", "Patrick Smith"])).toBeUndefined();
  });
});
