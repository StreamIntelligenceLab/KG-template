// helpers.js
import * as N3 from 'n3';
import { n3reasoner } from 'eyereasoner';
import fs from 'fs';
import { QueryEngine } from '@comunica/query-sparql';
import Table from 'cli-table3';


// Function to convert JSON-LD to N-Triples
export async function jsonLdToNTriples(jsonLdData) {
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
export async function quadsToTurtle(quads) {
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
export async function runEyeReasoner(triples, rules) {
  console.log("\n=== Reasoning with EYE Reasoner ===");
  
  try {
    // Save the input data for debugging
    fs.writeFileSync('reasoner-input.n3', triples + '\n' + rules, 'utf8');
    
    // Run the reasoner with separate rules and query
    const reasoningResult = await n3reasoner(triples + '\n' + rules, "");
    
    // Save the results
    fs.writeFileSync('reasoning-result.n3', reasoningResult, 'utf8');
    console.log("Reasoning results saved to reasoning-result.n3");
    
    // Parse the results into a store
    const store = new N3.Store();
    const parser = new N3.Parser();
    const quads = parser.parse(reasoningResult);
    store.addQuads(quads);
  
    
    return store;
  } catch (error) {
    console.error("Error executing EYE reasoning:", error);
    console.log("\nDiagnostic information:");
    throw error;
  }
}

// Function to run SPARQL query with Comunica
export async function runSparqlQuery(triples,sparqlQuery, reasoning_results, useReasoningResults) {
  console.log("\n=== Execute SPARQL Query ===");
  
  try {
    // Parse the triples into an N3 Store for Comunica
    const store = new N3.Store();
    const parser = new N3.Parser();
    
    // Parse the triples
    const quads = parser.parse(triples);
    store.addQuads(quads);

    // when we want to use the reasoning results
    if(useReasoningResults){
    reasoning_results.getQuads(null, null, null, null).forEach(quad => {
      store.addQuad(quad);
    });
  }
    
    // Create a new query engine
    const engine = new QueryEngine();
    

    
    // Execute the query
    const queryStream = await engine.queryBindings(sparqlQuery, { sources: [store] });
    
    // Display the results
    const bindings = await queryStream.toArray();
    // console.log(bindings.toString());
    // console.log("\nSPARQL Query Results:");
    // console.log("\call                             | source                               | priority ");
    // console.log("---------------------------------|--------------------------------------|----------");
    // for (const binding of bindings) {
    //   const call = binding.get('call').value;
    //   const source = binding.get('source').value;
    //   const priority = binding.get('priority').value;

      
    //   console.log(`${call} | ${source} | ${priority}`);
    // }
    if (bindings.length === 0) {
      console.log("No results.");
  } else {
      // Extract variable names dynamically
      const variables = [...new Set(bindings.flatMap(binding => [...binding.keys()].map(v => v.value)))];
  
      // Initialize table with headers
      const table = new Table({ head: variables });
  
      // Add rows to the table
      bindings.forEach(binding => {
          const row = variables.map(varName => binding.get(varName)?.value || '');
          table.push(row);
      });
  
      // Print the table
      console.log(table.toString());
  }
    
    return { bindings };
  } catch (error) {
    console.error("Error executing SPARQL query:", error);
    throw error;
  }
}