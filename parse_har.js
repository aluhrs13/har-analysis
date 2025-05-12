const fs = require('fs');
const path = require('path');
const nunjucks = require("nunjucks");

nunjucks.configure(path.join(__dirname, "templates"), {
    autoescape: true
});

function parseHarFile(harFilePath) {
  try {
    const inputFilename = path.basename(harFilePath, path.extname(harFilePath));
    const outputFolder = path.join("output", inputFilename);
    const responsesFolder = path.join(outputFolder, "responses");

    if (fs.existsSync(outputFolder)) {
      fs.rmSync(outputFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(outputFolder, { recursive: true });

    if (fs.existsSync(responsesFolder)) {
      fs.rmSync(responsesFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(responsesFolder, { recursive: true });

    const harContent = fs.readFileSync(harFilePath, "utf8");
    const harData = JSON.parse(harContent);

    if (!harData.log || !harData.log.entries) {
      console.error("Invalid HAR file format: missing log.entries property");
      return;
    }

    /* 
     *
     *
     * Important: Right now we're only getting the first page.
     * 
     * 
     */
    first_page_id = harData.log.pages[0].id;

    const entries = harData.log.entries;
    const outputData = [];

    entries.forEach((entry) => {
        const request = entry.request;
        const response = entry.response;

        if (request.method !== "GET" || entry.pageref !== first_page_id) {
            return;
        }

        outputData.push({
            id: entry._id,
            url: request.url,
            mimeType: response.content.mimeType,
            size: response.content.size,
            cpuTimes: entry._cpuTimes,
            hasResponse: !!response.content.text
        });
        // Save the response content to a file
        if (response.content && response.content.text) {
            let extension = "unknown"; // Default extension
            const mimeType = response.content.mimeType;

            // Map common MIME types to file extensions
            const mimeTypeMap = {
              "application/json": "json",
              "application/javascript": "js",
              "text/javascript": "js",
              "application/x-javascript": "js",
              "image/svg+xml": "svg",
              "text/html": "html",
              "text/css": "css",
              "text/plain": "txt",
              "image/png": "png",
              "image/jpeg": "jpg",
              "image/gif": "gif",
              "application/xml": "xml",
              "text/xml": "xml",
            };

            if (mimeType && mimeTypeMap[mimeType]) {
                extension = mimeTypeMap[mimeType];
            }else{
                console.log(`Unknown MIME type: ${mimeType}`);
            }

            const responseFileName = `${entry._id}.${extension}`;
            const responseFilePath = path.join(responsesFolder, responseFileName);
            fs.writeFileSync(responseFilePath, response.content.text, "utf8");
        }
    });

    const outputFilePath = path.join(outputFolder, "requests.json");

    // Write to JSON file
    fs.writeFileSync(
      outputFilePath,
      JSON.stringify(outputData, null, 2),
      "utf8"
    );
    console.log(
      `Successfully wrote ${outputData.length} requests to ${outputFilePath}`
    );

    return outputData;

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`File not found: ${harFilePath}`);
    } else {
      console.error(`Error parsing HAR file: ${error.message}`);
    }
  }
}

const filename = process.argv[2];
if (!filename) {
    console.error('Please provide a HAR file path as an argument');
    console.error('Usage: node parse_har.js path/to/file.har');
    process.exit(1);
}


async function generatePages(requestsData) {
    const outputPath = path.join("output", "m365-5-9-2025", "index.html");
    console.log(`Generating pages for ${requestsData.length} requests...`);
            
    // Render the template
    const html = nunjucks.render("index.njk", {
      requests: requestsData
    });

    await fs.promises.writeFile(outputPath, html);

    console.log(`Index generated at ${outputPath}`);

}


files = parseHarFile(filename);

console.log("Files: ", files);

generatePages(files);