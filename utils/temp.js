// const fetch = require('node-fetch');
// const JSZip = require('jszip');
// const Papa = require('papaparse');
// const fs = require('fs').promises;

// // Function to download a file
// async function downloadFile(url) {
//     const response = await fetch(url);
//     if (!response.ok) {
//         throw new Error(`Failed to download file. Status: ${response.status} ${response.statusText}`);
//     }
//     return await response.buffer();
// }

// // Function to unzip a file
// async function unzipFile(zipBuffer) {
//     const zip = await JSZip.loadAsync(zipBuffer);
//     // Assuming there is only one file in the zip, change as needed
//     const fileName = Object.keys(zip.files)[0];
//     const fileContent = await zip.file(fileName).async('nodebuffer');

//     // Write the unzipped content to a temporary file
//     const tempFilePath = './temp.csv'; // Change to an appropriate temporary path
//     await fs.writeFile(tempFilePath, fileContent);

//     return tempFilePath;
// }

// // Function to parse CSV content from a file
// async function parseCSVFromFile(filePath, callback) {
//     const fileContent = await fs.readFile(filePath, 'utf-8');
//     Papa.parse(fileContent, {
//         complete: result => {
//             callback(result.data);
//         },
//         header: true // Set to false if your CSV doesn't have headers
//     });
// }

// // Example usage
// const zipFileUrl = 'https://api.shoonya.com/BFO_symbols.txt.zip';

// downloadFile(zipFileUrl)
//     .then(zipBuffer => unzipFile(zipBuffer))
//     .then(tempFilePath => parseCSVFromFile(tempFilePath, csvData => {
//         console.log(csvData);
//     }))
//     .catch(error => {
//         console.error('Error:', error.message || error);
//     });

const https = require('https');
const fs = require('fs');
const AdmZip = require('adm-zip');

// Replace 'your_zip_file_url.zip' with the actual URL of your ZIP file
const zipFileUrl = 'https://api.shoonya.com/BFO_symbols.txt.zip';

// Replace 'downloaded_file.zip' with the desired file name
const downloadedFileName = 'downloaded_file.zip';

// Function to download the ZIP file
function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destination);
        https.get(url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                file.close(() => {
                    resolve();
                });
            });
        }).on('error', function(err) {
            fs.unlink(destination, () => {}); // Delete the file if an error occurs during download
            reject(err);
        });
    });
}

// Function to unzip the downloaded file in the current working directory
function unzipFile(zipFilePath) {
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo('./', true);
    console.log('Unzipped in the current working directory.');
}

// Download the ZIP file and then unzip it
downloadFile(zipFileUrl, downloadedFileName)
    .then(() => {
        unzipFile(downloadedFileName);
    })
    .catch(error => {
        console.error('Error:', error);
    });
