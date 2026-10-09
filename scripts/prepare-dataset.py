import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import urllib.request


SOURCE_COMMIT = "2a692ab575001cbde74d402d897a7286086c6199"
RAW_BASE = f"https://raw.githubusercontent.com/amazon-science/spot-diff/{SOURCE_COMMIT}/"
ARCHIVE_URL = "https://amazon-visual-anomaly.s3.us-west-2.amazonaws.com/VisA_20220922.tar"
SEED = "defect-atlas-visa-v1"
VERSION = "visa-candle-pcb1-v1"
CATEGORIES = ("candle", "pcb1")
MAX_ARCHIVE_BYTES = 2_000_000_000
MAX_MEMBER_BYTES = 16_000_000
RANGE_BYTES = 2 * 1024 * 1024
CATEGORY_STARTS = {"candle": 0, "pcb1": 907_116_032}
ARCHIVE_ETAG = '"05c830591a1172938cb714895c9e0cfb-113"'
REPO = pathlib.Path(__file__).resolve().parents[1]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def get_bytes(url, limit):
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source metadata exceeded its size limit")
    return data


def safe_destination(root, name):
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError("Unsafe source archive path")
    destination = (root / str(path)).resolve()
    if not destination.is_relative_to(root.resolve()):
        raise ValueError("Archive destination escaped the cache")
    return destination


def rank(row):
    return digest(f"{SEED}\0{row['object']}\0{row['label']}\0{row['image']}".encode())


class ArchiveReader:
    def __init__(self, archive_meta, start):
        self.meta = archive_meta
        self.position = start
        self.buffer = b""
        self.buffer_start = 0
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)
        self.pending = {}
        self.next_prefetch = start
        for _ in range(8):
            self.prefetch()

    def prefetch(self):
        if self.next_prefetch < self.meta["byteLength"]:
            start = self.next_prefetch
            self.pending[start] = self.executor.submit(self.fetch, start)
            self.next_prefetch += RANGE_BYTES

    def fetch(self, start):
        end = min(start + RANGE_BYTES, self.meta["byteLength"]) - 1
        request = urllib.request.Request(ARCHIVE_URL, headers={"Range": f"bytes={start}-{end}", "If-Match": self.meta["etag"]})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{self.meta['byteLength']}":
                        raise ValueError("Source did not honour the bounded byte range")
                    buffer = response.read(end - start + 2)
                    if len(buffer) != end - start + 1:
                        raise ValueError("Incomplete archive byte range")
                return buffer
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                print(f"Retrying archive byte range after a read error (attempt {attempt + 2}/3)", flush=True)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)

    def read(self, size):
        pieces = []
        while size and self.position < self.meta["byteLength"]:
            if not self.buffer_start <= self.position < self.buffer_start + len(self.buffer):
                start = self.position
                self.buffer, self.buffer_start = self.pending.pop(start).result(), start
                self.prefetch()
            offset = self.position - self.buffer_start
            count = min(size, len(self.buffer) - offset)
            pieces.append(self.buffer[offset:offset + count])
            self.position += count
            size -= count
        return b"".join(pieces)


def select_rows(rows):
    selected = []
    for category in CATEGORIES:
        for truth in ("normal", "anomaly"):
            pool = sorted((row for row in rows if row["object"] == category and row["label"] == truth), key=rank)
            allocations = (("reference", 4), ("calibration", 8), ("holdout", 12)) if truth == "normal" else (("calibration", 8), ("holdout", 12))
            offset = 0
            for split, count in allocations:
                chosen = pool[offset:offset + count]
                if len(chosen) != count:
                    raise ValueError("Insufficient source images for the fixed selection")
                for row in chosen:
                    selected.append({**row, "demoSplit": split, "id": "da-" + digest(f"opaque\0{row['image']}".encode())[:12]})
                offset += count
    split_order = {"reference": 0, "calibration": 1, "holdout": 2}
    return sorted(selected, key=lambda row: (row["object"], split_order[row["demoSplit"]], row["id"]))


