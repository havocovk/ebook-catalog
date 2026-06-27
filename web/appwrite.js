import { Client, Account, Databases, Storage, Query, ID } from "https://esm.sh/appwrite@17";

const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "6a2f3ae5000560f23d0c";

const DATABASE_ID = "6a2f3b38001d67193c7b";
const TABLE_ID = "books";
const BUCKET_ID = "6a2f3f66001896fe7d78";

// Yeni koleksiyonlar — yazar / yayınevi / seri listeleri.
// (Appwrite panelinde koleksiyon ID'leri bu adlarla oluşturuldu.)
const AUTHORS_ID = "authors";
const PUBLISHERS_ID = "publishers";
const SERIES_ID = "series";
// ── Adım 19: Kullanıcı tanımlı koleksiyonlar (Tango, CFD, Tarih gibi
// serbest gruplamalar). Yazarlar/Yayınevleri ile aynı mantık (ayrı bir
// "ad listesi" tablosu), ama books.collections bir DİZİ — bir kitap
// birden fazla koleksiyona ait olabilir (etiketler gibi).
const COLLECTIONS_ID = "collections";
// ── Adım 19 sonu ─────────────────────────────────────────────────────────

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);
const _rawDatabases = new Databases(client);
const _rawStorage = new Storage(client);

// ═══════════════════════════════════════════════════════════════════════════
// ── Adım 30: Appwrite isteklerini hız sınırına (rate limit) UYUMLU hale
// getiren merkezi kuyruk ────────────────────────────────────────────────────
//
// SORUN: Appwrite, kötüye kullanımı (abuse) önlemek için kendi sunucu
// tarafında bir hız sınırı uyguluyor — yazma uçları (deleteDocument,
// createDocument, updateDocument, deleteFile, createFile) için bu sınır
// dakikada 60 istek (saniyede ortalama 1 istek). Toplu silme gibi işlemler
// sırasında (her kitap için kapak silme + kitap silme + cascade delete ile
// yazar/seri/yayınevi silme — yani 1 kitap için 2-5 ayrı istek), bu istekler
// aralarında HİÇ bekleme olmadan art arda gönderiliyordu. 50 kitaplık bir
// işlem saniyeler içinde 100-200 isteğe çıkabiliyor — bu da Appwrite'ın
// sınırını fazlasıyla aşıyor ve "Rate limit for the current endpoint has
// been exceeded" (HTTP 429) hatasına yol açıyor.
//
// ÇÖZÜM (yama DEĞİL, kök sebep çözümü): Appwrite'a gönderilen HER YAZMA
// isteği (deleteDocument, createDocument, updateDocument, deleteFile,
// createFile) TEK BİR SIRADAN (kuyruktan) geçirilir — okuma istekleri
// (listDocuments, getFile vb.) bu kuyruğa GİRMEZ, çünkü rate limit sorunu
// sadece yazma uçlarında yaşanıyordu (bkz. Adım 32). Kuyruk, ardışık iki
// YAZMA isteği arasında EN AZ MIN_INTERVAL_MS kadar bir süre olmasını
// garanti eder — yani kod, Appwrite'ın izin verdiği hızın HİÇBİR ZAMAN
// üzerine çıkmaz. Bu "hata oluşunca tekrar dene" (reaktif, bypass) değildir
// — "hataya hiç sebep olmayacak hızda çalış" (proaktif, doğru tasarım)
// demektir. Sonuç olarak toplu silme/oluşturma işlemleri YAVAŞLAR (50
// kitaplık bir toplu silme birkaç dakika sürebilir) ama 429 hatasına HİÇBİR
// ZAMAN çarpmaz; sayfa açılışı ve okuma işlemleri ise ESKİSİ KADAR HIZLI
// kalır, çünkü onlar bu kuyruğa hiç girmiyor.
//
// MIN_INTERVAL_MS = 1100 — dakikada 60 istek sınırının (1000ms/istek)
// belirgin şekilde altında, böylece saniye sınırları arasında ufak
// senkronizasyon kaymaları olsa bile sınıra hiç yaklaşılmaz.
const MIN_INTERVAL_MS = 1100;
let _queueTail = Promise.resolve();

