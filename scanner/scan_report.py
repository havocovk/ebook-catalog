# -*- coding: utf-8 -*-
"""
Raporlama modülü.

Tarama bittikten sonra istatistik özetini ekrana basar, eksik alan
raporunu CSV'ye yazar ve (--verbose ile) her kitabın metadata
kaynaklarını detaylı gösterir.

scan.py'den bölündü — Adım 3-4B (Faz 3 refactoring).
"""

import os
import csv

from logger_setup import get_logger

# Modül seviyesinde bir kez oluşturulur — orijinal scan.py'deki global
# 'log' değişkeniyle aynı davranış (Adım 8 loglama mantığı korunur).
log = get_logger()


def _print_summary(stats: dict, missing_tracker: dict):
    processed = stats["new"] + stats["error"]

    print("\n" + "=" * 55)
    print(f"✅ Yeni eklenen  : {stats['new']}")
    print(f"⏭  Atlanan       : {stats['skipped']}")
    print(f"❌ Hata          : {stats['error']}")
    print("-" * 55)

    if processed > 0:
        print("📊 EKSİK ALAN İSTATİSTİĞİ (yeni eklenenler):")
        fields_tr = {
            "title":     "Başlık bulunamayan  ",
            "author":    "Yazar bulunamayan   ",
            "publisher": "Yayınevi bulunamayan",
            "series":    "Seri bulunamayan    ",
            "year":      "Yıl bulunamayan     ",
            "language":  "Dil bulunamayan     ",
        }
        for field, label in fields_tr.items():
            count = len(missing_tracker[field])
            pct = int(count / processed * 100) if processed > 0 else 0
            bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
            print(f"  {label}: {count:3d} / {processed}  [{bar}] %{pct}")

    print("=" * 55)

    # ── Adım 8: Tarama özetini logla ────────────────────────────────────────
    # Burası "orta seviye" loglamanın ana noktası: her kitabın tek tek detayı
    # değil, ama taramanın genel sonucu kalıcı olarak kaydedilir.
    log.info(
        f"Tarama tamamlandı — Yeni: {stats['new']}, "
        f"Atlanan: {stats['skipped']}, Hata: {stats['error']}"
    )
    if stats["error"] > 0:
        log.warning(f"Bu taramada {stats['error']} dosya hata ile sonuçlandı (detaylar yukarıda).")


def _write_csv_report(csv_path: str, missing_tracker: dict):
    file_issues = {}
    for field, paths in missing_tracker.items():
        for path in paths:
            if path not in file_issues:
                file_issues[path] = []
            file_issues[path].append(field)

    try:
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["Dosya Adı", "Dosya Yolu", "Eksik Alanlar"])
            for path, fields in sorted(file_issues.items()):
                writer.writerow([os.path.basename(path), path, ", ".join(fields)])
        print(f"\n📄 Eksik alan raporu kaydedildi: {csv_path}")
    except Exception as e:
        print(f"\n⚠️  CSV raporu yazılamadı: {e}")


def _print_verbose(metadata: dict, api_data: dict):
    api_fields = {"year", "series", "series_order", "description", "author", "publisher", "language"}
    field_labels = {
        "title":        "Başlık     ",
        "author":       "Yazar      ",
        "year":         "Yıl        ",
        "publisher":    "Yayınevi   ",
        "edition":      "Baskı      ",
        "language":     "Dil        ",
        "series":       "Seri       ",
        "series_index": "Seri Sırası",
        "isbn":         "ISBN       ",
    }
    print("  ┌─ Metadata Kaynakları ──────────────────────")
    for field, label in field_labels.items():
        value = metadata.get(field)
        if value:
            came_from_api = field in api_fields and api_data.get(
                field if field != "author" else "author_api"
            )
            source = "[api]   " if came_from_api else "[dosya] "
            print(f"  │ {label}: {source} {value}")
        else:
            print(f"  │ {label}: ⚠ EKSİK")
    print("  └────────────────────────────────────────────")