import { Server} from "bun";
import Path from "path";
import * as bun from "bun";
import { unlinkSync } from "node:fs";

const NoCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With'
}

const root = './cache';
type Cache = {
    type: "cache";
    url: string;
    status: number;
    headers: string;
    text: string;
    contentType: string;
    created: number;
};

const ttl = 1000 * 60 * 60; // 1 hour

async function Fetch(url: string): Promise<Response> {
    const urlHashID = Bun.hash(url);
    const cachePath = Path.join(root, urlHashID.toString());
    console.log("Cache path", cachePath);

    // -- Check for cache
    try {
        const file = Bun.file(cachePath);
        if (!await file.exists()) throw new Error("Cache miss");

        const rawData = await file.text();
        const cache: Cache = JSON.parse(rawData);

        if (Date.now() - cache.created > ttl) {
            console.error("Cache expired");
            try { unlinkSync(cachePath); }
            catch (error) { console.error("Error deleting cache"); }
            throw new Error("Cache miss");
        }

        const headers = new Headers(JSON.parse(cache.headers));
        return new Response(cache.text, {
            status: cache.status,
            headers: {
                ...headers,
                ...NoCorsHeaders,
                "content-type": cache.contentType || "application/json",
            },
        });

    } catch (error) {
        console.error("Cache miss");
        try { unlinkSync(cachePath); }
        catch (error) { console.error("Error deleting cache"); }
    }

    // -- Fetch the URL
    const response = await fetch(url);
    const headers = new Headers(response.headers);
    const contentType = headers.get("content-type");

    // -- Save the cache
    const cache: Cache = {
        type: "cache",
        url: url,
        status: response.status,
        headers: JSON.stringify(headers.toJSON()),
        text: await response.text(),
        contentType: contentType || "application/json",
        created: Date.now(),
    };

    const newCache = await Bun.file(cachePath);
    try { if (await newCache.exists()) unlinkSync(cachePath); }
    catch (error) { console.error("Error deleting cache", error); }

    await Bun.write(cachePath, JSON.stringify(cache));

    return new Response(cache.text, {
        status: cache.status,
        headers: {
            ...headers,
            ...NoCorsHeaders,
            "content-type": contentType || "application/json",
        },
    });
}

const proxyUrl = 'https://bitcoinexplorer.org/api';
const port = 80;



Bun.serve({
    port,
    lowMemoryMode: true,
    async fetch(request: Request, server: Server) {
        const url = new URL(new URL(request.url).pathname, proxyUrl).toString();
        if (request.method === "OPTIONS") return new Response(null, { headers: NoCorsHeaders });


        if (request.method === "GET") {
            try { return await Fetch(url); }

            catch (error) {
                console.error("Proxy error:", error);
                return new Response("Error fetching the URL.", { status: 500 });
            }
        }

        return new Response("Method not allowed", { status: 405 });
    },
});


console.log(`Server running on http://localhost:${port}`);