This project analyzes HAR files with response contents for potential areas of interest in the minified JS and other assets.

## Get a HAR File
This requires a HAR file that includes response bodies. The best way to get that would be to run [WebPageTest](https://www.webpagetest.org/) on your site with the "Save response bodies" option under the "Advanced" tab of "Advanced Configuration" selected.

## Run

```
npm install
node .\parse_har.js <path to HAR file>.har
```

`.\output\<HAR name>` will contain two folders - `responses` contains all the responses parsed from the HAR file, and `ssg` contains statically generated pages describing each. Run 

```
serve .\output\<HAR name>\ssg
```

to view the details of the analysis.


## Explore
### Main Dashboard
The index is a dashboard displaying all requests from the first page loaded in your HAR file. This overview helps you quickly identify interesting content.

You can  sort the table by:
- File size
- JavaScript content details
- Number of embedded images
- Total length of extracted strings

### Detailed Analysis
Click on any request in the table to dive deeper, the detailed view provides:
- Complete metadata about the request
- Gallery of any images or SVGs discovered within the content
- List of extracted strings, ordered by length.

This should help identify embedded resources and interesting content patterns in your HAR files.