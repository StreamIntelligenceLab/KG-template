// index.mjs
import fs from 'fs';
import { parseTurtle } from '@comake/rmlmapper-js';
import { n3reasoner } from 'eyereasoner';
import { QueryEngine } from '@comunica/query-sparql';
import * as N3 from 'n3';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const yarrrmlParserModule = require('@rmlio/yarrrml-parser/lib/rml-generator');
const YarrrmlParser = yarrrmlParserModule.default || yarrrmlParserModule;

// Create an instance of the YARRRML parser
const yarrrmlParserInstance = new YarrrmlParser();

/* 
  YARRRML mapping to reference medication.csv
*/
const pharmaMappingYARRRML = `
prefixes:
  ex: http://example.com/
  schema: http://schema.org/
  xsd: http://www.w3.org/2001/XMLSchema#
mappings:
  medication:
    sources:
      - ['medication.csv~csv']
    s: ex:medication_$(artikel___ATC___label)
    po:
      - [a, ex:Medication]
      - [schema:identifier, $(artikel___ATC___label)]
      - [ex:date, $(begin_date)]
      - [ex:room, $(room)]
`;

// Define simple reasoning rules in N3 syntax
const rules = `
@prefix ex: <http://example.com/>.
@prefix schema: <http://schema.org/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.

# Basic classification of all medications
{ ?med schema:identifier ?id. } => { ?med a ex:Medication. }.

# Classify medications by room
{ ?med ex:room "1". } => { ?med a ex:Room1Medication. }.

# Extract simple room statistics for easier querying
{ ?med ex:room ?room. } => { ?med ex:isAdministeredInRoom ?room. }.
`;

// Simple query for the reasoner
const query = `
@prefix ex: <http://example.com/>.
@prefix schema: <http://schema.org/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.

{ 
  ?med a ex:Medication.
  ?med schema:identifier ?id.
  ?med ex:date ?date.
  ?med ex:room ?room.
} => {
  ?med schema:identifier ?id;
       ex:date ?date;
       ex:room ?room;
       a ex:Medication.
}.
`;

