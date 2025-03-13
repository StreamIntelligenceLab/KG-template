// index.mjs
import { jsonLdToNTriples, quadsToTurtle, runEyeReasoner, runSparqlQuery } from './helpers.js';

import { parseTurtle } from '@comake/rmlmapper-js';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const yarrrmlParserModule = require('@rmlio/yarrrml-parser/lib/rml-generator');
const YarrrmlParser = yarrrmlParserModule.default || yarrrmlParserModule;

// Create an instance of the YARRRML parser
const yarrrmlParserInstance = new YarrrmlParser();

/* 
  YARRRML mapping to reference medication.csv
*/
const mappingYARRRML = `
prefixes:
  rr: http://www.w3.org/ns/r2rml#
  foaf: http://xmlns.com/foaf/0.1/
  xsd: http://www.w3.org/2001/XMLSchema#
  rdfs: http://www.w3.org/2000/01/rdf-schema#
  dc: http://purl.org/dc/elements/1.1/
  rev: http://purl.org/stuff/rev#
  gtfs: http://vocab.gtfs.org/terms#
  geo: http://www.w3.org/2003/01/geo/wgs84_pos#
  schema: http://schema.org/
  dct: http://purl.org/dc/terms/
  rml: http://semweb.mmlab.be/ns/rml#
  ql: http://semweb.mmlab.be/ns/ql#
  rdf: http://www.w3.org/1999/02/22-rdf-syntax-ns#
  tv: http://televic.health.be/ontology/

mappings:
  calls:
    sources:
      - [calls.csv~csv]
    s: http://televic.health.be/calls/$(id)
    po:
      - [a, tv:Call]
      - [tv:hasID, $(id)]
      - [tv:priority, $(priority), xsd:integer]
      - [tv:hasTimeStamp, $(timestamp), xsd:dateTime]
      - [tv:callMadeBy,http://televic.health.be/rooms/$(source)~iri]
`;

// Define simple reasoning rules in N3 syntax
const rules = `
@prefix ex: <http://example.com/>.
@prefix schema: <http://schema.org/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix tv: <http://televic.health.be/ontology/>.
@prefix log: <http://www.w3.org/2000/10/swap/log#>.
@prefix math: <http://www.w3.org/2000/10/swap/math#>.


#  Classification based on priority
{ ?call a tv:Call. ?call tv:priority ?priority. ?priority math:greaterThan 1.} => { ?call a tv:HighPriorityCall. }.


`;


    // Advanced query that shows different medications with their statistics
const sparqlQuery = `
      PREFIX ex: <http://example.com/>
      PREFIX schema: <http://schema.org/>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX tv: <http://televic.health.be/ontology/>
      
      SELECT ?call ?source ?priority
      WHERE {
        ?call a tv:HighPriorityCall.
        ?call tv:priority ?priority.
        ?call tv:callMadeBy ?source.
      }
      
    `;




// Main execution
async function main() {
  try {
    // Convert the YARRRML mapping to RML (as an array of quads)
    console.log("Converting YARRRML mapping to RML mapping...");
    const rmlMappingQuads = await yarrrmlParserInstance.convert(mappingYARRRML);


    // Serialize the array of quads to a Turtle string
    const rmlMapping = await quadsToTurtle(rmlMappingQuads);

    // Read the CSV file
    const csvData = fs.readFileSync('./calls.csv', 'utf8');
    const inputFiles = { 'calls.csv': csvData };
    const options = { toRDF: false }; // Output as JSON-LD

    console.log("Running RML mapping with rmlmapper-js using the converted YARRRML schema...");
    const jsonLdResult = await parseTurtle(rmlMapping, inputFiles, options);

    // Convert JSON-LD to N-Triples for reasoning and SPARQL querying
    const triples = await jsonLdToNTriples(jsonLdResult);
    fs.writeFileSync('results.nt', triples, 'utf8');
    console.log("N-Triples mapping saved to results.nt");

    let useReasoningResults = true;

    // Run reasoning and SPARQL queries
    let reasoning_results = await runEyeReasoner(triples, rules);
    await runSparqlQuery(triples,sparqlQuery, reasoning_results, useReasoningResults);

  } catch (error) {
    console.error("An error occurred:", error);
    console.error(error.stack);
  }
}

main();
