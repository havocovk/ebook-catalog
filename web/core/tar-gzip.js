// ─────────────────────────────────────────────────────────────────────────────
// TAR-GZIP — Bağımlılıksız TAR paketleme/çözme + native GZIP sıkıştırma.
//
// AMAÇ: scanner/backup_full.py'nin ürettiği .tar.gz formatını web tarayıcısında
// da üretebilmek/okuyabilmek (Adım 5 — web yedekleme paneli). Python'un
// `tarfile` modülüyle TAM uyumlu, standart POSIX TAR (ustar) formatı üretir/okur.
//
// Hiçbir harici kütüphane KULLANILMAZ:
//   - TAR paketleme/çözme: bu dosyada elle yazılmış (~80 satır, TAR formatı
//     basit bir header+data blok dizisidir).
//   - GZIP sıkıştırma/açma: tarayıcının NATIVE CompressionStream/
//     DecompressionStream("gzip") API'si kullanılır (Chrome/Edge/Firefox/
//     Safari'de 2023'ten beri destekleniyor, ek kütüphane gerektirmez).
//
// Bu sayede: Python'da alınan bir yedek web'den yüklenebilir, web'den alınan
// bir yedek Python'dan (--restore-backup ile) yüklenebilir — iki yön de uyumlu.
// ─────────────────────────────────────────────────────────────────────────────

const TAR_BLOCK_SIZE = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ─── TAR paketleme ──────────────────────────────────────────────────────────
// Girdi: [{ name: "books.json", data: Uint8Array }, ...]
// Çıktı: Uint8Array (ham TAR — henüz sıkıştırılmamış)
export function createTar(files) {
  const blocks = [];
  let totalSize = 0;

  for (const { name, data } of files) {
    const header = _buildTarHeader(name, data.length);
    const paddedData = _padTo512(data);
    blocks.push(header, paddedData);
    totalSize += header.length + paddedData.length;
  }

  // TAR formatı, dosyaların ardından İKİ adet 512 byte'lık SIFIR blok ile biter.
  const endMarker = new Uint8Array(TAR_BLOCK_SIZE * 2);
  blocks.push(endMarker);
  totalSize += endMarker.length;

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }
  return result;
}

function _buildTarHeader(name, fileSize) {
  const header = new Uint8Array(TAR_BLOCK_SIZE); // sıfırla başlatılır

  _writeStr(header, 0, name, 100);                 // dosya adı
  _writeOctal(header, 100, 0o644, 8);               // dosya izinleri
  _writeOctal(header, 108, 0, 8);                   // owner UID
  _writeOctal(header, 116, 0, 8);                   // owner GID
  _writeOctal(header, 124, fileSize, 12);           // dosya boyutu (byte)
  _writeOctal(header, 136, Math.floor(Date.now() / 1000), 12); // değiştirilme zamanı
  // 148-155: checksum — aşağıda hesaplanıp yazılacak, şimdilik boşluk (0x20) ile doldur
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = "0".charCodeAt(0);                  // tip bayrağı: '0' = normal dosya
  _writeStr(header, 257, "ustar", 6);                // ustar imzası
  _writeStr(header, 263, "00", 2);                   // ustar versiyonu

  // Checksum: header'daki TÜM byte'ların toplamı (checksum alanı boşluk
  // sayılarak), 6 haneli oktal + null + boşluk olarak 148. konuma yazılır.
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) sum += header[i];
  const checksumStr = sum.toString(8).padStart(6, "0") + "\0 ";
  _writeStr(header, 148, checksumStr, 8);

  return header;
}

function _writeStr(buf, offset, str, maxLen) {
  const bytes = encoder.encode(str);
  buf.set(bytes.subarray(0, maxLen), offset);
}

function _writeOctal(buf, offset, value, len) {
  // TAR'da sayısal alanlar: oktal metin + sondaki null karakter
  const str = value.toString(8).padStart(len - 1, "0") + "\0";
  _writeStr(buf, offset, str, len);
}

function _padTo512(data) {
  const paddedLen = Math.ceil(data.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  const padded = new Uint8Array(paddedLen); // kalan kısım otomatik sıfır
  padded.set(data, 0);
  return padded;
}

// ─── TAR çözme ──────────────────────────────────────────────────────────────
// Girdi: Uint8Array (ham TAR, açılmış)
// Çıktı: [{ name: "books.json", data: Uint8Array }, ...]
export function parseTar(buffer) {
  const files = [];
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK_SIZE);

    // Tamamen sıfır blok = TAR'ın sonu
    if (_isAllZero(header)) break;

    const name = _readStr(header, 0, 100);
    if (!name) break; // güvenlik: bozuk/boş header ile sonsuz döngüye girmeyelim

    const sizeStr = _readStr(header, 124, 12).trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const typeFlag = String.fromCharCode(header[156]);

    offset += TAR_BLOCK_SIZE;

    // Sadece normal dosyaları al ('0' veya null = dosya; '5' = dizin, atla)
    if (typeFlag === "0" || typeFlag === "\0") {
      const data = buffer.subarray(offset, offset + size);
      files.push({ name, data: new Uint8Array(data) });
    }

    // Veri bloğu da 512'nin katlarına yuvarlanmıştır, offset'i ona göre ilerlet.
    const paddedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    offset += paddedSize;
  }

  return files;
}

function _readStr(buf, offset, maxLen) {
  const slice = buf.subarray(offset, offset + maxLen);
  const nullIdx = slice.indexOf(0);
  const trimmed = nullIdx === -1 ? slice : slice.subarray(0, nullIdx);
  return decoder.decode(trimmed);
}

function _isAllZero(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

// ─── GZIP sıkıştırma (native CompressionStream) ─────────────────────────────
export async function gzipCompress(data) {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([data]).stream().pipeThrough(cs);
  const compressedBlob = await new Response(stream).blob();
  return new Uint8Array(await compressedBlob.arrayBuffer());
}

// ─── GZIP açma (native DecompressionStream) ─────────────────────────────────
export async function gzipDecompress(data) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  const decompressedBlob = await new Response(stream).blob();
  return new Uint8Array(await decompressedBlob.arrayBuffer());
}

// ─── Yüksek seviye yardımcılar ───────────────────────────────────────────────

// files: [{ name, data: Uint8Array }] → tek bir .tar.gz Blob'u döner.
export async function buildTarGz(files) {
  const tar = createTar(files);
  const gzipped = await gzipCompress(tar);
  return new Blob([gzipped], { type: "application/gzip" });
}

// .tar.gz dosyasının ArrayBuffer'ını alır → [{ name, data: Uint8Array }] döner.
export async function extractTarGz(arrayBuffer) {
  const gzipped = new Uint8Array(arrayBuffer);
  const tar = await gzipDecompress(gzipped);
  return parseTar(tar);
}