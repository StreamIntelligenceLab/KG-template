# RDF Mapping

This project demonstrates how to use YARRRML mappings to convert CSV data into RDF and then run reasoning and SPARQL queries over the generated triples. The project uses several libraries including [@comake/rmlmapper-js](https://github.com/comake/rmlmapper-js), [eyereasoner](https://github.com/eyereasoner), [Comunica](https://comunica.dev/), and [N3](https://github.com/rdfjs/N3.js).

## Project Structure

- **index.mjs**  
  - The **first index.mjs** is a self-contained script that:
    - Converts a YARRRML mapping into an RML mapping.
    - Uses `@comake/rmlmapper-js` to process a CSV file (`medication.csv`) and generate JSON-LD.
    - Converts JSON-LD to N-Triples.
    - Runs reasoning with the EYE reasoner (via the `eyereasoner` package) and saves the result in `reasoning-result.n3`.
    - Executes a SPARQL query using the Comunica query engine and logs aggregated medication statistics.

- **helpers.js** 
  Contains all the helper functions


- **package.json**  
  Defines the project metadata, dependencies, and the start script. The key dependencies include:
  - `@comake/rmlmapper-js`
  - `@comunica/query-sparql`
  - `@rmlio/yarrrml-parser`
  - `csv-parse`
  - `eyereasoner`
  - `n3`
  - `jsonld`
  - `cli-table3`

## Install packages:
```bash
npm install
```

## How to Run:

You can run the project using the start script defined in package.json.

```bash
npm start
```

or

```bash
node <index.mjs>
```

This will execute the index.mjs file which:

* Converts the YARRRML mapping.

* Processes the CSV file to produce RDF triples.

* Runs the EYE reasoner and outputs the reasoning results.

* Executes a SPARQL query and prints the aggregated medication statistics.

## Debugging and Output Files

When you run the scripts, several files are generated:

* reasoner-input.n3 and reasoner-query.n3: Inputs provided to the EYE reasoner.

* reasoning-result.n3: The output of the reasoning process.

* Check the console logs for detailed information on each step of the process.