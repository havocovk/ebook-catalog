// ─────────────────────────────────────────────────────────────────────────────
// API-BOOKS — Kitap CRUD işlemleri + kapak resmi yükleme.
//
// "Veri katmanı"nın kitaplarla ilgili çekirdeği: kitapları çekmek, güncellemek,
// silmek, yedek için hepsini almak, manuel kapak yüklemek. Bilerek SADE tutuldu
// — burada ekran/çizim mantığı yoktur. Çizimi sayfalar (catalog.js vb.) ve
// router.js üstlenir.
//
// Bağımlılıklar:
//   - api-shared.js  → fetchAllPaginated (sayfalı veri çekme)
//   - api-cascade.js → cascadeDeleteOrphans (silme/güncelleme sonrası yetim temizliği)
// ─────────────────────────────────────────────────────────────────────────────

import {
  databases,
  storage,
  ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  DATABASE_ID,
  TABLE_ID,
  BUCKET_ID,
} from "../appwrite.js";
import { state } from "./state.js";
import { showLoading, showToast } from "../ui/common.js";
import { fetchAllPaginated } from "./api-shared.js";
import { cascadeDeleteOrphans } from "./api-cascade.js";

// Appwrite'ın her belgeye otomatik eklediği sistem alanları.
// Yedekten geri yüklerken bunları ayıklamamız gerekir (yeniden yazılamazlar).
export const SYSTEM_FIELDS = [
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$collectionId",
  "$databaseId",
  "$sequence",
];

