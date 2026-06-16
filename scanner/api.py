import os
import requests
import time

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
REQUEST_DELAY = 1.0  # seconds between requests


def enrich_metadata(title: str, author: str = None) -> dict:
    if not title:
        return {}
    query = _build_query(title, author)
    result = _query_google_books(query)
    time.sleep(REQUEST_DELAY)
    return result


def _build_query(title: str, author: str = None) -> str:
    query = f'intitle:"{title}"'
    if author:
        short_author = author.split(",")[0].strip()
        query += f' inauthor:"{short_author}"'
    return query


def _query_google_books(query: str) -> dict:
    try:
        params = {
            "q": query,
            "maxResults": 1,
            # publisher ve language alanları fields listesine eklendi
            "fields": "items(volumeInfo(title,authors,publishedDate,description,seriesInfo,imageLinks,publisher,language))",
        }
        if GOOGLE_API_KEY:
            params["key"] = GOOGLE_API_KEY

        response = requests.get(GOOGLE_BOOKS_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        items = data.get("items")
        if not items:
            return {}
        volume_info = items[0].get("volumeInfo", {})
        return _parse_volume_info(volume_info)
    except requests.exceptions.RequestException as e:
        print(f"  [Google Books API hatası] {e}")
        return {}
    except Exception as e:
        print(f"  [Google Books parse hatası] {e}")
        return {}


def _parse_volume_info(info: dict) -> dict:
    result = {}

    published = info.get("publishedDate", "")
    if published and len(published) >= 4:
        try:
            result["year"] = int(published[:4])
        except ValueError:
            pass

    authors = info.get("authors")
    if authors:
        result["author_api"] = ", ".join(authors)

    series_info = info.get("seriesInfo", {})
    if series_info:
        book_series = series_info.get("bookSeries", [])
        if book_series:
            result["series"] = book_series[0].get("title")
            result["series_order"] = book_series[0].get("bookOrderNumber")

    description = info.get("description", "")
    if description:
        result["description"] = description[:500]

    image_links = info.get("imageLinks", {})
    cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if cover:
        result["cover_url_api"] = cover.replace("http://", "https://")

    # YENİ: Yayınevi bilgisi
    publisher = info.get("publisher", "")
    if publisher and publisher.strip():
        result["publisher"] = publisher.strip()

    # YENİ: Dil bilgisi (Google Books iki harfli kod döndürür: "tr", "en", "de" vb.)
    language = info.get("language", "")
    if language and language.strip():
        result["language"] = language.strip().lower()

    return result