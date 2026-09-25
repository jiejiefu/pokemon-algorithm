#!/usr/bin/env python3
import asyncio
import json
import shutil
import time
from pathlib import Path
from typing import Optional

import httpx
import opencc
import pandas as pd
from bs4 import BeautifulSoup

BASE = Path(__file__).parent.parent
JSON_PATH = BASE / "assets" / "data" / "pokemon_data.json"
EXCEL_PATH = BASE / "data-sources" / "International List of Pokémon Names.xlsx"
BACKUP_PATH = EXCEL_PATH.with_suffix(".xlsx.backup")
REPORT_PATH = BASE / "NAME_CHANGES_REPORT.md"
URL_TEMPLATE = "https://tw.portal-pokemon.com/play/pokedex/{:04d}/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}
CONVERTER = opencc.OpenCC("tw2s.json")
DELAY = 0.1
TIMEOUT = 20.0


async def fetch_name(client: httpx.AsyncClient, pokemon_id: int) -> Optional[str]:
    url = URL_TEMPLATE.format(pokemon_id)
    for attempt in range(3):
        try:
            response = await client.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
            if response.status_code == 200:
                name = BeautifulSoup(response.text, "lxml").find("h1")
                return name.get_text(strip=True) if name else None
            if response.status_code == 404:
                return None
        except httpx.HTTPError:
            pass
        if attempt < 2:
            await asyncio.sleep(DELAY * (2 ** attempt))
    return None


async def scrape_all_names() -> dict[int, str]:
    names = {}
    limits = httpx.Limits(max_connections=12, max_keepalive_connections=8)
    async with httpx.AsyncClient(limits=limits) as client:
        for start in range(1, 1026, 50):
            ids = range(start, min(start + 50, 1026))
            results = await asyncio.gather(*(fetch_name(client, pokemon_id) for pokemon_id in ids))
            names.update((pokemon_id, name) for pokemon_id, name in zip(ids, results) if name)
            print(f"Progress: {min(start + 49, 1025)}/1025")
            await asyncio.sleep(DELAY)
    return names


def current_json_names() -> dict[int, dict[str, str]]:
    with JSON_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    return {
        pokemon["id"]: {
            "zh": pokemon.get("names", {}).get("zh", ""),
            "zh_HK": pokemon.get("names", {}).get("zh_HK", ""),
        }
        for pokemon in data
    }


def load_excel_names() -> dict[int, dict[str, str]]:
    frame = pd.read_excel(EXCEL_PATH)
    return {
        index + 1: {"zh": row["zh"], "zh_HK": row["zh_HK"]}
        for index, row in frame.iterrows()
    }


def build_changes(old: dict[int, dict[str, str]], scraped: dict[int, str]) -> list[dict]:
    changes = []
    for pokemon_id in range(1, 1026):
        new_zh = scraped.get(pokemon_id)
        if not new_zh:
            changes.append({"id": pokemon_id, "status": "missing"})
            continue
        new_zh_hk = CONVERTER.convert(new_zh)
        if old.get(pokemon_id, {}).get("zh") != new_zh or old.get(pokemon_id, {}).get("zh_HK") != new_zh_hk:
            changes.append({
                "id": pokemon_id,
                "status": "changed",
                "old_zh": old.get(pokemon_id, {}).get("zh", ""),
                "new_zh": new_zh,
                "old_zh_HK": old.get(pokemon_id, {}).get("zh_HK", ""),
                "new_zh_HK": new_zh_hk,
            })
    return changes


def write_report(changes: list[dict], scraped: dict[int, str]) -> None:
    changed = [change for change in changes if change["status"] == "changed"]
    missing = [change["id"] for change in changes if change["status"] == "missing"]
    lines = [
        "# Pokémon Chinese Name Changes",
        "",
        f"Source: tw.portal-pokemon.com",
        f"Scraped: {len(scraped)}/1025",
        f"Changed: {len(changed)}",
        f"Missing: {len(missing)}",
        "",
    ]
    if missing:
        lines.extend(f"- Missing: {pokemon_id:04d}" for pokemon_id in missing)
        lines.append("")
    for change in changed:
        lines.extend([
            f"## {change['id']:04d}",
            f"- zh: `{change['old_zh']}` → `{change['new_zh']}`",
            f"- zh_HK: `{change['old_zh_HK']}` → `{change['new_zh_HK']}`",
            "",
        ])
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def update_json(scraped: dict[int, str]) -> None:
    with JSON_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    for pokemon in data:
        pokemon_id = pokemon["id"]
        if pokemon_id in scraped:
            pokemon.setdefault("names", {})["zh"] = scraped[pokemon_id]
            pokemon["names"]["zh_HK"] = CONVERTER.convert(scraped[pokemon_id])
    with JSON_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def update_excel(scraped: dict[int, str]) -> None:
    frame = pd.read_excel(EXCEL_PATH)
    frame["zh"] = [scraped.get(index + 1, frame.loc[index, "zh"]) for index in range(len(frame))]
    frame["zh_HK"] = [CONVERTER.convert(scraped[index + 1]) if index + 1 in scraped else frame.loc[index, "zh_HK"] for index in range(len(frame))]
    frame.to_excel(EXCEL_PATH, index=False)


def main() -> None:
    if BACKUP_PATH.exists():
        BACKUP_PATH.unlink()
    shutil.copy2(EXCEL_PATH, BACKUP_PATH)
    old_json = current_json_names()
    old_excel = load_excel_names()
    try:
        scraped = asyncio.run(scrape_all_names())
        changes = build_changes(old_json, scraped)
        excel_changes = build_changes(old_excel, scraped)
        write_report(changes, scraped)
        if len(scraped) != 1025:
            raise RuntimeError(f"Expected 1025 names, scraped {len(scraped)}")
        update_json(scraped)
        update_excel(scraped)
        print(f"JSON changes: {len([change for change in changes if change['status'] == 'changed'])}")
        print(f"Excel changes: {len([change for change in excel_changes if change['status'] == 'changed'])}")
        print(f"Report: {REPORT_PATH}")
    finally:
        BACKUP_PATH.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
