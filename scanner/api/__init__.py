# -*- coding: utf-8 -*-
"""
api paketi — köprü (compatibility shim).

Bu paket, eski tek-dosyalık api.py'nin yerini alır (Adım 5 refactoring).
scan.py'nin beklediği ismi dışa açar:

    from api import enrich_metadata

Böylece scan.py'de HİÇBİR değişiklik gerekmez.

NOT: api.py doğrudan çalıştırıldığında .env yüklenmesi gerekiyordu;
load_dotenv() çağrısı burada korunur (paket ilk import edildiğinde çalışır).
"""

from dotenv import load_dotenv
load_dotenv()

from .core import enrich_metadata

__all__ = ["enrich_metadata"]