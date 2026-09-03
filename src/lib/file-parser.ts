import zlib from 'zlib';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Sanitizes any text string to ensure 100% compatibility with PostgreSQL text, varchar, and JSONB columns.
 * Removes null bytes (\u0000), invalid escape sequences, and unpaired Unicode surrogates.
 */
export function sanitizeForPostgres(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    // Remove null bytes and escaped null characters
    .replace(/\u0000/g, '')
    .replace(/\\u0000/g, '')
    .replace(/\0/g, '')
    // Remove non-printable control characters except standard whitespace (\t, \n, \r)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    // Remove unpaired Unicode surrogates
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // Normalize Unicode NFC composition
    .normalize('NFC')
    // Clean excessive spaces
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseTextFromPdfStream(streamStr: string, output: string[]) {
  // Only search inside BT (Begin Text) and ET (End Text) blocks to avoid font and image binaries
  const textBlocks = streamStr.matchAll(/BT[\s\S]*?ET/g);
  for (const block of textBlocks) {
    const blockContent = block[0];

    // Match (string) Tj / TJ
    const tjMatches = blockContent.matchAll(/\(([^()\\]|\\[\s\S])*\)\s*(?:Tj|TJ|\'|\")/g);
    for (const m of tjMatches) {
      const cleaned = m[0]
        .replace(/^\(/, '')
        .replace(/\)\s*(?:Tj|TJ|\'|\")$/, '')
        .replace(/\\([\s\S])/g, '$1')
        .trim();
      if (cleaned.length > 0) {
        output.push(cleaned);
      }
    }

    // Match array strings [(str1) (str2)] TJ
    const tjArrayMatches = blockContent.matchAll(/\[((?:\((?:[^()\\]|\\[\s\S])*\)|[^\%\)\]])+)\]\s*TJ/g);
    for (const m of tjArrayMatches) {
      const innerStrings = m[1].matchAll(/\(([^()\\]|\\[\s\S])*\)/g);
      for (const s of innerStrings) {
        const cleaned = s[0].slice(1, -1).replace(/\\([\s\S])/g, '$1').trim();
        if (cleaned.length > 0) {
          output.push(cleaned);
        }
      }
    }
  }
}

function extractTextFromPdfFallback(buffer: Buffer): string {
  const textBlocks: string[] = [];
  try {
    const latinStr = buffer.toString('latin1');
    parseTextFromPdfStream(latinStr, textBlocks);

    const streamRegex = /\/Filter\s*\/FlateDecode[\s\S]*?stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(latinStr)) !== null) {
      try {
        const streamHeaderIndex = match.index;
        const streamKwIndex = latinStr.indexOf('stream', streamHeaderIndex);
        if (streamKwIndex !== -1 && streamKwIndex < match.index + match[0].length) {
          let start = streamKwIndex + 6;
          if (latinStr.charCodeAt(start) === 13) start++;
          if (latinStr.charCodeAt(start) === 10) start++;
          const end = match.index + match[0].lastIndexOf('endstream');
          if (end > start) {
            const compressedBuf = buffer.subarray(start, end);
            const decompressedBuf = zlib.inflateSync(compressedBuf);
            parseTextFromPdfStream(decompressedBuf.toString('latin1'), textBlocks);
          }
        }
      } catch {
        // Continue processing remaining streams
      }
    }
  } catch (err) {
    console.warn('[PDF Fallback] Stream parsing warning:', err);
  }

  // Filter out any non-prose tokens
  const cleanTokens = textBlocks.filter((t) => {
    const printableCount = (t.match(/[a-zA-Z0-9\s.,!?:;'\-"]/g) || []).length;
    return printableCount / t.length >= 0.6;
  });

  return sanitizeForPostgres(cleanTokens.join(' '));
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  let textContent = '';

  // Primary: pdf-parse v2 with Node resolved worker
  try {
    const { PDFParse } = await import('pdf-parse');
    try {
      const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
      PDFParse.setWorker(pathToFileURL(workerPath).href);
    } catch {}

    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (result?.text && result.text.trim().length > 0) {
        // Strip out page divider banners added by pdf-parse like "-- 1 of 5 --"
        const cleanResult = result.text.replace(/-- \d+ of \d+ --/g, '');
        if (cleanResult.trim().length > 0) {
          textContent = cleanResult;
        }
      }
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (err: any) {
    console.warn('[PDF Ingest] Primary pdf-parse failed, attempting stream fallback:', err?.message || err);
  }

  // Secondary fallback: PDF stream text parser
  if (!textContent || textContent.trim().length < 10) {
    const fallbackText = extractTextFromPdfFallback(buffer);
    if (fallbackText && fallbackText.length > textContent.length) {
      textContent = fallbackText;
    }
  }

  return sanitizeForPostgres(textContent);
}

export function extractTextFromDocx(buffer: Buffer): string {
  try {
    const filename = 'word/document.xml';
    const nameBuf = Buffer.from(filename, 'utf8');
    const offset = buffer.indexOf(nameBuf);
    if (offset === -1) {
      throw new Error('Not a valid DOCX file (missing word/document.xml)');
    }

    let headerStart = -1;
    for (let i = offset - 1; i >= Math.max(0, offset - 100); i--) {
      if (buffer[i] === 0x50 && buffer[i+1] === 0x4b && buffer[i+2] === 0x03 && buffer[i+3] === 0x04) {
        headerStart = i;
        break;
      }
    }

    if (headerStart === -1) {
      throw new Error('Could not locate DOCX file header');
    }

    const compressionMethod = buffer.readUInt16LE(headerStart + 8);
    const compressedSize = buffer.readUInt32LE(headerStart + 18);
    const fileNameLen = buffer.readUInt16LE(headerStart + 26);
    const extraFieldLen = buffer.readUInt16LE(headerStart + 28);
    const dataStart = headerStart + 30 + fileNameLen + extraFieldLen;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    let xmlStr = '';
    if (compressionMethod === 8) {
      xmlStr = zlib.inflateRawSync(compressedData).toString('utf8');
    } else if (compressionMethod === 0) {
      xmlStr = compressedData.toString('utf8');
    } else {
      xmlStr = zlib.inflateSync(compressedData).toString('utf8');
    }

    const cleanText = xmlStr
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    return sanitizeForPostgres(cleanText);
  } catch (err: any) {
    console.warn('[DOCX Ingest] Extraction error:', err?.message || err);
    return sanitizeForPostgres(buffer.toString('utf8').replace(/<[^>]+>/g, ' '));
  }
}

export function formatCsvAsText(csvContent: string): string {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return sanitizeForPostgres(csvContent);

  const headers = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim());
  const formattedRows: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.replace(/^["']|["']$/g, '').trim());
    const rowDetails = headers
      .map((header, idx) => (cols[idx] ? `${header}: ${cols[idx]}` : ''))
      .filter(Boolean)
      .join(' | ');

    if (rowDetails) {
      formattedRows.push(rowDetails);
    }
  }

  return sanitizeForPostgres(formattedRows.join('\n'));
}

/**
 * Universal file text extractor supporting PDF, DOCX, CSV, TSV, TXT, Markdown, JSON, HTML, and XML.
 */
export async function extractTextFromFile(buffer: Buffer, fileName: string, mimeType?: string): Promise<string> {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  let rawExtracted = '';

  // 1. PDF
  if (lowerName.endsWith('.pdf') || lowerMime.includes('pdf')) {
    rawExtracted = await extractTextFromPdf(buffer);
  }
  // 2. DOCX / DOC
  else if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc') || lowerMime.includes('wordprocessingml') || lowerMime.includes('msword')) {
    rawExtracted = extractTextFromDocx(buffer);
  }
  // 3. CSV / TSV
  else if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || lowerMime.includes('csv') || lowerMime.includes('tab-separated')) {
    rawExtracted = formatCsvAsText(buffer.toString('utf8'));
  }
  // 4. JSON
  else if (lowerName.endsWith('.json') || lowerMime.includes('json')) {
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      rawExtracted = JSON.stringify(parsed, null, 2);
    } catch {
      rawExtracted = buffer.toString('utf8');
    }
  }
  // 5. HTML / XML
  else if (lowerName.endsWith('.html') || lowerName.endsWith('.htm') || lowerName.endsWith('.xml')) {
    rawExtracted = buffer.toString('utf8').replace(/<[^>]+>/g, ' ');
  }
  // 6. Default: UTF-8 Text / Markdown (.txt, .md, .markdown, .rtf, etc.)
  else {
    rawExtracted = buffer.toString('utf8');
  }

  return sanitizeForPostgres(rawExtracted);
}
