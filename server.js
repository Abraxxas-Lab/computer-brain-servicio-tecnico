import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const cacheDuration = 4 * 60 * 1000;
const googleScope = "https://www.googleapis.com/auth/business.manage";
const expectedTitle = normalizeName(process.env.GBP_LOCATION_TITLE || "Computer Brain servicio técnico");

let cachedReviews;
let cacheExpiresAt = 0;
let pendingReviews;
let accessToken;
let accessTokenExpiresAt = 0;
let cachedReviewParent;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function normalizeName(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

async function readGoogleJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Google API respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    const error = new Error("Falta configurar OAuth de Google en el archivo .env.");
    error.code = "not_configured";
    throw error;
  }

  const response = await readGoogleJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  accessToken = response.access_token;
  accessTokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
  return accessToken;
}

async function googleGet(url, token) {
  return readGoogleJson(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
}

async function listAccounts(token) {
  const accounts = [];
  let pageToken;
  do {
    const url = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    url.searchParams.set("pageSize", "20");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleGet(url, token);
    accounts.push(...(result.accounts || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return accounts;
}

async function findReviewParent(token) {
  if (cachedReviewParent) return cachedReviewParent;

  const accounts = await listAccounts(token);
  const matchingLocations = [];

  for (const account of accounts) {
    let pageToken;
    do {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
      url.searchParams.set("readMask", "name,title");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const result = await googleGet(url, token);
      for (const location of result.locations || []) {
        const title = normalizeName(location.title || "");
        if (title === expectedTitle || title.includes("computer brain")) {
          matchingLocations.push({ accountName: account.name, locationName: location.name, title });
        }
      }
      pageToken = result.nextPageToken;
    } while (pageToken);
  }

  const exactMatches = matchingLocations.filter((location) => location.title === expectedTitle);
  const matches = exactMatches.length ? exactMatches : matchingLocations;
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? "Hay varias ubicaciones de Computer Brain; configura GBP_LOCATION_TITLE para distinguirlas."
      : "No se encontró una ubicación de Computer Brain en las cuentas autorizadas.");
  }

  const locationId = matches[0].locationName.split("/").at(-1);
  cachedReviewParent = `${matches[0].accountName}/locations/${locationId}`;
  return cachedReviewParent;
}

async function fetchReviews() {
  const token = await getAccessToken();
  const parent = await findReviewParent(token);
  const url = new URL(`https://mybusiness.googleapis.com/v4/${parent}/reviews`);
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "updateTime desc");

  const result = await googleGet(url, token);
  const ratingValues = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const reviews = (result.reviews || []).map((review) => ({
    id: review.reviewId,
    author: review.reviewer?.isAnonymous ? "Cliente de Google" : review.reviewer?.displayName || "Cliente de Google",
    rating: ratingValues[review.starRating] || 0,
    comment: review.comment || "",
    date: review.createTime || review.updateTime || null
  }));

  return {
    averageRating: Number(result.averageRating) || 0,
    totalReviewCount: Number(result.totalReviewCount) || reviews.length,
    reviews: reviews.slice(0, 3),
    updatedAt: new Date().toISOString()
  };
}

async function getReviews() {
  if (cachedReviews && Date.now() < cacheExpiresAt) return cachedReviews;
  if (pendingReviews) return pendingReviews;

  pendingReviews = fetchReviews();
  try {
    cachedReviews = await pendingReviews;
    cacheExpiresAt = Date.now() + cacheDuration;
    return cachedReviews;
  } finally {
    pendingReviews = undefined;
  }
}

async function serveStatic(pathname, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(projectRoot, relativePath);
  if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(file);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

function applyApiCors(request, response) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN;
  if (allowedOrigin && request.headers.origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Accept");
    response.setHeader("Vary", "Origin");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/reviews") {
    applyApiCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET, OPTIONS" }).end("Method not allowed");
      return;
    }
    try {
      sendJson(response, 200, await getReviews());
    } catch (error) {
      const status = error.code === "not_configured" ? 503 : 502;
      if (status === 502) console.error("No se pudieron actualizar las reseñas:", error.message);
      sendJson(response, status, {
        error: error.code === "not_configured" ? "not_configured" : "google_unavailable"
      });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  await serveStatic(url.pathname, response);
});

server.listen(port, host, () => {
  console.log(`Computer Brain disponible en http://${host}:${port}`);
  console.log(`API de reseñas: ${googleScope}`);
});