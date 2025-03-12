// rdf-processor.js
import fs from 'fs';
import { createRequire } from 'module';

// Create a require function
const require = createRequire(import.meta.url);

// Use N3 directly for RDF processing
const N3 = require('n3');
const YarrrmlParser = require('@rmlio/yarrrml-parser/lib/rml-generator');

// Adding csv-parse for better CSV handling
const { parse } = require('csv-parse/sync');

/**
 * Convert YARRRML to RML
 */
export async function convertYarmlToRML(yarml) {
  const y2r = new YarrrmlParser();
  const triples = y2r.convert(yarml);
  const writer = new N3.Writer({
    prefixes: {
      rml: 'http://semweb.mmlab.be/ns/rml#',
      rr: 'http://www.w3.org/ns/r2rml#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      ex: 'http://example.com/',
      schema: 'http://schema.org/'
    }
  });
  
  triples.forEach(triple => writer.addQuad(triple));
  
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) {
        reject(error);
      } else {
        console.log("Generated RML mapping:\n", result);
        resolve(result);
      }
    });
  });
}

/**
 * Parse RML mapping rules
 */
function parseRMLRules(rmlString) {
  const parser = new N3.Parser();
  return parser.parse(rmlString);
}

/**
 * Extract logical sources from RML triples
 */
function extractLogicalSources(quads) {
  const logicalSources = {};
  const triplesMaps = [];
  const predicateObjectMaps = {};
  
  // Find all TriplesMaps
  quads.forEach(quad => {
    if (quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' && 
        quad.object.value === 'http://www.w3.org/ns/r2rml#TriplesMap') {
      triplesMaps.push(quad.subject.value);
    }
  });
  
  // Find logical sources for each TriplesMap
  triplesMaps.forEach(triplesMap => {
    quads.forEach(quad => {
      if (quad.subject.value === triplesMap && 
          quad.predicate.value === 'http://semweb.mmlab.be/ns/rml#logicalSource') {
        const logicalSourceNode = quad.object.value;
        
        // Find source file for this logical source
        quads.forEach(sourceQuad => {
          if (sourceQuad.subject.value === logicalSourceNode && 
              sourceQuad.predicate.value === 'http://semweb.mmlab.be/ns/rml#source') {
            logicalSources[triplesMap] = sourceQuad.object.value;
          }
        });
      }
    });
  });
  
  return { logicalSources, triplesMaps };
}

/**
 * Parse CSV data with robust handling of different formats
 */
function parseCSV(csvContent) {
  try {
    // Use csv-parse for better CSV parsing
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    });
    
    // Handle headers with dots by creating a nested structure
    const processedRecords = records.map(record => {
      const processedRecord = {};
      
      Object.keys(record).forEach(key => {
        if (key.includes('.')) {
          const parts = key.split('.');
          let current = processedRecord;
          
          // Create nested objects for each dot-separated part
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
              current[parts[i]] = {};
            }
            current = current[parts[i]];
          }
          
          // Set the final property
          current[parts[parts.length - 1]] = record[key];
        } else {
          processedRecord[key] = record[key];
        }
      });
      
      // Also keep the original flat structure for direct access
      Object.keys(record).forEach(key => {
        processedRecord[key] = record[key];
      });
      
      return processedRecord;
    });
    
    return { 
      headers: Object.keys(records[0] || {}), 
      rows: processedRecords
    };
  } catch (error) {
    console.error("Error parsing CSV:", error);
    throw error;
  }
}

/**
 * Process CSV data based on RML rules
 */