def stream_selected(cache, selected, archive_meta):
    expected = {row["image"] for row in selected} | {row["mask"] for row in selected if row["mask"]}
    metadata_names = {f"{category}/{name}" for category in CATEGORIES for name in ("image_anno.csv", "image_annot.csv")}
    pending = {name for name in expected if not safe_destination(cache / "originals", name).is_file()}
    if not pending:
        print("Selected originals already cached; no archive download needed", flush=True)
        return
    print(f"Streaming archive: {len(pending)} selected image and mask files", flush=True)
    if archive_meta["etag"] != ARCHIVE_ETAG:
        raise ValueError("Source archive changed; review and regenerate its category offsets")
    for category in CATEGORIES:
        category_pending = {name for name in pending if name.startswith(category + "/")}
        if not category_pending:
            continue
        print(f"Archive category: {category}; {len(category_pending)} selected files remain", flush=True)
        start = CATEGORY_STARTS[category]
        reader = ArchiveReader(archive_meta, start)
        try:
            with tarfile.open(fileobj=reader, mode="r|", bufsize=1024 * 1024) as archive:
                for index, member in enumerate(archive):
                    name = member.name.removeprefix("./").removeprefix("VisA/")
                    if index == 0 and (name.rstrip("/") != category or not member.isdir()):
                        raise ValueError("Pinned category offset did not identify its expected directory")
                    if name.split("/")[0] != category:
                        raise ValueError("Category ended before its selected files were found")
                    if start + member.offset_data + member.size > MAX_ARCHIVE_BYTES:
                        raise ValueError("Source archive exceeded its accepted size")
                    if name not in pending and name not in metadata_names:
                        continue
                    if not member.isfile() or member.size > MAX_MEMBER_BYTES:
                        raise ValueError("Selected source entry is not an acceptable regular file")
                    destination = safe_destination(cache / "originals", name)
                    contents = archive.extractfile(member).read(MAX_MEMBER_BYTES + 1)
                    if len(contents) != member.size:
                        raise ValueError("Incomplete source archive member")
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(contents)
                    pending.discard(name)
                    category_pending.discard(name)
                    if not category_pending:
                        print(f"Selected {category} originals and masks acquired; ending category stream", flush=True)
                        break
        finally:
            reader.close()
    if pending:
        raise ValueError(f"Archive omitted {len(pending)} selected files")


def main():
    parser = argparse.ArgumentParser(description="Prepare the fixed, attributed Defect Atlas VisA subset.")
    parser.add_argument("--cache", required=True, type=pathlib.Path, help="Private source-cache directory outside this repository")
    args = parser.parse_args()
    cache = args.cache.resolve()
    if cache.is_relative_to(REPO):
        raise ValueError("Keep the source cache outside the public repository")
    cache.mkdir(parents=True, exist_ok=True)
    metadata = {}
    for name in ("split_csv/1cls.csv", "utils/id2class.py", "LICENSE-DATASET", "NOTICE", "README.md"):
        data = get_bytes(RAW_BASE + name, 2_000_000)
        target = safe_destination(cache / "metadata", name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        metadata[name] = {"url": RAW_BASE + name, "sha256": digest(data)}
    rows = list(csv.DictReader(io.StringIO((cache / "metadata/split_csv/1cls.csv").read_text(encoding="utf-8"))))
    selected = select_rows(rows)
    with urllib.request.urlopen(urllib.request.Request(ARCHIVE_URL, method="HEAD"), timeout=60) as response:
        length = int(response.headers["Content-Length"])
        if length > MAX_ARCHIVE_BYTES:
            raise ValueError("Source archive is larger than the accepted limit")
        archive_meta = {"url": ARCHIVE_URL, "byteLength": length, "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified"), "categoryOffsets": CATEGORY_STARTS}
        if archive_meta["etag"] != ARCHIVE_ETAG:
            raise ValueError("Source archive changed; review its contents before preparing a new dataset version")
    selection = {"version": VERSION, "seed": SEED, "sourceCommit": SOURCE_COMMIT, "archive": archive_meta, "metadata": metadata, "selected": selected}
    (cache / "selection.json").write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selected": len(selected), "archiveBytes": length, "sourceCommit": SOURCE_COMMIT}), flush=True)
    stream_selected(cache, selected, archive_meta)
    (REPO / "LICENSE-DATASET").write_bytes((cache / "metadata/LICENSE-DATASET").read_bytes())
    subprocess.run(["node", str(REPO / "scripts/prepare-dataset.mjs"), str(cache)], check=True, cwd=REPO)


if __name__ == "__main__":
    main()