// throttledCall: verilen fonksiyonu (gerçek Appwrite SDK çağrısını) kuyruğa
// ekler. Kuyruktaki her görev, kendinden ÖNCEKİ görev bitip MIN_INTERVAL_MS
// kadar beklendikten SONRA çalışır — yani tüm Appwrite çağrıları (farklı
// fonksiyonlardan, farklı zamanlarda tetiklense bile) TEK BİR SIRADA ve
// kontrollü bir hızda yürütülür.
function throttledCall(fn) {
  const run = _queueTail.then(async () => {
    const result = await fn();
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS));
    return result;
  });
  // _queueTail'i HER ZAMAN bir sonraki görev için güncelle — fn() hata
  // fırlatsa bile kuyruk tıkanmasın (catch ile "boş" bir devam noktası
  // bırakılır, asıl hata run promise'i üzerinden çağıran tarafa ulaşır).
  _queueTail = run.catch(() => {});
  return run;
}

// ── Adım 32: Throttle SADECE yazma (write) metodlarına uygulanır ───────────
// SORUN (önceki sürümde): throttleSdkObject TÜM metodları (okuma dahil)
// kuyruğa sokuyordu. Bu, rate limit sorununu çözerken FARKLI bir sorun
// yarattı: sayfa açılışında çalışan loadBooks/bootstrapAuthors/Publishers/
// Series/Collections — bunların HEPSİ SADECE OKUMA (listDocuments) yapar —
// artık birbirini aynı kuyrukta 1.1 saniye aralıklarla BEKLEMEK ZORUNDA
// kaldı. Kitap sayısı arttıkça (sayfalama nedeniyle daha çok listDocuments
// çağrısı) bu bekleme zinciri uzadı ve sayfa açılışı YAVAŞLADI.
//
// GERÇEK DURUM: Appwrite'ın rate limit sınırı sadece YAZMA uçları için
// (deleteDocument, createDocument, updateDocument, deleteFile, createFile)
// geçerli — okuma (listDocuments, getDocument, getFile) için bu sınır
// sorun yaratmıyordu zaten (bizim hiçbir okuma isteğimiz 429 ALMADI, sadece
// silme/oluşturma istekleri aldı). Bu yüzden throttle'ı SADECE yazma
// metodlarına uygulamak hem rate limit sorununu çözüyor HEM DE okumayı
// hiç yavaşlatmıyor — iki kuş tek taş.
const THROTTLED_METHODS = new Set([
  "deleteDocument", "createDocument", "updateDocument",
  "deleteFile", "createFile",
]);

function throttleSdkObject(rawObject) {
  return new Proxy(rawObject, {
    get(target, propertyName) {
      const original = target[propertyName];
      if (typeof original !== "function") return original;

      // Yazma metodu değilse (örn. listDocuments, getFile) — hiç kuyruğa
      // girmeden, doğrudan ve anında çalıştır.
      if (!THROTTLED_METHODS.has(propertyName)) {
        return (...args) => original.apply(target, args);
      }

      return (...args) => throttledCall(() => original.apply(target, args));
    },
  });
}
// ── Adım 32 sonu ─────────────────────────────────────────────────────────────

const databases = throttleSdkObject(_rawDatabases);
const storage = throttleSdkObject(_rawStorage);
// ── Adım 30 sonu ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export {
  client,
  account,
  databases,
  storage,
  Query,
  ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  DATABASE_ID,
  TABLE_ID,
  BUCKET_ID,
  AUTHORS_ID,
  PUBLISHERS_ID,
  SERIES_ID,
  COLLECTIONS_ID,
};