// ─── Kitapları yükle ────────────────────────────────────────────────────────
// Tüm kitapları çekip hafızaya (state.books) koyar. "Yükleniyor" animasyonunu yönetir.
// Çizim YAPMAZ — yükleme bittikten sonra router.js ilgili sayfayı çizer.
export async function loadBooks() {
  showLoading(true);
  try {
    state.books = await fetchAllPaginated();
  } catch (err) {
    showToast("Kitaplar yüklenemedi: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

// ─── Yedek için tüm kayıtları getir ─────────────────────────────────────────
// Hafızaya dokunmadan tüm kitapları dizi olarak döndürür (yedek dosyası yazmak için).
export async function fetchAllBooks() {
  return fetchAllPaginated();
}

// ─── Tek kayıt güncelle ─────────────────────────────────────────────────────
// Başarılıysa Appwrite'ın döndürdüğü güncel belgeyi verir; hata olursa fırlatır.
export async function updateBookRecord(id, updates) {
  return databases.updateDocument(DATABASE_ID, TABLE_ID, id, updates);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Adım 34: Güncelleme sırasında da yetim kontrolü — updateBookRecordWithCascade
//
// SORUN: updateBookRecord (yukarıda) sadece Appwrite'a yazıyor, başka bir şey
// yapmıyor. Bu, "kitap SİLİNİRKEN" çalışan cascadeDeleteOrphans'ın hiç
// göremediği bir senaryo açığa çıkardı: kitap silinmeden, sadece bir alanı
// (author/publisher/series/collections) DEĞİŞTİRİLDİĞİNDE, eski değer
// hâlâ kullanılıyor mu diye HİÇ kontrol edilmiyordu. Örnek: 4 kitaptan bir
// koleksiyon adı kart üzerinden kaldırılınca, o koleksiyon collections
// tablosunda sonsuza dek yetim kalıyordu.
//
// ÇÖZÜM: Bu fonksiyon, updateBookRecord'u SARAR — günceller VE ardından,
// SADECE GERÇEKTEN DEĞİŞEN alanlar için (aynı kalan alanlara dokunmadan,
// gereksiz kontrol yapmadan) cascadeDeleteOrphans'ı tetikler. "Değişen"
// tanımı: author/publisher/series için eski metin ile yeni metin BİRBİRİNDEN
// FARKLIYSA; collections için eski dizide olup yeni dizide OLMAYAN isimler
// için.
//
// staleValues.publisher HER ZAMAN eski (güncelleme öncesi) publisher
// değeriyle doldurulur — author/collections değişse de publisher değişmese
// de, seri kontrolü "hangi yayınevine göre bakılacağını" bilmek için bu
// bilgiye ihtiyaç duyar (bkz. cascadeDeleteOrphans içindeki Adım 26 notu).
//
// oldBook: güncellemeden ÖNCEKİ kitap nesnesi (state.books'tan, güncelleme
//          öncesi okunmalı — çağıran taraf bunu garanti etmeli).
// newFields: updateBookRecord'a aynen geçirilecek alanlar (örn.
//          { author: "Yeni Yazar" } veya { collections: [...] }).
export async function updateBookRecordWithCascade(id, newFields) {
  const oldBook = state.books.find((b) => b.$id === id);
  // Eski değerleri (güncellemeden ÖNCEKİ hâliyle) AYRI bir nesneye kopyala —
  // state.books'taki gerçek nesneye referans TUTMUYORUZ, çünkü o nesne
  // birazdan Object.assign ile güncellenecek; karşılaştırma için "donmuş"
  // bir kopyaya ihtiyacımız var.
  const oldSnapshot = oldBook
    ? {
        author: oldBook.author,
        publisher: oldBook.publisher,
        series: oldBook.series,
        collections: [...(oldBook.collections || [])],
      }
    : null;

  const result = await updateBookRecord(id, newFields);

  // Hafızadaki kopyayı güncelle — cascade kontrolünün "hâlâ kullanılıyor
  // mu?" sorgusu state.books'a bakacağı için, bu satır kontrolden ÖNCE
  // çalışmalı (aksi halde güncellenen kitabın KENDİSİ hâlâ eski değeri
  // taşıyormuş gibi görünür ve "hâlâ kullanılıyor" sonucuna yanlışlıkla
  // ulaşılabilir).
  if (oldBook) {
    Object.assign(oldBook, newFields);
  }

  if (!oldSnapshot) return result; // eski veri yoksa (örn. kitap state'te bulunamadıysa) kontrol yapılamaz

  // staleValues.publisher HER ZAMAN eski publisher değeriyle doldurulur —
  // seri kontrolü "hangi yayınevine göre bakılacağını" bilmek için buna
  // ihtiyaç duyar, publisher'ın kendisi değişmemiş olsa bile.
  const staleValues = { publisher: oldSnapshot.publisher };
  let hasStaleValue = false;

  if ("author" in newFields && newFields.author !== oldSnapshot.author) {
    staleValues.author = oldSnapshot.author;
    hasStaleValue = true;
  }

  if ("publisher" in newFields && newFields.publisher !== oldSnapshot.publisher) {
    staleValues.publisher = oldSnapshot.publisher; // eski yayınevi, kendisi de kontrol edilecek
    hasStaleValue = true;
  }

  if ("series" in newFields && newFields.series !== oldSnapshot.series) {
    staleValues.series = oldSnapshot.series;
    hasStaleValue = true;
  }

  if ("collections" in newFields) {
    const newCollections = newFields.collections || [];
    const removedCollections = oldSnapshot.collections.filter((c) => !newCollections.includes(c));
    if (removedCollections.length > 0) {
      staleValues.collections = removedCollections;
      hasStaleValue = true;
    }
  }

  if (hasStaleValue) {
    await cascadeDeleteOrphans(staleValues);
  }

  return result;
}
// ── Adım 34 sonu ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── Kapak URL'inden dosya ID'sini çıkar ────────────────────────────────────
// cover_url formatı (hem web hem Python tarafında aynı): .../buckets/{BUCKET_ID}
// /files/{FILE_ID}/view?... — bu fonksiyon /files/ ile bir sonraki / arasındaki
// segmenti çıkarır. Format eşleşmezse (örn. cover_url boş veya beklenmeyen bir
// yapıdaysa) null döner — çağıran taraf bunu "silinecek dosya yok" olarak ele alır.
export function extractCoverFileId(coverUrl) {
  if (!coverUrl) return null;
  const match = coverUrl.match(/\/files\/([^/]+)\//);
  return match ? match[1] : null;
}

// ─── Tek kayıt sil ──────────────────────────────────────────────────────────
// Kitabı SİLMEDEN ÖNCE, eğer bir kapak resmi varsa storage'dan da siler.
// Bu olmazsa, silinen kitabın kapak dosyası storage'da "yetim" kalır — hem
// gereksiz yer kaplar hem de aynı kitap yeniden tarandığında Appwrite tarafı
// (Python uploader.py, book_id'den deterministik file_id ürettiği için) "A
// storage file with the requested ID already exists" hatası verir.
//
// Kapak silme işlemi BAŞARISIZ olsa bile (örn. dosya zaten storage'da yoksa,
// network hatası vb.) kitabın kendisinin silinmesi ENGELLENMEZ — kapak silme
// sessizce loglanır ve devam edilir; kullanıcı bir kitabı silmeye çalışırken
// "kapak silinemedi" diye takılıp kalmamalı.
//
// ── Adım 24: Cascade delete (yetim kayıt temizliği) ─────────────────────────
// NOT: Bu fonksiyon kitabı state.books'tan SİLER (çağıran taraf — modal.js,
// catalog.js — bunu artık kendisi yapmıyor). Cascade delete kontrolünün
// DOĞRU çalışması için state.books güncellemesi, Appwrite'tan silme başarılı
// olur olmaz, cascade kontrolünden ÖNCE yapılmalı — aksi halde "bu yazarın
// başka kitabı var mı?" kontrolü silinen kitabı da sayar ve yanlışlıkla
// "hâlâ kitabı var" sonucuna ulaşır.
export async function deleteBookRecord(id) {
  const book = state.books.find((b) => b.$id === id);
  const fileId = book ? extractCoverFileId(book.cover_url) : null;

  if (fileId) {
    try {
      await storage.deleteFile(BUCKET_ID, fileId);
    } catch (err) {
      // Dosya zaten yoksa (404) veya başka bir sebeple silinemiyorsa, kitap
      // silme işlemini bu yüzden durdurmuyoruz — sadece konsola not düşülür.
      console.warn(`[deleteBookRecord] Kapak dosyası silinemedi (${fileId}):`, err?.message || err);
    }
  }

  // ── Adım 29: "Doküman zaten yok" (404) hatası BAŞARISIZLIK değil, hedefe
  // zaten ulaşılmış demektir ─────────────────────────────────────────────────
  // SORUN: Appwrite'a giden bir DELETE isteği SUNUCU TARAFINDA başarıyla
  // tamamlanabilir, ama yanıt tarayıcıya dönerken bir network kesintisi/
  // gecikmesi yaşanırsa, bu fonksiyon "hata oldu" sanıp durur — state.books
  // güncellenmez, cascade delete hiç çalışmaz. Kitap ekranda "hayalet" olarak
  // kalır: Appwrite'ta YOK ama arayüzde HÂLÂ VAR görünür. Kullanıcı tekrar
  // silmeyi denediğinde Appwrite "böyle bir kayıt yok" (404) der — bu da
  // kafa karıştırıcı bir "silme hatası" olarak görünür, oysa kitap zaten
  // silinmişti.
  //
  // ÇÖZÜM: deleteDocument 404 ("document_not_found") hatasıyla başarısız
  // olursa, bunu GERÇEK bir hata olarak yukarı fırlatmak yerine "zaten
  // silinmiş, devam et" olarak ele alıyoruz. Böylece state.books güncellenir
  // ve cascade delete normal şekilde çalışır — sistem bir önceki başarısız
  // (ama sunucu tarafında aslında başarılı olmuş) denemeyi kendi kendine
  // düzeltir. Başka türlü bir hata (network kopması, yetkisiz erişim, vb.)
  // ise hâlâ olduğu gibi yukarı fırlatılır — sadece "zaten yok" durumu
  // toleranslı karşılanıyor.
  try {
    await databases.deleteDocument(DATABASE_ID, TABLE_ID, id);
  } catch (err) {
    const alreadyGone = err?.code === 404;
    if (!alreadyGone) throw err;
    console.warn(`[deleteBookRecord] Kitap zaten silinmiş (${id}) — hedefe ulaşıldı, devam ediliyor.`);
  }
  // ── Adım 29 sonu ─────────────────────────────────────────────────────────────

  // Kitap Appwrite'tan silindi (ya da zaten silinmişti) — hafızadaki kopyayı
  // da hemen çıkar. Cascade delete kontrolleri (aşağıda) state.books'a
  // bakarak "başka kitabı var mı" diye soracağı için, bu satır cascade
  // kontrolünden ÖNCE çalışmalı.
  state.books = state.books.filter((b) => b.$id !== id);

  if (book) {
    await cascadeDeleteOrphans(book);
  }
}

// ─── Yeni kayıt oluştur ─────────────────────────────────────────────────────
// Yedekten geri yükleme için kullanılır. id verilmezse Appwrite kendi üretir.
export async function createBookRecord(id, data) {
  return databases.createDocument(DATABASE_ID, TABLE_ID, id || ID.unique(), data);
}

// ─── Sistem alanlarını ayıkla ───────────────────────────────────────────────
// Bir belgeden $id, $createdAt gibi sistem alanlarını çıkarıp temiz veri döndürür.
export function stripSystemFields(doc) {
  const data = {};
  for (const key of Object.keys(doc)) {
    if (!SYSTEM_FIELDS.includes(key)) data[key] = doc[key];
  }
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// KİTAP KAPAĞI — manuel yükleme (Kitap Ayıklayıcı / modal'dan).
//
// Tarayıcı kapak resmini dosyadan çıkaramadığında, kullanıcı kendi bulduğu
// resmi buradan yükleyebilir. Her yükleme YENİ ve BENZERSİZ bir dosya ID'si
// alır; varsa ESKİ kapak dosyası yeni yükleme başarılı olduktan SONRA
// silinmeye çalışılır (bkz. uploadBookCover altındaki not).
// ═══════════════════════════════════════════════════════════════════════════

// ─── Storage dosyası için herkese açık görüntüleme adresini kur ────────────
// Python tarafındaki _build_public_url ile birebir aynı format kullanılır.
function buildPublicCoverUrl(fileId) {
  return (
    `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}` +
    `/files/${fileId}/view?project=${APPWRITE_PROJECT_ID}`
  );
}

// ─── Bir kitabın kapak resmini yükle/değiştir ───────────────────────────────
// Her yükleme YENİ ve BENZERSİZ bir dosya ID'si (ID.unique()) ile yapılır —
// bu, yeni yüklemenin eski dosyanın üzerine yazma denemesinden kaynaklanacak
// bir "409 ID already exists" riskini ortadan kaldırır.
//
// Yeni dosya başarıyla yüklenip kitabın cover_url alanı güncellendiKTEN SONRA,
// varsa ESKİ kapak dosyası storage'dan silinmeye çalışılır:
//   • Kitapta zaten bir kapak YOKSA → silinecek bir şey yok, atlanır.
//   • Eski kapak Python tarayıcısı tarafından (server API key ile) yüklenmişse
//     → tarayıcı oturumunun bu dosyayı silme izni olmayabilir (401/403).
//     Bu durumda hata YUTULUR ve sadece konsola not düşülür — kapak güncellemesi
//     zaten tamamlanmıştır, eski dosya storage'da yetim kalır ama işlem bozulmaz
//     (deleteBookRecord'daki "best-effort silme" deseniyle birebir aynı yaklaşım).
//   • Eski kapak modal'dan (tarayıcı oturumuyla) yüklenmişse → aynı oturum
//     onu silme iznine de sahiptir, silme normalde başarılı olur ve bucket'ta
//     yetim resim birikmesi önlenir.
//
// Dönüş: yeni cover_url (başarılıysa). Yükleme/veritabanı adımı hata verirse
// fırlatılır; eski dosyanın silinememesi bu fonksiyonu BAŞARISIZ yapmaz.
export async function uploadBookCover(bookId, file) {
  const book = state.books.find((b) => b.$id === bookId);
  const oldFileId = book ? extractCoverFileId(book.cover_url) : null;

  const fileId = ID.unique(); // Her yüklemede yepyeni, çakışmayan bir ID

  // ── Adım 36: Storage'a giden dosyanın GÖRÜNEN ADI (filename), Appwrite
  // SDK'sı tarafında varsayılan olarak tarayıcının seçtiği orijinal dosya
  // adından (örn. "tmpmk05f9rz.jpg" gibi rastgele/geçici bir ad) geliyordu —
  // bu da Storage konsolunda görünen "Name" ile dosyanın gerçek "fileId"sinin
  // birbiriyle HİÇ ilgisi olmamasına sebep oluyordu (kullanıcı tooltip'teki
  // ID'yi görüp Storage'da o adı aratamıyordu). Çözüm: dosyayı Appwrite'a
  // göndermeden önce, içeriğini bozmadan SADECE adını fileId ile aynı yapacak
  // şekilde yeniden paketliyoruz (File nesnesi içerik/tip korunarak yeniden
  // oluşturuluyor). Böylece Storage'daki "Name" kolonu = tooltip'teki değer
  // = birebir aynı string olur, kopyala-yapıştırla aratılabilir.
  const renamedFile = new File([file], `${fileId}.jpg`, { type: file.type });

  // 1) Yeni dosyayı storage'a yükle (adı artık fileId ile aynı).
  await storage.createFile(BUCKET_ID, fileId, renamedFile);

  // 2) Yeni adresi kitabın kaydına yaz (eski kapak referansının üzerine yazılır).
  const coverUrl = buildPublicCoverUrl(fileId);
  await databases.updateDocument(DATABASE_ID, TABLE_ID, bookId, { cover_url: coverUrl });

  // Hafızadaki kopyayı da güncelle (sayfa yeniden çekmeden anında görünsün).
  const idx = state.books.findIndex((b) => b.$id === bookId);
  if (idx !== -1) state.books[idx] = { ...state.books[idx], cover_url: coverUrl };

  // 3) Eski kapak dosyası varsa, şimdi silmeyi dene (best-effort — bkz. yukarıdaki not).
  if (oldFileId && oldFileId !== fileId) {
    try {
      await storage.deleteFile(BUCKET_ID, oldFileId);
    } catch (err) {
      console.warn(`[uploadBookCover] Eski kapak dosyası silinemedi (${oldFileId}):`, err?.message || err);
    }
  }

  return coverUrl;
}