async function processCSVWithRML(rmlQuads, inputFiles) {
  const { logicalSources, triplesMaps } = extractLogicalSources(rmlQuads);
  const store = new N3.Store(rmlQuads);
  const resultQuads = [];
  
  // Process each triplesMap
  for (const triplesMap of triplesMaps) {
    const sourceFile = logicalSources[triplesMap];
    if (!sourceFile || !inputFiles[sourceFile]) {
      console.warn(`Source file ${sourceFile} not found in input files`);
      continue;
    }
    
    const csvData = parseCSV(inputFiles[sourceFile]);
    
    // Get subject template
    const subjectMapQuads = store.getQuads(triplesMap, 'http://www.w3.org/ns/r2rml#subjectMap', null);
    if (subjectMapQuads.length === 0) continue;
    
    const subjectMap = subjectMapQuads[0].object.value;
    const templateQuads = store.getQuads(subjectMap, 'http://www.w3.org/ns/r2rml#template', null);
    if (templateQuads.length === 0) continue;
    
    const subjectTemplate = templateQuads[0].object.value;
    
    // Get predicate-object maps
    const poMapQuads = store.getQuads(triplesMap, 'http://www.w3.org/ns/r2rml#predicateObjectMap', null);
    
    // Process each row in the CSV
    for (const row of csvData.rows) {
      // Create subject URI by replacing template variables
      let subjectURI = subjectTemplate;
      
      // Replace template variables with values from row
      // Handle both flat values and nested object values
      for (const key of csvData.headers) {
        const value = row[key] || '';
        subjectURI = subjectURI.replace(`{${key}}`, encodeURIComponent(value));
      }
      
      // Process each predicate-object map
      for (const poMapQuad of poMapQuads) {
        const poMap = poMapQuad.object.value;
        
        // Get predicate
        const predicateMapQuads = store.getQuads(poMap, 'http://www.w3.org/ns/r2rml#predicateMap', null);
        if (predicateMapQuads.length === 0) continue;
        
        const predicateMap = predicateMapQuads[0].object.value;
        const predicateConstantQuads = store.getQuads(predicateMap, 'http://www.w3.org/ns/r2rml#constant', null);
        if (predicateConstantQuads.length === 0) continue;
        
        const predicate = predicateConstantQuads[0].object.value;
        
        // Get object
        const objectMapQuads = store.getQuads(poMap, 'http://www.w3.org/ns/r2rml#objectMap', null);
        if (objectMapQuads.length === 0) continue;
        
        const objectMap = objectMapQuads[0].object.value;
        const referenceQuads = store.getQuads(objectMap, 'http://semweb.mmlab.be/ns/rml#reference', null);
        if (referenceQuads.length === 0) continue;
        
        const reference = referenceQuads[0].object.value;
        
        // Get value from row, handling both direct properties and nested properties
        let value = '';
        if (reference.includes('.')) {
          // Handle nested references like "room.name"
          const parts = reference.split('.');
          let current = row;
          
          // Navigate the nested structure
          for (let i = 0; i < parts.length; i++) {
            if (current && current[parts[i]]) {
              current = current[parts[i]];
            } else {
              // If property not found in nested structure, try as a flat property
              current = row[reference] || '';
              break;
            }
          }
          
          value = current;
        } else {
          // Direct property
          value = row[reference] || '';
        }
        
        // Add new quad to results
        resultQuads.push(new N3.Quad(
          N3.DataFactory.namedNode(subjectURI),
          N3.DataFactory.namedNode(predicate),
          N3.DataFactory.literal(value)
        ));
      }
    }
  }

  // Write results to N-Triples format
  const writer = new N3.Writer({ format: 'N-Triples' });
  resultQuads.forEach(quad => writer.addQuad(quad));
  
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Main mapping function 
 */
export async function doMapping(rmlString, inputFiles) {
  try {
    // Parse RML rules
    const rmlQuads = parseRMLRules(rmlString);
    
    // Process the mapping
    const result = await processCSVWithRML(rmlQuads, inputFiles);
    
    console.log("Generated RDF triples:\n", result);
    return result;
  } catch (error) {
    console.error("Mapping error:", error);
    throw error;
  }
}

/**
 * Run the complete mapping process
 */
export async function runMapping(yarmlMapping, csvFilePath, csvFileName) {
  try {
    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, 'utf8');
    const inputFiles = {
      [csvFileName]: csvContent
    };
    
    // Convert YARRRML to RML
    const rmlString = await convertYarmlToRML(yarmlMapping);
    
    // Execute mapping
    const triples = await doMapping(rmlString, inputFiles);
    
    // Return both the RML mapping and the generated triples
    return {
      rmlMapping: rmlString,
      triples: triples
    };
  } catch (err) {
    console.error("Error during mapping process:", err);
    throw err;
  }
}
