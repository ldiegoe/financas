// Extração de texto de PDF via pdf.js, carregado sob demanda.
//
// O pdf.js tem ~1 MB, então não entra no bundle nem no precache do SW: só é
// baixado quando o usuário realmente importa um carnê, e a partir daí o SW
// (cache-first pra CDN) serve do cache — inclusive offline.
//
// Isolado aqui porque é a única parte com side effect; o parsing dos boletos
// em si vive puro em ../domain/boleto.js.

const PDFJS_VERSION = '4.10.38';
const BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsPromise = null;

// Carrega (uma vez só) a lib e aponta o worker. O polyfill de
// Promise.withResolvers cobre iOS < 17.4, que o pdf.js 4.x assume existir.
const loadPdfJs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      if (typeof Promise.withResolvers !== 'function') {
        Promise.withResolvers = function () {
          let resolve, reject;
          const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
          return { promise, resolve, reject };
        };
      }
      const lib = await import(/* @vite-ignore */ `${BASE}/pdf.min.mjs`);
      lib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.mjs`;
      return lib;
    })().catch(err => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
};

// Lê um File/Blob de PDF e devolve todo o texto concatenado (uma linha por
// item, o que preserva a vizinhança dos campos sem grudar números distintos).
// `onProgress(pagina, total)` é opcional — carnê longo tem dezenas de páginas.
export const extractPdfText = async (file, onProgress) => {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const partes = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map(i => i.str).join(' '));
      page.cleanup();
      if (onProgress) onProgress(p, doc.numPages);
    }
  } finally {
    doc.destroy();
  }
  return partes.join('\n');
};