// Function to convert JSON-LD to N-Triples
async function jsonLdToNTriples(jsonLdData) {
  // Create a simple store for holding the triples
  const store = new N3.Store();
  
  // Process each entity in the JSON-LD array
  jsonLdData.forEach(entity => {
    // Get the subject from @id or generate a blank node
    const subject = entity['@id'] || `_:b${Math.random().toString(36).substring(2, 15)}`;
    
    // Process each predicate-object pair
    Object.entries(entity).forEach(([predicate, objects]) => {
      if (predicate === '@id' || predicate === '@context') return;
      
      // Handle type separately
      if (predicate === '@type') {
        const types = Array.isArray(objects) ? objects : [objects];
        types.forEach(type => {
          store.addQuad(
            N3.DataFactory.namedNode(subject),
            N3.DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
            N3.DataFactory.namedNode(type)
          );
        });
        return;
      }
      
      // Handle regular predicates
      const values = Array.isArray(objects) ? objects : [objects];
      values.forEach(value => {
        // Determine the object type (literal or URI)
        let object;
        if (typeof value === 'object' && value !== null) {
          if (value['@id']) {
            // URI reference
            object = N3.DataFactory.namedNode(value['@id']);
          } else if (value['@value']) {
            // Typed or language literal
            const datatype = value['@type'] ? N3.DataFactory.namedNode(value['@type']) : null;
            const language = value['@language'] || '';
            object = N3.DataFactory.literal(value['@value'], language || datatype);
          } else {
            // Skip complex objects for simplicity
            return;
          }
        } else if (typeof value === 'string') {
          object = N3.DataFactory.literal(value);
        } else if (value !== null) {
          object = N3.DataFactory.literal(String(value));
        } else {
          return; // Skip null values
        }

        store.addQuad(
          N3.DataFactory.namedNode(subject),
          N3.DataFactory.namedNode(predicate),
          object
        );
      });
    });
  });
  
  // Convert to N-Triples string
  const writer = new N3.Writer({ format: 'N-Triples' });
  store.forEach(quad => writer.addQuad(quad));
  
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

// Helper function to serialize an array of quads to Turtle string
async function quadsToTurtle(quads) {
  return new Promise((resolve, reject) => {
    const writer = new N3.Writer({ format: 'Turtle' });
    writer.addQuads(quads);
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

// Function to run reasoning with EYE reasoner
async function runEyeReasoner(triples, rules, query) {
  console.log("\n=== Medication Analysis with EYE Reasoner ===");
  
  try {
    // Save the input data for debugging
    fs.writeFileSync('reasoner-input.n3', triples + '\n' + rules, 'utf8');
    fs.writeFileSync('reasoner-query.n3', query, 'utf8');
    
    // Run the reasoner with separate rules and query
    const reasoningResult = await n3reasoner(triples + '\n' + rules, query);
    
    // Save the results
    fs.writeFileSync('reasoning-result.n3', reasoningResult, 'utf8');
    console.log("Reasoning results saved to reasoning-result.n3");
    
    // Parse the results into a store
    const store = new N3.Store();
    const parser = new N3.Parser();
    const quads = parser.parse(reasoningResult);
    store.addQuads(quads);
    
    // Extract medication data into objects for display
    const medications = [];
    const seenMedications = new Set();
    
    // Get all unique medications
    store.forEach((quad) => {
      if (quad.object.value === 'http://example.com/Medication' && !seenMedications.has(quad.subject.value)) {
        seenMedications.add(quad.subject.value);
        medications.push({
          uri: quad.subject.value,
          id: '',
          date: '',
          room: '',
          isRoom1: false
        });
      }
    });
    
    // Get medication properties
    medications.forEach(med => {
      store.forEach((quad) => {
        if (quad.subject.value === med.uri) {
          if (quad.predicate.value === 'http://schema.org/identifier') {
            med.id = quad.object.value;
          } else if (quad.predicate.value === 'http://example.com/date') {
            med.date = quad.object.value;
          } else if (quad.predicate.value === 'http://example.com/room') {
            med.room = quad.object.value;
          } else if (quad.predicate.value === 'http://www.w3.org/1999/02/22/rdf-syntax-ns#type' &&
            quad.object.value === 'http://example.com/Room1Medication') {
            med.isRoom1 = true;
          }
        }
      });
    });
    
    // Display the results in a table format
    console.log("\nEYE Reasoner Results:");
    console.log("\nMedication | Date | Room | Classifications");
    console.log("-----------|------|------|---------------");
    
    medications.forEach(med => {
      const classifications = ['Medication'];
      if (med.isRoom1) classifications.push('Room1Medication');
      
      console.log(`${med.id} | ${med.date} | ${med.room} | ${classifications.join(', ')}`);
    });
    
    return { store, medications };
  } catch (error) {
    console.error("Error executing EYE reasoning:", error);
    console.log("\nDiagnostic information:");
    throw error;
  }
}

// Function to run SPARQL query with Comunica
async function runSparqlQuery(triples) {
  console.log("\n=== Medication Analysis with SPARQL ===");
  
  try {
    // Parse the triples into an N3 Store for Comunica
    const store = new N3.Store();
    const parser = new N3.Parser();
    
    // Parse the triples
    const quads = parser.parse(triples);
    store.addQuads(quads);
    
    // Create a new query engine
    const engine = new QueryEngine();
    
    // Advanced query that shows different medications with their statistics
    const sparqlQuery = `
      PREFIX ex: <http://example.com/>
      PREFIX schema: <http://schema.org/>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      
      SELECT ?identifier 
             (COUNT(DISTINCT ?date) AS ?administrationCount) 
             (MIN(?date) AS ?firstAdministration)
             (MAX(?date) AS ?lastAdministration)
             (GROUP_CONCAT(DISTINCT ?room; separator=", ") AS ?rooms)
      WHERE {
        ?subject schema:identifier ?identifier .
        ?subject ex:date ?date .
        ?subject ex:room ?room .
      }
      GROUP BY ?identifier
      ORDER BY DESC(?administrationCount)
    `;
    
    // Execute the query
    const queryStream = await engine.queryBindings(sparqlQuery, { sources: [store] });
    
    // Display the results
    const bindings = await queryStream.toArray();
    
    console.log("\nSPARQL Query Results:");
    console.log("\nMedication | Administrations | First Administration | Last Administration | Rooms");
    console.log("-----------|----------------|---------------------|-------------------|-------");
    
    for (const binding of bindings) {
      const identifier = binding.get('identifier').value;
      const count = binding.get('administrationCount').value;
      const firstDate = binding.get('firstAdministration').value;
      const lastDate = binding.get('lastAdministration').value;
      const rooms = binding.get('rooms').value;
      
      console.log(`${identifier} | ${count} | ${firstDate} | ${lastDate} | ${rooms}`);
    }
    
    return { bindings };
  } catch (error) {
    console.error("Error executing SPARQL query:", error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    // Convert the YARRRML mapping to RML (as an array of quads)
    console.log("Converting YARRRML mapping to RML mapping...");
    const rmlMappingQuads = await yarrrmlParserInstance.convert(pharmaMappingYARRRML);
    console.log("Converted RML Mapping (quads):");
    console.log(rmlMappingQuads);

    // Serialize the array of quads to a Turtle string
    const rmlMapping = await quadsToTurtle(rmlMappingQuads);
    console.log("Serialized RML Mapping (Turtle):");
    console.log(rmlMapping);

    // Read the CSV file
    const csvData = fs.readFileSync('./medication.csv', 'utf8');
    const inputFiles = { 'medication.csv': csvData };
    const options = { toRDF: false }; // Output as JSON-LD

    console.log("Running RML mapping with rmlmapper-js using the converted YARRRML schema...");
    const jsonLdResult = await parseTurtle(rmlMapping, inputFiles, options);
    fs.writeFileSync('medication-jsonld.json', JSON.stringify(jsonLdResult, null, 2), 'utf8');
    console.log("JSON-LD mapping saved to medication-jsonld.json");

    // Convert JSON-LD to N-Triples for reasoning and SPARQL querying
    const triples = await jsonLdToNTriples(jsonLdResult);
    fs.writeFileSync('medication.nt', triples, 'utf8');
    console.log("N-Triples mapping saved to medication.nt");

    // Run reasoning and SPARQL queries
    await runEyeReasoner(triples, rules, query);
    await runSparqlQuery(triples);

  } catch (error) {
    console.error("An error occurred:", error);
    console.error(error.stack);
  }
}

main();
