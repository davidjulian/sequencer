const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const rootDirectory = __dirname;
const host = process.env.HOST || "127.0.0.1";
const preferredPort = Number(process.env.PORT || 3000);
const fallbackAttempts = process.env.PORT ? 0 : 20;

if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    console.error("PORT must be a whole number between 1 and 65535.");
    process.exit(1);
}

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".seq": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip"
};

function getSafeFilePath(requestUrl) {
    const parsedUrl = new URL(requestUrl, "http://localhost");
    const decodedPath = decodeURIComponent(parsedUrl.pathname);
    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const resolvedPath = path.resolve(rootDirectory, relativePath);

    if (resolvedPath !== rootDirectory && !resolvedPath.startsWith(`${rootDirectory}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
}

async function sendFile(response, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[extension] || "application/octet-stream";
    const content = await fs.readFile(filePath);

    response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });
    response.end(content);
}

function sendText(response, statusCode, text) {
    response.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(text);
}

async function handleRequest(request, response) {
    if (!["GET", "HEAD"].includes(request.method)) {
        sendText(response, 405, "Method Not Allowed");
        return;
    }

    const filePath = getSafeFilePath(request.url);

    if (!filePath) {
        sendText(response, 403, "Forbidden");
        return;
    }

    try {
        if (request.method === "HEAD") {
            await fs.access(filePath);
            response.writeHead(200, {
                "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
                "Cache-Control": "no-store"
            });
            response.end();
            return;
        }

        await sendFile(response, filePath);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") {
            sendText(response, 404, "Not Found");
            return;
        }

        console.error(error);
        sendText(response, 500, "Internal Server Error");
    }
}

function startServer(port, remainingFallbacks) {
    const server = http.createServer(handleRequest);

    server.on("error", error => {
        if (error.code === "EADDRINUSE" && remainingFallbacks > 0) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is in use. Trying ${nextPort}.`);
            startServer(nextPort, remainingFallbacks - 1);
            return;
        }

        console.error(error.message);
        process.exit(1);
    });

    server.listen(port, host, () => {
        console.log(`Sequencer is running at http://${host}:${port}/`);
    });
}

startServer(preferredPort, fallbackAttempts);
