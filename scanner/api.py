import requests
import time


GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
REQUEST_DELAY = 0.5  # seconds between requests to avoid rate limiting


def enrich_metadata(title: str, author: str = None) -> dict:
    """
    Query Google Books API to enrich book metadata.
    Returns dict with any found fields: series, year, description, cover_url_api.
    Returns empty dict on failure.
    """
    if not title:
        return {}

    query = _build_query(title, author)
    result = _query_google_books(query)
    time.sleep(REQUEST_DELAY)
    return result


def _build_query(title: str, author: str = None) -> str:
    query = f'intitle:"{title}"'
    if author:
        # Use first part of author name for broader match
        short_author = author.split(",")[0].strip()
        query += f' inauthor:"{short_author}"'
    return query


def _query_google_books(query: str) -> dict:
    try:
        params = {
            "q": query,
            "maxResults": 1,
            "fields": "items(volumeInfo(title,authors,publishedDate,description,seriesInfo,imageLinks))",
        }
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

    # Publication year
    published = info.get("publishedDate", "")
    if published and len(published) >= 4:
        try:
            result["year"] = int(published[:4])
        except ValueError:
            pass

    # Author (only fill if we don't have one)
    authors = info.get("authors")
    if authors:
        result["author_api"] = ", ".join(authors)

    # Series info (not always available in free API)
    series_info = info.get("seriesInfo", {})
    if series_info:
        book_series = series_info.get("bookSeries", [])
        if book_series:
            result["series"] = book_series[0].get("title")
            result["series_order"] = book_series[0].get("bookOrderNumber")

    # Description
    description = info.get("description", "")
    if description:
        result["description"] = description[:500]  # truncate

    # Cover from API (fallback if file extraction fails)
    image_links = info.get("imageLinks", {})
    cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if cover:
        # Force https
        result["cover_url_api"] = cover.replace("http://", "https://")

    return result
