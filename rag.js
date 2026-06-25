// rag.js
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Lazy-loaded to avoid blocking server startup
let pipeline = null;
let db = null;
let table = null;
let currentWorkspacePath = null;

const DB_PATH = path.join(__dirname, ".voxcode-index");
const TABLE_NAME = "chunks";
const TOP_K = 5;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

const ALLOWED_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java',
    '.json', '.md', '.css', '.html', '.go', '.rs',
    '.c', '.cpp', '.cs', '.rb', '.php', '.swift'
];

const EXCLUDED_SEGMENTS = [
    'node_modules', '.git', 'dist', 'build',
    '.vscode-test', '__pycache__', '.next', 'coverage'
];

const EXCLUDED_FILENAMES = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
];

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isIndexableFile(filePath) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath);
    const hasAllowedExt = ALLOWED_EXTENSIONS.includes(ext);
    const isExcludedPath = EXCLUDED_SEGMENTS.some(seg => filePath.includes(seg));
    const isExcludedFile = EXCLUDED_FILENAMES.includes(base);
    return hasAllowedExt && !isExcludedPath && !isExcludedFile;
}

/**
 * Split text into overlapping chunks
 * @param {string} text
 * @param {string} filePath
 * @returns {Array<{id: string, filePath: string, content: string, chunkIndex: number}>}
 */
function chunkText(text, filePath) {
    const chunks = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
        const end = Math.min(start + CHUNK_SIZE, text.length);
        const content = text.slice(start, end).trim();

        if (content.length > 20) { // skip tiny chunks
            chunks.push({
                id: uuidv4(),
                filePath,
                content,
                chunkIndex
            });
            chunkIndex++;
        }

        if (end === text.length) break;
        start = end - CHUNK_OVERLAP;
    }

    return chunks;
}

/**
 * Get or initialize the embedding pipeline
 * @returns {Promise<Function>}
 */
async function getEmbedder() {
    if (pipeline) return pipeline;

    console.log("Loading embedding model (first time may take a moment)...");
    const { pipeline: createPipeline } = await import("@xenova/transformers");
    pipeline = await createPipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
    );
    console.log("Embedding model loaded.");
    return pipeline;
}

/**
 * Convert text to embedding vector
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

/**
 * Get all indexable files recursively from a directory
 * @param {string} dirPath
 * @returns {string[]}
 */
function getAllFiles(dirPath) {
    const results = [];

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (!EXCLUDED_SEGMENTS.includes(entry.name)) {
                    walk(fullPath);
                }
            } else if (entry.isFile() && isIndexableFile(fullPath)) {
                results.push(fullPath);
            }
        }
    }

    walk(dirPath);
    return results;
}

/**
 * Initialize LanceDB and load or create the table
 * @returns {Promise<void>}
 */
async function initDB() {
    if (db && table) return;

    const lancedb = require("@lancedb/lancedb");
    db = await lancedb.connect(DB_PATH);

    const tableNames = await db.tableNames();

    if (tableNames.includes(TABLE_NAME)) {
        table = await db.openTable(TABLE_NAME);
        console.log(`Loaded existing index with ${await table.countRows()} chunks`);
    } else {
        // Create table with a dummy row to establish schema
        // Real rows added during indexing
        table = await db.createTable(TABLE_NAME, [
            {
                id: "init",
                filePath: "",
                content: "",
                chunkIndex: 0,
                workspacePath: "",
                vector: new Array(384).fill(0) // all-MiniLM-L6-v2 produces 384-dim vectors
            }
        ]);
        console.log("Created new index");
    }
}

/**
 * Index a single file — chunk it, embed each chunk, store in LanceDB
 * @param {string} filePath
 * @param {string} workspacePath
 */
async function indexFile(filePath, workspacePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch {
        return;
    }

    if (!content.trim()) return;

    const chunks = chunkText(content, filePath);
    if (chunks.length === 0) return;

    // Remove existing chunks for this file before re-indexing
    try {
        await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
    } catch {
        // table may be empty on first run
    }

    const rows = [];
    for (const chunk of chunks) {
        const vector = await embed(chunk.content);
        rows.push({
            id: chunk.id,
            filePath: chunk.filePath,
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            workspacePath,
            vector
        });
    }

    await table.add(rows);
}

/**
 * Index an entire workspace directory
 * @param {string} workspacePath
 * @returns {Promise<{indexed: number, skipped: number}>}
 */
async function indexWorkspace(workspacePath) {
    console.log(`Indexing workspace: ${workspacePath}`);
    await initDB();

    const files = getAllFiles(workspacePath);
    console.log(`Found ${files.length} indexable files`);

    let indexed = 0;
    let skipped = 0;

    for (const filePath of files) {
        try {
            await indexFile(filePath, workspacePath);
            indexed++;
            if (indexed % 10 === 0) {
                console.log(`Indexed ${indexed}/${files.length} files...`);
            }
        } catch (err) {
            console.warn(`Skipped ${filePath}: ${err.message}`);
            skipped++;
        }
    }

    currentWorkspacePath = workspacePath;
    console.log(`Indexing complete: ${indexed} files indexed, ${skipped} skipped`);
    return { indexed, skipped };
}

/**
 * Search for relevant chunks given a query
 * @param {string} query
 * @param {string} workspacePath
 * @returns {Promise<Array<{filePath: string, content: string}>>}
 */
async function search(query, workspacePath) {
    await initDB();

    const queryVector = await embed(query);

    const results = await table
        .vectorSearch(queryVector)
        .limit(TOP_K * 2)
        .toArray();

    // Filter to current workspace and deduplicate by file
    const seenFiles = new Set();
    const deduplicated = [];

    for (const result of results) {
        if (result.workspacePath !== workspacePath) continue;
        if (seenFiles.has(result.filePath)) continue;

        seenFiles.add(result.filePath);
        deduplicated.push({
            filePath: result.filePath,
            content: result.content
        });

        if (deduplicated.length >= TOP_K) break;
    }

    return deduplicated;
}

/**
 * Re-index a single file (called when a file changes)
 * @param {string} filePath
 * @param {string} workspacePath
 */
async function reindexFile(filePath, workspacePath) {
    if (!isIndexableFile(filePath)) return;
    await initDB();
    await indexFile(filePath, workspacePath);
    console.log(`Re-indexed: ${filePath}`);
}

/**
 * Remove a file from the index (called when a file is deleted)
 * @param {string} filePath
 */
async function removeFile(filePath) {
    if (!table) return;
    try {
        await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
        console.log(`Removed from index: ${filePath}`);
    } catch (err) {
        console.warn(`Could not remove ${filePath} from index: ${err.message}`);
    }
}

module.exports = { indexWorkspace, search, reindexFile, removeFile };