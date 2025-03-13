// own_mapper.mjs
import { runMapping } from './rdf-processor.js';
import fs from 'fs';
import { n3reasoner } from 'eyereasoner';
import { QueryEngine } from '@comunica/query-sparql';
import * as N3 from 'n3';

/* 
  YARRRML mapping to reference medication.csv
*/
const pharmaMapping = `
prefixes:
  ex: "http://example.com/"
  schema: "http://schema.org/"
mappings:
  medication:
    sources:
      - ['medication.csv~csv']
    s: ex:medication/$(artikel___ATC___label)
    po:
      - [ex:date, $(begin_date)]
      - [schema:identifier, $(artikel___ATC___label)]
      - [ex:room, $(room)]
`;

// Define simple reasoning rules in N3 syntax
const rules = `
@prefix ex: <http://example.com/>.
@prefix schema: <http://schema.org/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.

# Basic classification of all medications
{
  ?med schema:identifier ?id.
} => {
  ?med a ex:Medication.
}.

# Classify medications by room
{
  ?med ex:room "1".
} => {
  ?med a ex:Room1Medication.
}.

# Extract simple room statistics for easier querying
{
  ?med ex:room ?room.
} => {
  ?med ex:isAdministeredInRoom ?room.
}.
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
                    } else if (quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
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
runMapping(pharmaMapping, './medication.csv', 'medication.csv')
    .then(async ({ rmlMapping, triples }) => {
        // Save the combined output to a single .nt file
        const combinedOutput = rmlMapping + '\n' + triples;
        fs.writeFileSync('medication.nt', combinedOutput, 'utf8');
        console.log("RML mapping and triples saved to medication.nt");

        try {
            // Run EYE reasoner
            await runEyeReasoner(triples, rules, query);

            // Run SPARQL query
            await runSparqlQuery(triples);

        } catch (error) {
            console.log("An error occurred during processing:", error);
            console.log("\nDiagnostic information:");
            console.log("Triples preview:", triples.substring(0, 200) + "...");
        }
    })
    .catch(error => {
        console.error("Mapping failed:", error);
    });