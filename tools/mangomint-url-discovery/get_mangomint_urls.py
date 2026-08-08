#!/usr/bin/env python3

import csv
import json
import time
import urllib.parse
import urllib.request
from urllib.parse import urlsplit, urlunsplit


COLLECTIONS_URL = "https://index.commoncrawl.org/collinfo.json"
URL_PATTERN = "booking.mangomint.com/*"

# Search the 12 most recent Common Crawl snapshots.
CRAWLS_TO_SEARCH = 12

OUTPUT_TEXT = "mangomint_urls.txt"
OUTPUT_CSV = "mangomint_urls.csv"

USER_AGENT = (
    "NextAppt-CommonCrawl-URL-Discovery/1.0 "
    "(public URL research)"
)

STATIC_EXTENSIONS = (
    ".js",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".map",
    ".json",
    ".xml",
)


def fetch_text(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=90,
    ) as response:
        return response.read().decode(
            "utf-8",
            errors="replace",
        )


def get_recent_crawls():
    data = json.loads(
        fetch_text(COLLECTIONS_URL)
    )

    crawls = []

    for collection in data[:CRAWLS_TO_SEARCH]:
        api_url = collection.get("cdx-api")
        crawl_id = collection.get("id")

        if api_url and crawl_id:
            crawls.append(
                {
                    "id": crawl_id,
                    "api_url": api_url,
                }
            )

    return crawls


def build_query_url(api_url, page=None):
    parameters = [
        ("url", URL_PATTERN),
        ("output", "json"),
        ("filter", "status:200"),
        ("collapse", "urlkey"),
    ]

    if page is not None:
        parameters.append(
            ("page", str(page))
        )

    return (
        api_url
        + "?"
        + urllib.parse.urlencode(parameters)
    )


def get_page_count(api_url):
    parameters = [
        ("url", URL_PATTERN),
        ("output", "json"),
        ("filter", "status:200"),
        ("collapse", "urlkey"),
        ("showNumPages", "true"),
    ]

    url = (
        api_url
        + "?"
        + urllib.parse.urlencode(parameters)
    )

    try:
        response = json.loads(
            fetch_text(url)
        )

        return max(
            1,
            int(response.get("pages", 1)),
        )
    except Exception:
        return 1


def normalize_mangomint_url(raw_url):
    try:
        parsed = urlsplit(raw_url)
    except ValueError:
        return None

    hostname = (
        parsed.hostname or ""
    ).lower()

    if hostname != "booking.mangomint.com":
        return None

    path = parsed.path.rstrip("/")

    if not path:
        return None

    lower_path = path.lower()

    if lower_path.endswith(STATIC_EXTENSIONS):
        return None

    # Remove query strings and fragments.
    return urlunsplit(
        (
            "https",
            "booking.mangomint.com",
            path,
            "",
            "",
        )
    )


def main():
    crawls = get_recent_crawls()

    discovered = {}

    print(
        f"Searching {len(crawls)} Common Crawl snapshots..."
    )

    for crawl_number, crawl in enumerate(
        crawls,
        start=1,
    ):
        crawl_id = crawl["id"]
        api_url = crawl["api_url"]

        print(
            f"\n[{crawl_number}/{len(crawls)}] "
            f"Searching {crawl_id}"
        )

        try:
            page_count = get_page_count(
                api_url
            )
        except Exception:
            page_count = 1

        print(
            f"Pages to retrieve: {page_count}"
        )

        for page in range(page_count):
            print(
                f"  Page {page + 1}/{page_count}"
            )

            try:
                response_text = fetch_text(
                    build_query_url(
                        api_url,
                        page=page,
                    )
                )
            except Exception as error:
                print(
                    f"  Request failed: {error}"
                )
                time.sleep(5)
                continue

            for line in response_text.splitlines():
                line = line.strip()

                if not line:
                    continue

                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                booking_url = normalize_mangomint_url(
                    record.get("url", "")
                )

                if not booking_url:
                    continue

                timestamp = str(
                    record.get("timestamp", "")
                )

                existing = discovered.get(
                    booking_url
                )

                if not existing:
                    discovered[booking_url] = {
                        "booking_url": booking_url,
                        "tenant_path": urlsplit(
                            booking_url
                        ).path.strip("/"),
                        "first_seen": timestamp,
                        "last_seen": timestamp,
                        "crawl_count": 1,
                        "crawls": {crawl_id},
                    }
                    continue

                existing["crawls"].add(
                    crawl_id
                )

                existing["crawl_count"] = len(
                    existing["crawls"]
                )

                if (
                    timestamp
                    and timestamp
                    < existing["first_seen"]
                ):
                    existing["first_seen"] = timestamp

                if (
                    timestamp
                    and timestamp
                    > existing["last_seen"]
                ):
                    existing["last_seen"] = timestamp

            # Common Crawl asks clients to slow down
            # between index requests.
            time.sleep(2)

    rows = list(discovered.values())

    for row in rows:
        row["crawls"] = "|".join(
            sorted(row["crawls"])
        )

    rows.sort(
        key=lambda row: row[
            "booking_url"
        ].lower()
    )

    with open(
        OUTPUT_TEXT,
        "w",
        encoding="utf-8",
    ) as output_file:
        for row in rows:
            output_file.write(
                row["booking_url"] + "\n"
            )

    with open(
        OUTPUT_CSV,
        "w",
        newline="",
        encoding="utf-8",
    ) as output_file:
        fieldnames = [
            "booking_url",
            "tenant_path",
            "first_seen",
            "last_seen",
            "crawl_count",
            "crawls",
        ]

        writer = csv.DictWriter(
            output_file,
            fieldnames=fieldnames,
        )

        writer.writeheader()
        writer.writerows(rows)

    print("\n==============================")
    print(
        f"Unique URLs found: {len(rows)}"
    )
    print(
        f"Plain URL list: {OUTPUT_TEXT}"
    )
    print(
        f"Detailed list: {OUTPUT_CSV}"
    )
    print("==============================")


if __name__ == "__main__":
    main()

